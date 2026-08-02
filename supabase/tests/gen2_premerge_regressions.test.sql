begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
select set_config('request.jwt.claim.role','service_role',true);

select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='api' and p.prosecdef and has_function_privilege('anon',p.oid,'execute')),0::bigint,
  'anonymous browser role cannot execute any API SECURITY DEFINER function');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='api' and p.prosecdef and has_function_privilege('authenticated',p.oid,'execute')),0::bigint,
  'authenticated browser role cannot execute any API SECURITY DEFINER function');
select ok((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='api' and p.prosecdef and has_function_privilege('service_role',p.oid,'execute'))>0,
  'service role retains the narrow privileged RPC surface');
select is(has_function_privilege('anon','api.partner_create_campaign_revision(uuid,uuid,text,text,text,text,uuid,uuid,text,jsonb)','execute'),false,
  'anonymous cannot invoke the ten-argument revision RPC');
select is(has_function_privilege('authenticated','api.partner_create_campaign_revision(uuid,uuid,text,text,text,text,uuid,uuid,text,jsonb)','execute'),false,
  'authenticated cannot invoke the ten-argument revision RPC');
select is(has_function_privilege('service_role','api.partner_create_campaign_revision(uuid,uuid,text,text,text,text,uuid,uuid,text,jsonb)','execute'),true,
  'service role can invoke the ten-argument revision RPC');
select is(to_regprocedure('api.partner_create_campaign_asset(uuid,uuid,text,text,text,integer,text)'),null,
  'digest-less asset overload remains unavailable');
select is((select pg_get_functiondef(p.oid) like '%donation_notifications%'
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='api' and p.proname='staff_change_donation_status' limit 1),true,
  'status changes enqueue the Worker-supported notification handler');
select ok(app_private.validate_campaign_blocks('[{"type":"text","content":{"body":"A plain paragraph"}}]'::jsonb),'valid text block accepted');
select ok(not app_private.validate_campaign_blocks('[{"type":"text","content":{"body":"x","unknown":"y"}}]'::jsonb),'unknown block fields rejected');
select ok(not app_private.validate_campaign_blocks('[{"type":"quote","content":{"body":{"nested":true}}}]'::jsonb),'nested arbitrary block values rejected');
select ok(not app_private.validate_campaign_blocks('[{"type":"callout","content":{"body":"https://example.com"}}]'::jsonb),'URLs in plaintext blocks rejected');

select * from finish();
rollback;
