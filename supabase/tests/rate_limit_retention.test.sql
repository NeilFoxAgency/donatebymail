begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
select set_config('request.jwt.claim.role','service_role',true);

select has_table('app_private','anonymous_rate_limits','anonymous throttling state remains private');
select has_index('app_private','anonymous_rate_limits','anonymous_rate_limits_window_started_idx','rate-limit retention can find old windows efficiently');
select has_function('api','prune_anonymous_rate_limits',array['integer'],'rate-limit retention uses a bounded service RPC');
select is(has_function_privilege('anon','api.prune_anonymous_rate_limits(integer)','execute'),false,'browser roles cannot prune rate-limit state');
select is(has_function_privilege('service_role','api.prune_anonymous_rate_limits(integer)','execute'),true,'the scheduler can prune rate-limit state');

insert into app_private.anonymous_rate_limits(bucket_hash,action_name,window_started_at,request_count)
values
  (repeat('a',64),'test_action',now()-interval '3 days',1),
  (repeat('b',64),'test_action',now()-interval '2 hours',1),
  (repeat('c',64),'test_action',now()-interval '4 days',1);
select throws_ok($$select api.prune_anonymous_rate_limits(0)$$,'22023','bounded prune batch required','retention refuses an invalid batch size');
select is(api.prune_anonymous_rate_limits(1),1,'retention deletes only one stale row per bounded batch');
select is((select count(*) from app_private.anonymous_rate_limits where window_started_at < now()-interval '2 days'),1::bigint,'a stale backlog remains available for the next bounded pass');
select is((select count(*) from app_private.anonymous_rate_limits where window_started_at >= now()-interval '2 days'),1::bigint,'current rate-limit windows are preserved');

select * from finish();
rollback;
