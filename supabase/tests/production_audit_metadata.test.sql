begin;
create extension if not exists pgtap with schema extensions;
select plan(2);
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
      and p.prokind = 'f'
      and lower(pg_get_functiondef(p.oid)) like '%environment%beta%'
  ),
  0::bigint,
  'API functions do not stamp beta as the production audit environment'
);
select is(
  (select count(*) from app_private.audit_events where metadata ->> 'environment' = 'beta'),
  0::bigint,
  'clean database audit events contain no beta environment marker'
);

select * from finish();
rollback;
