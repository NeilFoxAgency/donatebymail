alter table app_private.communication_threads
  add column if not exists inbound_verified boolean not null default false;

-- The workspace agent may journal provider data, but it cannot make that data
-- authoritative by writing the journal itself. A trusted provider-ingestion
-- adapter must attest a thread before an identity-free automatic reply can use
-- it. Existing and agent-created threads remain unverified by default.
create or replace function app_private.require_support_message_context()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  if new.outcome = 'ALLOW_AUTOMATICALLY'
    and new.donation_id is null
    and new.organization_id is null
    and new.campaign_id is null
    and not (new.message_category = 'internal_escalation' and new.recipient_email_search = 'tre@donatebymail.org')
    and not exists (
      select 1
      from app_private.communication_threads t
      where t.contact_email_search = new.recipient_email_search
        and t.inbound_verified is true
        and t.status in ('open', 'waiting_on_contact', 'waiting_on_staff')
    )
  then
    raise exception 'verified communication context required' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function app_private.require_support_message_context() from public, anon, authenticated;
grant execute on function app_private.require_support_message_context() to service_role;
