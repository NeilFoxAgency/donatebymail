-- Defense in depth for environments that already applied the first context
-- guard migration: an automatic authorization must independently verify every
-- supplied donation, organization, and campaign context. A valid donation
-- must not make an unrelated partner context trustworthy by association.
create or replace function app_private.guard_agent_message_context_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app_private, auth
as $$
declare normalized_email text := lower(btrim(coalesce(new.recipient_email_search, '')));
begin
  if new.outcome = 'ALLOW_AUTOMATICALLY' then
    if new.donation_id is not null and not exists (
      select 1
      from app_private.donations d
      join app_private.donor_contacts c on c.id = d.donor_contact_id
      where d.id = new.donation_id and c.email_search = normalized_email
    ) then
      raise exception 'verified communication context required' using errcode = '42501';
    end if;

    if new.organization_id is not null and not exists (
      select 1
      from app_private.organization_memberships m
      join app_private.organizations o on o.id = m.organization_id
      join auth.users u on u.id = m.user_id
      where m.organization_id = new.organization_id
        and o.status = 'active'
        and m.status = 'active' and lower(u.email) = normalized_email
    ) and not exists (
      select 1
      from app_private.organizations o
      join app_private.partner_invitations i on i.organization_id = o.id
      where o.id = new.organization_id and o.status = 'active'
        and i.status = 'invited' and i.email_search = normalized_email
        and i.revoked_at is null and i.expires_at > now() and not i.accepted_once
    ) then
      raise exception 'verified communication context required' using errcode = '42501';
    end if;

    if new.campaign_id is not null and (
      new.organization_id is null or not exists (
        select 1
        from app_private.campaigns c
        where c.id = new.campaign_id and c.organization_id = new.organization_id
      )
    ) then
      raise exception 'campaign and organization context do not match' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_agent_message_context_identity() from public, anon, authenticated;
grant execute on function app_private.guard_agent_message_context_identity() to service_role;

drop trigger if exists agent_message_context_identity_guard on app_private.agent_message_authorizations;
create trigger agent_message_context_identity_guard
before insert or update on app_private.agent_message_authorizations
for each row execute function app_private.guard_agent_message_context_identity();
