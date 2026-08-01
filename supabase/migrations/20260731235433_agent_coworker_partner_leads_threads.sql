create or replace function api.agent_create_partner_lead(
  agent_identity text,
  requester_email text,
  organization_name_value text,
  request_summary_value text,
  idempotency_value text,
  correlation_value uuid default null,
  website_url_value text default null,
  audience_summary_value text default null,
  goal_summary_value text default null,
  timing_summary_value text default null,
  external_thread_value text default null
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = pg_catalog, app_private, extensions
as $$
declare
  normalized_email text := lower(btrim(coalesce(requester_email, '')));
  normalized_name text := btrim(coalesce(organization_name_value, ''));
  normalized_website text := nullif(btrim(coalesce(website_url_value, '')), '');
  input_hash_value text;
  decision jsonb;
  lead_id_value uuid;
  existing_lead uuid;
  action_id_value uuid;
  lead_created boolean := false;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_agent_identity(agent_identity);
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or char_length(normalized_name) not between 1 and 200
    or char_length(btrim(coalesce(request_summary_value, ''))) not between 1 and 4000
    or char_length(btrim(coalesce(idempotency_value, ''))) not between 8 and 200
    or (normalized_website is not null and (
      char_length(normalized_website) > 1000 or normalized_website !~ '^https?://'
    ))
    or char_length(coalesce(audience_summary_value, '')) > 2000
    or char_length(coalesce(goal_summary_value, '')) > 2000
    or char_length(coalesce(timing_summary_value, '')) > 2000
    or char_length(coalesce(external_thread_value, '')) > 300
  then
    raise exception 'bounded partner lead inputs required' using errcode = '22023';
  end if;

  input_hash_value := encode(
    extensions.digest(
      convert_to(jsonb_build_object(
        'email', normalized_email,
        'organizationName', normalized_name,
        'websiteUrl', normalized_website,
        'audience', audience_summary_value,
        'goal', goal_summary_value,
        'timing', timing_summary_value,
        'requestSummary', request_summary_value,
        'externalThreadRef', external_thread_value
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  decision := api.evaluate_agent_command(
    agent_identity,
    'create_partner_lead',
    'partner_lead',
    null,
    'low',
    jsonb_build_object(
      'requesterEmailRedacted', true,
      'organizationName', normalized_name,
      'hasWebsite', normalized_website is not null,
      'noRoleGrant', true,
      'noCampaignPublication', true
    ),
    input_hash_value,
    coalesce(correlation_value, gen_random_uuid()),
    idempotency_value
  );

  if decision ->> 'outcome' <> 'ALLOW_AUTOMATICALLY' then
    return decision || jsonb_build_object('created', false);
  end if;

  action_id_value := (decision ->> 'agentActionId')::uuid;
  select id into existing_lead
  from app_private.partner_leads
  where agent_action_id = action_id_value;
  if existing_lead is not null then
    return decision || jsonb_build_object('created', false, 'replayed', true, 'leadId', existing_lead);
  end if;

  select id into existing_lead
  from app_private.partner_leads
  where requester_email_search = normalized_email
    and lower(organization_name) = lower(normalized_name)
    and status in ('new','qualified','waiting_on_partner','ready_for_admin')
  order by updated_at desc
  limit 1
  for update;

  if existing_lead is not null then
    update app_private.partner_leads
    set website_url = coalesce(normalized_website, website_url),
      audience_summary = coalesce(nullif(btrim(audience_summary_value), ''), audience_summary),
      goal_summary = coalesce(nullif(btrim(goal_summary_value), ''), goal_summary),
      timing_summary = coalesce(nullif(btrim(timing_summary_value), ''), timing_summary),
      request_summary = btrim(request_summary_value),
      external_thread_ref = coalesce(nullif(btrim(external_thread_value), ''), external_thread_ref),
      agent_action_id = action_id_value,
      created_by_agent_ref = agent_identity,
      updated_at = now()
    where id = existing_lead;
    lead_id_value := existing_lead;
  else
    insert into app_private.partner_leads(
      requester_email_search, organization_name, website_url,
      audience_summary, goal_summary, timing_summary,
      request_summary, external_thread_ref,
      agent_action_id, created_by_agent_ref
    ) values (
      normalized_email, normalized_name, normalized_website,
      nullif(btrim(audience_summary_value), ''),
      nullif(btrim(goal_summary_value), ''),
      nullif(btrim(timing_summary_value), ''),
      btrim(request_summary_value),
      nullif(btrim(external_thread_value), ''),
      action_id_value, agent_identity
    ) returning id into lead_id_value;
    lead_created := true;
  end if;

  insert into app_private.action_execution_results(
    action_decision_id, status, executor, executor_ref,
    result_metadata, verification_metadata
  ) values (
    (decision ->> 'decisionId')::uuid, 'executed', 'agent', agent_identity,
    jsonb_build_object('partnerLeadId', lead_id_value),
    jsonb_build_object('noRoleGranted', true, 'noCampaignPublished', true, 'piiRedactedInAudit', true)
  );
  update app_private.agent_actions set status = 'completed', updated_at = now()
  where id = action_id_value;

  insert into app_private.audit_events(
    actor, actor_ref, action_name, entity_type, entity_id,
    reason_code, redacted_changes, metadata
  ) values (
    'agent', agent_identity, 'agent.partner.create_lead', 'partner_lead', lead_id_value,
    'bounded_partner_intake', jsonb_build_object('status', 'new'),
    jsonb_build_object('requester_email_redacted', true, 'no_access_granted', true)
  );

  return decision || jsonb_build_object(
    'created', lead_created,
    'updated', not lead_created,
    'replayed', false,
    'leadId', lead_id_value,
    'nextHumanGate', 'An administrator must verify the charity, create or activate the organization, and grant partner access.'
  );
end;
$$;


create or replace function api.agent_set_communication_thread_status(
  agent_identity text,
  candidate_thread_id uuid,
  status_value text
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = pg_catalog, app_private
as $$
declare old_status text;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_agent_identity(agent_identity);
  if status_value not in ('open','waiting_on_contact','waiting_on_staff','resolved','closed') then
    raise exception 'bounded thread status required' using errcode = '22023';
  end if;
  select status into old_status
  from app_private.communication_threads
  where id = candidate_thread_id
  for update;
  if old_status is null then
    raise exception 'communication thread not found' using errcode = '22023';
  end if;
  update app_private.communication_threads
  set status = status_value
  where id = candidate_thread_id;
  insert into app_private.audit_events(
    actor, actor_ref, action_name, entity_type, entity_id,
    reason_code, redacted_changes, metadata
  ) values (
    'agent', agent_identity, 'agent.communication.change_thread_status',
    'communication_thread', candidate_thread_id,
    'bounded_support_thread_update',
    jsonb_build_object('status', jsonb_build_object('from', old_status, 'to', status_value)),
    '{}'::jsonb
  );
  return jsonb_build_object('threadId', candidate_thread_id, 'status', status_value);
end;
$$;

-- ---------------------------------------------------------------------------
-- Generic policy evaluation may not mint an auto-send authorization. Exact
-- support messages must pass through api.agent_authorize_support_message,
-- which validates category, identity, target, and content hash.
-- ---------------------------------------------------------------------------

revoke execute on function api.agent_create_partner_lead(text,text,text,text,text,uuid,text,text,text,text,text) from public, anon, authenticated;
grant execute on function api.agent_create_partner_lead(text,text,text,text,text,uuid,text,text,text,text,text) to service_role;
revoke execute on function api.agent_set_communication_thread_status(text,uuid,text) from public, anon, authenticated;
grant execute on function api.agent_set_communication_thread_status(text,uuid,text) to service_role;
