create or replace function api.agent_record_inbound_message(
  agent_identity text,
  provider_value text,
  external_thread_value text,
  external_message_value text,
  sender_email text,
  recipient_emails jsonb,
  subject_value text,
  body_summary_value text,
  body_storage_value text default null,
  occurred_at_value timestamptz default now(),
  candidate_donation_id uuid default null,
  candidate_organization_id uuid default null,
  candidate_campaign_id uuid default null
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = pg_catalog, app_private, auth
as $$
declare
  normalized_sender text := lower(btrim(coalesce(sender_email, '')));
  linked_donation uuid;
  linked_organization uuid;
  linked_campaign uuid;
  thread_id_value uuid;
  message_id_value uuid;
  existing_message uuid;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_agent_identity(agent_identity);
  if provider_value not in ('gmail','brevo','manual')
    or char_length(btrim(coalesce(external_thread_value, ''))) not between 1 and 300
    or char_length(btrim(coalesce(external_message_value, ''))) not between 1 and 300
    or normalized_sender !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or jsonb_typeof(recipient_emails) <> 'array'
    or char_length(btrim(coalesce(subject_value, ''))) > 500
    or char_length(btrim(coalesce(body_summary_value, ''))) not between 1 and 2000
    or occurred_at_value is null
  then
    raise exception 'bounded communication inputs required' using errcode = '22023';
  end if;

  if candidate_donation_id is not null and exists(
    select 1
    from app_private.donations d
    join app_private.donor_contacts c on c.id = d.donor_contact_id
    where d.id = candidate_donation_id and c.email_search = normalized_sender
  ) then
    linked_donation := candidate_donation_id;
  end if;

  if candidate_organization_id is not null and (
    exists(
      select 1
      from app_private.organization_memberships m
      join auth.users u on u.id = m.user_id
      where m.organization_id = candidate_organization_id
        and m.status = 'active'
        and lower(u.email) = normalized_sender
    ) or exists(
      select 1 from app_private.partner_invitations i
      where i.organization_id = candidate_organization_id
        and i.email_search = normalized_sender
        and i.status = 'invited'
    )
  ) then
    linked_organization := candidate_organization_id;
  end if;

  if candidate_campaign_id is not null and linked_organization is not null and exists(
    select 1 from app_private.campaigns c
    where c.id = candidate_campaign_id and c.organization_id = linked_organization
  ) then
    linked_campaign := candidate_campaign_id;
  end if;

  insert into app_private.communication_threads(
    donation_id, organization_id, campaign_id,
    external_provider, external_thread_ref, subject,
    last_message_at, contact_email_search, status
  ) values (
    linked_donation, linked_organization, linked_campaign,
    provider_value, btrim(external_thread_value), nullif(btrim(subject_value), ''),
    occurred_at_value, normalized_sender, 'open'
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
    status = case when app_private.communication_threads.status in ('resolved','closed') then 'open' else app_private.communication_threads.status end
  returning id into thread_id_value;

  select id into existing_message
  from app_private.communication_messages
  where thread_id = thread_id_value and external_message_ref = btrim(external_message_value);
  if existing_message is not null then
    return jsonb_build_object(
      'threadId', thread_id_value,
      'messageId', existing_message,
      'replayed', true,
      'donationLinked', linked_donation is not null,
      'organizationLinked', linked_organization is not null
    );
  end if;

  insert into app_private.communication_messages(
    thread_id, direction, external_message_ref,
    sender_identity_ref, recipient_identity_refs,
    body_summary, body_storage_ref, sent_at
  ) values (
    thread_id_value, 'inbound', btrim(external_message_value),
    normalized_sender, recipient_emails,
    btrim(body_summary_value), nullif(btrim(body_storage_value), ''), occurred_at_value
  ) returning id into message_id_value;

  insert into app_private.audit_events(
    actor, actor_ref, action_name, entity_type, entity_id,
    reason_code, redacted_changes, metadata
  ) values (
    'agent', agent_identity, 'agent.communication.record_inbound', 'communication_thread', thread_id_value,
    'inbox_journal_update', jsonb_build_object('message_recorded', true),
    jsonb_build_object(
      'provider', provider_value,
      'donation_linked', linked_donation is not null,
      'organization_linked', linked_organization is not null,
      'message_body_not_duplicated', body_storage_value is not null
    )
  );

  return jsonb_build_object(
    'threadId', thread_id_value,
    'messageId', message_id_value,
    'replayed', false,
    'donationLinked', linked_donation is not null,
    'organizationLinked', linked_organization is not null
  );
end;
$$;

revoke execute on function api.agent_record_inbound_message(text,text,text,text,text,jsonb,text,text,text,timestamptz,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function api.agent_record_inbound_message(text,text,text,text,text,jsonb,text,text,text,timestamptz,uuid,uuid,uuid) to service_role;
