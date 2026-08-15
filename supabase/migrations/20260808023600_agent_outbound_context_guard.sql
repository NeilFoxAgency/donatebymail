create or replace function app_private.require_support_message_context()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  -- An automatic message without an exact donor/partner identity must be a
  -- reply to a provider-attested communication thread. The approved internal
  -- escalation recipient is the only intentional exception.
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

drop trigger if exists agent_message_authorization_context_guard on app_private.agent_message_authorizations;
create trigger agent_message_authorization_context_guard
before insert on app_private.agent_message_authorizations
for each row execute function app_private.require_support_message_context();

revoke all on function app_private.require_support_message_context() from public, anon, authenticated;
grant execute on function app_private.require_support_message_context() to service_role;
