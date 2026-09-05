-- Replaying an inbound provider event must be a read-only, exact retry. The
-- previous implementation performed the thread upsert before checking for an
-- existing message, which could reopen a resolved thread on a duplicate.
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
  existing_sender text;
  existing_recipients jsonb;
  existing_body_summary text;
  existing_body_storage text;
  existing_thread_donation uuid;
  existing_thread_organization uuid;
  existing_thread_contact text;
  existing_thread_inbound_verified boolean;
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

  -- Lock an existing thread before checking its message. This makes a
  -- duplicate retry observe the committed first write and prevents a retry
  -- from changing status, links, or timestamps.
  select t.id, t.donation_id, t.organization_id, t.contact_email_search, t.inbound_verified
    into thread_id_value, existing_thread_donation, existing_thread_organization,
      existing_thread_contact, existing_thread_inbound_verified
  from app_private.communication_threads t
  where t.external_provider = provider_value
    and t.external_thread_ref = btrim(external_thread_value)
  for update;
  if thread_id_value is not null and existing_thread_inbound_verified
    and existing_thread_contact is distinct from normalized_sender
  then
    raise exception 'verified inbound sender mismatch' using errcode = '42501';
  end if;
  if thread_id_value is not null then
    select m.id, m.sender_identity_ref, m.recipient_identity_refs,
      m.body_summary, m.body_storage_ref
      into existing_message, existing_sender, existing_recipients,
        existing_body_summary, existing_body_storage
    from app_private.communication_messages m
    where m.thread_id = thread_id_value
      and m.external_message_ref = btrim(external_message_value);
    if existing_message is not null then
      if existing_sender is distinct from normalized_sender
        or existing_recipients is distinct from recipient_emails
        or existing_body_summary is distinct from btrim(body_summary_value)
        or existing_body_storage is distinct from nullif(btrim(body_storage_value), '')
      then
        raise exception 'inbound replay payload mismatch' using errcode = '23505';
      end if;
      return jsonb_build_object(
        'threadId', thread_id_value,
        'messageId', existing_message,
        'replayed', true,
        'donationLinked', existing_thread_donation is not null,
        'organizationLinked', existing_thread_organization is not null
      );
    end if;
  end if;

  -- Reset the target before the conflict-safe insert. PL/pgSQL does not make
  -- a zero-row `RETURNING` assignment a reliable signal across versions.
  thread_id_value := null;
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
  do nothing
  returning id into thread_id_value;

  if thread_id_value is null then
    -- A concurrent writer may have created the thread after the initial
    -- lookup. Waiting on this row lock makes the replay check observe the
    -- committed message before any thread fields are changed.
    select t.id, t.donation_id, t.organization_id, t.contact_email_search, t.inbound_verified
      into thread_id_value, existing_thread_donation, existing_thread_organization,
        existing_thread_contact, existing_thread_inbound_verified
    from app_private.communication_threads t
    where t.external_provider = provider_value
      and t.external_thread_ref = btrim(external_thread_value)
    for update;
    if thread_id_value is null then
      raise exception 'communication thread could not be recovered' using errcode = '55000';
    end if;
    if existing_thread_inbound_verified
      and existing_thread_contact is distinct from normalized_sender
    then
      raise exception 'verified inbound sender mismatch' using errcode = '42501';
    end if;
  end if;

  select id into existing_message
  from app_private.communication_messages
  where thread_id = thread_id_value and external_message_ref = btrim(external_message_value);
  if existing_message is not null then
    -- A concurrent writer won between the initial lookup and the upsert. The
    -- row must still match exactly; do not report a spoofed replay as linked.
    select m.sender_identity_ref, m.recipient_identity_refs,
      m.body_summary, m.body_storage_ref
      into existing_sender, existing_recipients, existing_body_summary, existing_body_storage
    from app_private.communication_messages m
    where m.id = existing_message;
    if existing_sender is distinct from normalized_sender
      or existing_recipients is distinct from recipient_emails
      or existing_body_summary is distinct from btrim(body_summary_value)
      or existing_body_storage is distinct from nullif(btrim(body_storage_value), '')
    then
      raise exception 'inbound replay payload mismatch' using errcode = '23505';
    end if;
    select donation_id, organization_id
      into existing_thread_donation, existing_thread_organization
    from app_private.communication_threads
    where id = thread_id_value;
    return jsonb_build_object(
      'threadId', thread_id_value,
      'messageId', existing_message,
      'replayed', true,
      'donationLinked', existing_thread_donation is not null,
      'organizationLinked', existing_thread_organization is not null
    );
  end if;

  -- Only a genuinely new provider message may advance the thread or reopen a
  -- resolved/closed conversation. Preserve the first sender identity so an
  -- untrusted journal retry cannot retarget a provider-attested thread.
  update app_private.communication_threads
  set donation_id = coalesce(donation_id, linked_donation),
      organization_id = coalesce(organization_id, linked_organization),
      campaign_id = coalesce(campaign_id, linked_campaign),
      subject = coalesce(nullif(btrim(subject_value), ''), subject),
      last_message_at = greatest(last_message_at, occurred_at_value),
      contact_email_search = coalesce(contact_email_search, normalized_sender),
      status = case when status in ('resolved','closed') then 'open' else status end
  where id = thread_id_value;

  select donation_id, organization_id
    into existing_thread_donation, existing_thread_organization
  from app_private.communication_threads
  where id = thread_id_value;

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
      'donation_linked', existing_thread_donation is not null,
      'organization_linked', existing_thread_organization is not null,
      'message_body_not_duplicated', body_storage_value is not null
    )
  );

  return jsonb_build_object(
    'threadId', thread_id_value,
    'messageId', message_id_value,
    'replayed', false,
    'donationLinked', existing_thread_donation is not null,
    'organizationLinked', existing_thread_organization is not null
  );
end;
$$;

revoke execute on function api.agent_record_inbound_message(text,text,text,text,text,jsonb,text,text,text,timestamptz,uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function api.agent_record_inbound_message(text,text,text,text,text,jsonb,text,text,text,timestamptz,uuid,uuid,uuid)
  to service_role;

create or replace function api.agent_contract_version()
returns jsonb
language plpgsql
security definer
volatile
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.assert_service_role();
  if to_regprocedure('app_private.assert_current_agent_message_context(uuid)') is null
    or to_regprocedure('api.agent_authorize_support_message_payload(text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,boolean,boolean,boolean,boolean,boolean)') is null
    or to_regprocedure('api.agent_record_outbound_message_checked(text,uuid,text,text,text,text,text,text,text,timestamptz,text)') is null
    or to_regprocedure('api.agent_record_message_failure(text,uuid,text)') is null
    or to_regprocedure('api.agent_set_communication_thread_status(text,uuid,text)') is null
    or to_regprocedure('api.agent_record_inbound_message(text,text,text,text,text,jsonb,text,text,text,timestamptz,uuid,uuid,uuid)') is null
    or to_regprocedure('api.prune_anonymous_rate_limits(integer)') is null
  then
    raise exception 'agent contract incomplete' using errcode = '55000';
  end if;
  return jsonb_build_object(
    'contractVersion', '20260808150002',
    'agentIdentity', 'donate-by-mail-operations-agent-v1'
  );
end;
$$;

revoke all on function api.agent_contract_version() from public, anon, authenticated;
grant execute on function api.agent_contract_version() to service_role;
