begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
select set_config('request.jwt.claim.role','service_role',true);

insert into app_private.domain_events(id,event_type,aggregate_type,aggregate_id,aggregate_version,payload)
values('c1000000-0000-4000-8000-000000000001','test.outbox_created','donation',
  'c1000000-0000-4000-8000-000000000002',1,'{}'::jsonb);
insert into app_private.outbox_events(id,domain_event_id,handler_key,event_type,payload)
values('c1000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000001',
  'donation_notifications','test.outbox_created','{}'::jsonb);

select is(api.outbox_handler_receipt_exists('c1000000-0000-4000-8000-000000000003','donation_donor_confirmation'),false,
  'recipient delivery starts without a receipt');
select is(api.record_outbox_handler_receipt('c1000000-0000-4000-8000-000000000003','donation_donor_confirmation',
  '{"provider":"brevo"}'::jsonb),true,'successful recipient delivery records a receipt');
select is(api.outbox_handler_receipt_exists('c1000000-0000-4000-8000-000000000003','donation_donor_confirmation'),true,
  'recipient receipt is visible to the service worker');
select is(api.record_outbox_handler_receipt('c1000000-0000-4000-8000-000000000003','donation_donor_confirmation'),true,
  'recording the same recipient receipt is idempotent');
select is((select count(*) from app_private.outbox_handler_receipts where outbox_event_id='c1000000-0000-4000-8000-000000000003'),1::bigint,
  'recipient receipt replay creates one durable row');
select throws_ok($$select api.record_outbox_handler_receipt('c1000000-0000-4000-8000-000000000003','bad handler')$$,
  '22023','bounded outbox handler receipt required','invalid handler names fail closed');
select is(has_function_privilege('anon','api.outbox_handler_receipt_exists(uuid,text)','execute'),false,
  'anonymous users cannot inspect delivery receipts');
select is(has_function_privilege('authenticated','api.record_outbox_handler_receipt(uuid,text,jsonb)','execute'),false,
  'authenticated users cannot forge delivery receipts');

select * from finish();
rollback;
