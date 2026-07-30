-- Pending partner invitations are allowed to bootstrap the invited Supabase
-- identity on its first passwordless sign-in. The invitation email remains the
-- proof-of-possession boundary, and the callback activates the invitation only
-- after Supabase verifies that same address.
create or replace function api.is_invited_partner_email(candidate_email text)
returns boolean
language plpgsql
security definer
stable
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.assert_service_role();
  return exists (
    select 1
    from app_private.partner_invitations i
    join app_private.organizations o on o.id = i.organization_id
    where lower(i.email_search) = lower(trim(candidate_email))
      and i.status = 'invited'
      and o.status = 'active'
  );
end;
$$;

revoke execute on function api.is_invited_partner_email(text) from public, anon, authenticated;
grant execute on function api.is_invited_partner_email(text) to service_role;
