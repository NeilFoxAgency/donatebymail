-- Modern Supabase secret keys populate the consolidated JWT claims setting.
-- Retain compatibility with legacy service-role JWTs while denying other roles.
create or replace function app_private.assert_service_role()
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if coalesce(
    current_setting('request.jwt.claim.role', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    ''
  ) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function app_private.assert_service_role()
  from public, anon, authenticated;
grant execute on function app_private.assert_service_role() to service_role;
