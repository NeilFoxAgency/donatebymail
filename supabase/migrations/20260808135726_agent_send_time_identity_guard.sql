-- Authorization is intentionally short-lived, but partner membership and
-- provider attestations can be revoked before the provider sends. Re-check
-- the exact context at journal time so a stale authorization cannot become an
-- outbound message after its identity basis has disappeared.
create or replace function app_private.assert_current_agent_message_context(
  authorization_value uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, app_private, auth
as $$
declare
  authorization_row app_private.agent_message_authorizations%rowtype;
begin
  select * into authorization_row
  from app_private.agent_message_authorizations
  where id = authorization_value;
  if authorization_row.id is null then
    raise exception 'valid message authorization required' using errcode = '22023';
  end if;

  if authorization_row.donation_id is not null and not exists (
    select 1
    from app_private.donations d
    join app_private.donor_contacts c on c.id = d.donor_contact_id
    where d.id = authorization_row.donation_id
      and c.email_search = authorization_row.recipient_email_search
  ) then
    raise exception 'verified communication context required' using errcode = '42501';
  end if;

  if authorization_row.organization_id is not null and not exists (
    select 1
    from app_private.organizations o
    where o.id = authorization_row.organization_id
      and o.status = 'active'
      and (
        exists (
          select 1
          from app_private.organization_memberships m
          join auth.users u on u.id = m.user_id
          where m.organization_id = o.id
            and m.status = 'active'
            and lower(u.email) = authorization_row.recipient_email_search
        )
        or exists (
          select 1
          from app_private.partner_invitations i
          where i.organization_id = o.id
            and i.status = 'invited'
            and i.email_search = authorization_row.recipient_email_search
            and i.revoked_at is null
            and i.expires_at > now()
            and not i.accepted_once
        )
      )
  ) then
    raise exception 'verified communication context required' using errcode = '42501';
  end if;

  if authorization_row.campaign_id is not null and (
    authorization_row.organization_id is null
    or not exists (
      select 1
      from app_private.campaigns c
      where c.id = authorization_row.campaign_id
        and c.organization_id = authorization_row.organization_id
    )
  ) then
    raise exception 'campaign and organization context do not match' using errcode = '22023';
  end if;

  if authorization_row.donation_id is null
    and authorization_row.organization_id is null
    and authorization_row.campaign_id is null
    and not (
      authorization_row.message_category = 'internal_escalation'
      and authorization_row.recipient_email_search = 'tre@donatebymail.org'
    )
    and not exists (
      select 1
      from app_private.communication_threads t
      where t.contact_email_search = authorization_row.recipient_email_search
        and t.inbound_verified is true
        and t.status in ('open', 'waiting_on_contact', 'waiting_on_staff')
    )
  then
    raise exception 'verified communication context required' using errcode = '42501';
  end if;
end;
$$;

revoke all on function app_private.assert_current_agent_message_context(uuid)
  from public, anon, authenticated;
grant execute on function app_private.assert_current_agent_message_context(uuid)
  to service_role;

create or replace function api.agent_record_outbound_message_checked(
  agent_identity text,
  authorization_value uuid,
  subject_value text,
  body_value text,
  content_hash_value text,
  provider_value text,
  external_thread_value text,
  external_message_value text,
  sender_identity_value text,
  sent_at_value timestamptz default now(),
  recipient_email_value text default null
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = pg_catalog, app_private
as $$
declare
  expected_email text;
  normalized_email text := lower(btrim(coalesce(recipient_email_value, '')));
begin
  perform app_private.assert_service_role();
  perform app_private.assert_agent_identity(agent_identity);
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'authorized recipient email required' using errcode = '22023';
  end if;
  select recipient_email_search into expected_email
  from app_private.agent_message_authorizations
  where id = authorization_value and agent_ref = agent_identity;
  if expected_email is null or normalized_email <> expected_email then
    raise exception 'provider recipient does not match authorization' using errcode = '22023';
  end if;
  perform app_private.assert_current_agent_message_context(authorization_value);
  return api.agent_record_outbound_message(
    agent_identity, authorization_value, subject_value, body_value,
    content_hash_value, provider_value, external_thread_value,
    external_message_value, sender_identity_value, sent_at_value
  );
end;
$$;

revoke execute on function api.agent_record_outbound_message_checked(
  text, uuid, text, text, text, text, text, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function api.agent_record_outbound_message_checked(
  text, uuid, text, text, text, text, text, text, text, timestamptz, text
) to service_role;
