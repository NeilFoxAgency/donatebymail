create or replace function api.agent_record_outbound_message(
  agent_identity text,
  authorization_value uuid,
  subject_value text,
  body_value text,
  content_hash_value text,
  provider_value text,
  external_thread_value text,
  external_message_value text,
  sender_identity_value text,
  sent_at_value timestamptz default now()
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = pg_catalog, app_private
as $$
declare
  authorization_row app_private.agent_message_authorizations%rowtype;
  decision_row app_private.action_decisions%rowtype;
  approval_ok boolean := false;
  thread_id_value uuid;
  message_id_value uuid;
  existing_message uuid;
  recomputed_hash text;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_agent_identity(agent_identity);
  select * into authorization_row
  from app_private.agent_message_authorizations
  where id = authorization_value for update;
  if authorization_row.id is null or authorization_row.agent_ref <> agent_identity then
    raise exception 'valid message authorization required' using errcode = '22023';
  end if;

  select id into existing_message
  from app_private.communication_messages
  where agent_action_id = authorization_row.agent_action_id
    and direction = 'outbound'
  order by created_at desc
  limit 1;
  if authorization_row.consumed_at is not null and existing_message is not null then
    return jsonb_build_object(
      'messageId', existing_message,
      'replayed', true,
      'authorizationConsumed', true
    );
  end if;

  recomputed_hash := app_private.support_content_hash(
    authorization_row.message_category, authorization_row.recipient_email_search,
    btrim(subject_value), body_value, authorization_row.donation_id,
    authorization_row.organization_id, authorization_row.campaign_id
  );
  if authorization_row.consumed_at is not null
    or authorization_row.expires_at <= now()
    or authorization_row.content_hash <> content_hash_value
    or recomputed_hash <> authorization_row.content_hash
    or btrim(subject_value) <> authorization_row.subject
    or provider_value not in ('gmail','brevo','manual')
    or char_length(coalesce(body_value, '')) not between 1 and 12000
    or char_length(btrim(coalesce(external_thread_value, ''))) not between 1 and 300
    or char_length(btrim(coalesce(external_message_value, ''))) not between 1 and 300
    or char_length(btrim(coalesce(sender_identity_value, ''))) not between 3 and 300
    or sent_at_value is null
  then
    raise exception 'valid unconsumed exact-message authorization required' using errcode = '22023';
  end if;

  select * into decision_row
  from app_private.action_decisions
  where id = authorization_row.action_decision_id;
  approval_ok := decision_row.outcome = 'ALLOW_AUTOMATICALLY' or (
    decision_row.outcome = 'REQUIRE_APPROVAL' and exists(
      select 1 from app_private.action_approvals a
      where a.action_decision_id = decision_row.id and a.outcome = 'approved'
    )
  );
  if not approval_ok then
    raise exception 'message is not approved for execution' using errcode = '42501';
  end if;

  insert into app_private.communication_threads(
    donation_id, organization_id, campaign_id,
    external_provider, external_thread_ref, subject,
    last_message_at, contact_email_search, status
  ) values (
    authorization_row.donation_id,
    authorization_row.organization_id,
    authorization_row.campaign_id,
    provider_value, btrim(external_thread_value), authorization_row.subject,
    sent_at_value, authorization_row.recipient_email_search, 'waiting_on_contact'
  )
  on conflict (external_provider, external_thread_ref)
    where external_thread_ref is not null
  do update set
    donation_id = coalesce(app_private.communication_threads.donation_id, excluded.donation_id),
    organization_id = coalesce(app_private.communication_threads.organization_id, excluded.organization_id),
    campaign_id = coalesce(app_private.communication_threads.campaign_id, excluded.campaign_id),
    subject = coalesce(excluded.subject, app_private.communication_threads.subject),
    last_message_at = greatest(app_private.communication_threads.last_message_at, excluded.last_message_at),
    contact_email_search = coalesce(app_private.communication_threads.contact_email_search, excluded.contact_email_search),
    status = 'waiting_on_contact'
  returning id into thread_id_value;

  select id into existing_message
  from app_private.communication_messages
  where thread_id = thread_id_value and external_message_ref = btrim(external_message_value);
  if existing_message is not null then
    raise exception 'provider message reference already recorded' using errcode = '23505';
  end if;

  insert into app_private.communication_messages(
    thread_id, direction, external_message_ref,
    sender_identity_ref, recipient_identity_refs,
    body_summary, body_storage_ref, agent_action_id, sent_at
  ) values (
    thread_id_value, 'outbound', btrim(external_message_value),
    btrim(sender_identity_value), jsonb_build_array(authorization_row.recipient_email_search),
    authorization_row.body_summary,
    provider_value || ':' || btrim(external_message_value),
    authorization_row.agent_action_id,
    sent_at_value
  ) returning id into message_id_value;

  insert into app_private.action_execution_results(
    action_decision_id, status, executor, executor_ref,
    result_metadata, verification_metadata
  ) values (
    authorization_row.action_decision_id, 'executed', 'agent', agent_identity,
    jsonb_build_object(
      'provider', provider_value,
      'externalThreadRef', btrim(external_thread_value),
      'externalMessageRef', btrim(external_message_value),
      'communicationMessageId', message_id_value
    ),
    jsonb_build_object(
      'contentHashMatched', recomputed_hash = authorization_row.content_hash,
      'policyOutcome', decision_row.outcome,
      'identityVerified', authorization_row.identity_verified,
      'piiRedactedInAudit', true
    )
  );

  update app_private.agent_actions
  set status = 'completed', updated_at = now()
  where id = authorization_row.agent_action_id;
  update app_private.agent_message_authorizations
  set consumed_at = now()
  where id = authorization_row.id;

  insert into app_private.audit_events(
    actor, actor_ref, action_name, entity_type, entity_id,
    reason_code, redacted_changes, metadata
  ) values (
    'agent', agent_identity, 'agent.communication.record_outbound', 'communication_message', message_id_value,
    'authorized_support_email_sent',
    jsonb_build_object('sent', true, 'content_hash', authorization_row.content_hash),
    jsonb_build_object(
      'provider', provider_value,
      'message_category', authorization_row.message_category,
      'identity_verified', authorization_row.identity_verified,
      'recipient_email_redacted', true
    )
  );

  return jsonb_build_object(
    'threadId', thread_id_value,
    'messageId', message_id_value,
    'replayed', false,
    'authorizationConsumed', true
  );
end;
$$;

create or replace function api.agent_record_message_failure(
  agent_identity text,
  authorization_value uuid,
  failure_code text
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = pg_catalog, app_private
as $$
declare authorization_row app_private.agent_message_authorizations%rowtype;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_agent_identity(agent_identity);
  if failure_code is null or failure_code !~ '^[a-z][a-z0-9_]{2,79}$' then
    raise exception 'bounded failure code required' using errcode = '22023';
  end if;
  select * into authorization_row
  from app_private.agent_message_authorizations
  where id = authorization_value for update;
  if authorization_row.id is null or authorization_row.agent_ref <> agent_identity then
    raise exception 'authorization required' using errcode = '22023';
  end if;
  if authorization_row.consumed_at is not null then
    return jsonb_build_object('recorded', true, 'replayed', true);
  end if;

  insert into app_private.action_execution_results(
    action_decision_id, status, executor, executor_ref,
    result_metadata, verification_metadata
  ) values (
    authorization_row.action_decision_id, 'failed', 'agent', agent_identity,
    jsonb_build_object('failureCode', failure_code),
    jsonb_build_object('messageSent', false)
  );
  update app_private.agent_actions set status = 'failed', updated_at = now()
  where id = authorization_row.agent_action_id;
  update app_private.agent_message_authorizations set consumed_at = now()
  where id = authorization_row.id;
  return jsonb_build_object('recorded', true, 'status', 'failed');
end;
$$;

-- ---------------------------------------------------------------------------
-- Partner lead intake
-- ---------------------------------------------------------------------------


revoke execute on function api.agent_record_outbound_message(text,uuid,text,text,text,text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function api.agent_record_outbound_message(text,uuid,text,text,text,text,text,text,text,timestamptz) to service_role;
revoke execute on function api.agent_record_message_failure(text,uuid,text) from public, anon, authenticated;
grant execute on function api.agent_record_message_failure(text,uuid,text) to service_role;
