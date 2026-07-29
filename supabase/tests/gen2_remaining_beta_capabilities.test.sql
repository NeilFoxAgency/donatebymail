begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

select has_table('app_private','donation_shipments','donation shipments exist');
select has_table('app_private','proceeds_allocations','proceeds allocations exist');
select has_table('app_private','campaigns','campaign identity exists');
select has_table('app_private','campaign_revisions','campaign revisions exist');
select has_table('app_private','communication_messages','communication metadata exists');
select is((select count(*)::bigint from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='app_private' and c.relname in ('donation_shipments','device_sale_results',
  'donation_costs','proceeds_allocations','disbursements','campaigns','campaign_revisions',
  'campaign_assets','campaign_events','communication_threads','communication_messages')
  and not c.relrowsecurity),0::bigint,'RLS covers all new private tables');
select is(has_table_privilege('authenticated','app_private.campaigns','select'),false,
  'authenticated users cannot query campaigns directly');
select is(has_function_privilege('authenticated','api.partner_overview(uuid)','execute'),false,
  'authenticated users cannot bypass the Worker partner boundary');
select is(has_function_privilege('service_role','api.partner_overview(uuid)','execute'),true,
  'service role can execute the narrow partner RPC');

select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values
('81000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','alice@example.com','',now(),now(),now()),
('81000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bob@example.com','',now(),now(),now()),
('81000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','partner-a@example.com','',now(),now(),now()),
('81000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','partner-b@example.com','',now(),now(),now()),
('81000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin@example.com','',now(),now(),now());
insert into app_private.profiles(user_id) select id from auth.users where id::text like '81000000-%';
insert into app_private.staff_memberships(user_id,role,status,activated_at)
values('81000000-0000-4000-8000-000000000005','admin','active',now());
insert into app_private.organizations(id,name,slug,status,created_by)
values
('82000000-0000-4000-8000-000000000001','Charity A','charity-a','active','81000000-0000-4000-8000-000000000005'),
('82000000-0000-4000-8000-000000000002','Charity B','charity-b','active','81000000-0000-4000-8000-000000000005');
insert into app_private.organization_memberships(organization_id,user_id,role,status,activated_at)
values
('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000003','partner_admin','active',now()),
('82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000004','partner_admin','active',now());
insert into app_private.charities(id,pledge_id,canonical_name,status,verified_by,verified_at) values
('82000000-0000-4000-8000-000000000011','3685b542-61d5-45da-9580-162dca725966','Charity A','verified','81000000-0000-4000-8000-000000000005',now()),
('82000000-0000-4000-8000-000000000012','ec0b21fc-2671-431e-8a81-783b7a9626c9','Charity B','verified','81000000-0000-4000-8000-000000000005',now());
insert into app_private.organization_charities(organization_id,charity_id,status,verified_by,verified_at) values
('82000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000011','verified','81000000-0000-4000-8000-000000000005',now()),
('82000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000012','verified','81000000-0000-4000-8000-000000000005',now());

select lives_ok($$select api.partner_create_campaign(
  '81000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000001',
  'give-phones-a','Give Phones A','82000000-0000-4000-8000-000000000011',
  'Give an old phone','A short campaign summary','A factual campaign story.','Donate a Phone',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,
  'Charity A admin can create an isolated draft campaign');
select throws_ok($$select api.partner_campaign_detail(
  '81000000-0000-4000-8000-000000000004',(select id from app_private.campaigns where slug='give-phones-a'))$$,
  '42501','active organization membership required','Charity B cannot read Charity A campaign');
select throws_ok($$select api.partner_create_campaign(
  '81000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000001',
  'admin','Collision','82000000-0000-4000-8000-000000000011','Headline','Summary','Story',
  'Donate a Phone','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')$$,
  '23514','campaign slug is reserved or invalid','reserved application routes cannot become campaigns');
select is((api.get_public_campaign('give-phones-a') is null),true,'draft campaign is not public');
select lives_ok(format($$select api.staff_publish_campaign_revision(
  '81000000-0000-4000-8000-000000000005',%L::uuid,%L::uuid)$$,
  (select id from app_private.campaigns where slug='give-phones-a'),
  (select id from app_private.campaign_revisions where campaign_id=(select id from app_private.campaigns where slug='give-phones-a'))),
  'staff can publish an exact reviewed campaign revision');
select is(api.get_public_campaign('give-phones-a')->>'headline','Give an old phone',
  'public campaign resolves only its active immutable revision');
select lives_ok(format($$insert into app_private.campaign_route_aliases(root_slug,campaign_id,canonical_slug,created_by)
  values('phones-for-a',%L::uuid,'give-phones-a','81000000-0000-4000-8000-000000000005')$$,
  (select id from app_private.campaigns where slug='give-phones-a')),'safe root vanity alias can be added');
select is(api.resolve_campaign_alias('phones-for-a')->>'canonicalSlug','give-phones-a',
  'vanity alias resolves to canonical campaign');

create temporary table donor_created as select api.create_donation(
  '{"id":"DBM-CLIENT-PREVIEW","clientSubmissionKey":"83000000-0000-4000-8000-000000000099","shippingMethod":"label","donor":{"firstName":"Alice","middleName":"","lastName":"Donor","email":"alice@example.com","address1":"1 Main St","address2":"","city":"Kissimmee","state":"FL","zip":"34741","country":"US","marketingEmailConsent":false},"charity":{"pledgeId":"3685b542-61d5-45da-9580-162dca725966","name":"Charity A"},"devices":[{"id":"alice-phone","brand":"Apple","model":"iPhone","age":"2-3 years","condition":"Good","storage":"128 GB","powersOn":true,"unlocked":true}]}'::jsonb,
  '83000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000002',repeat('a',64),null) result;
select is(jsonb_array_length(api.donor_account_overview('81000000-0000-4000-8000-000000000001')->'donations'),0,
  'GET overview never implicitly claims an email-matching donation');
select lives_ok(format($$select api.claim_donation('81000000-0000-4000-8000-000000000001',%L::uuid,'alice@example.com')$$,
  (select result->>'donationId' from donor_created)),'verified donor explicitly claims a donation-specific capability');
select is(jsonb_array_length(api.donor_account_overview('81000000-0000-4000-8000-000000000001')->'donations'),1,
  'explicitly claimed donation appears in the account');
select lives_ok(format($$select api.donor_mark_donation_mailed(
  '81000000-0000-4000-8000-000000000001',%L::uuid,'USPS','940000000000')$$,
  (select result->>'donationId' from donor_created)),'donor can mark their own donation mailed');
select is((select status::text from app_private.donations where id=(select (result->>'donationId')::uuid from donor_created)),
  'in_transit','marking mailed advances only to in transit');
select is((api.donor_account_overview('81000000-0000-4000-8000-000000000001')
  ->'donations'->0->'shipment'->>'trackingLastFour'),'0000','donor overview redacts full tracking number');

select is(api.evaluate_agent_command('agent-beta','record_physical_receipt','donation',
  (select (result->>'donationId')::uuid from donor_created),'low','{}',repeat('c',64),gen_random_uuid(),'agent-deny-001')->>'outcome',
  'DENY','agent physical receipt remains prohibited regardless of requested risk');
select is(api.evaluate_agent_command('agent-beta','arbitrary_database_query','database',null,'low','{}',repeat('d',64),gen_random_uuid(),'agent-deny-002')->>'outcome',
  'DENY','agent arbitrary SQL remains prohibited');
select is(api.evaluate_agent_command('agent-beta','update_campaign_content','campaign',
  (select id from app_private.campaigns where slug='give-phones-a'),'low','{}',repeat('e',64),gen_random_uuid(),'agent-content-001')->>'outcome',
  'REQUIRE_APPROVAL','routine content command follows current beta policy rather than a permanent hard-code');
select is((select count(*)::bigint from app_private.action_decisions where actor_ref='agent-beta'),3::bigint,
  'all agent decisions are recorded');

select lives_ok(format($$select api.staff_record_sale_and_allocation(
  '81000000-0000-4000-8000-000000000005',%L::uuid,10000,'beta_test','sale-1',now())$$,
  (select id from app_private.donation_devices where donation_id=(select (result->>'donationId')::uuid from donor_created))),
  'staff can record a sale result through a narrow financial command');
select is((select status::text from app_private.proceeds_allocations limit 1),'policy_hold',
  'sale stays on policy hold when no approved policy snapshot exists');
select is((api.staff_financial_overview('81000000-0000-4000-8000-000000000005')->>'policyHolds')::integer > 0,
  true,'staff dashboard exposes operational policy holds');
select throws_ok($$update app_private.device_sale_results set gross_amount_cents=1$$,
  '55000','device_sale_results is append-only','recorded sale results cannot be rewritten');

select lives_ok(format($$select api.staff_record_cost(
  '81000000-0000-4000-8000-000000000005',%L::uuid,null,'shipping_materials',500,
  'receipt-beta',now())$$,(select (result->>'donationId')::uuid from donor_created)),
  'staff can record an evidenced cost candidate');
insert into app_private.proceeds_allocations(
  id,donation_id,policy_version_id,beneficiary_pledge_id,gross_cents,
  eligible_cost_cents,allocable_base_cents,share_basis_points,allocated_cents,
  status,calculated_by,calculated_at
) values(
  '84000000-0000-4000-8000-000000000001',
  (select (result->>'donationId')::uuid from donor_created),
  '10000000-0000-0000-0000-000000000002',
  '3685b542-61d5-45da-9580-162dca725966',10000,0,10000,5000,5000,
  'calculated','81000000-0000-4000-8000-000000000005',now()
);
select lives_ok($$select api.staff_prepare_disbursement(
  '81000000-0000-4000-8000-000000000005','84000000-0000-4000-8000-000000000001',
  5000,'Pledge Charity A','{"evidence":"beta"}'::jsonb)$$,
  'staff can prepare a manual disbursement from a calculated allocation');
select is((select status::text from app_private.disbursements where preparation_id=(
  select preparation_id from app_private.disbursement_preparation_allocations
  where allocation_id='84000000-0000-4000-8000-000000000001')),'prepared',
  'preparation does not imply approval');
select lives_ok(format($$select api.staff_decide_disbursement(
  '81000000-0000-4000-8000-000000000005',%L::uuid,'approved','Beta approval')$$,
  (select preparation_id from app_private.disbursement_preparation_allocations
   where allocation_id='84000000-0000-4000-8000-000000000001')),
  'single-staff beta approval follows configured policy');
select is((select status::text from app_private.disbursements where preparation_id=(
  select preparation_id from app_private.disbursement_preparation_allocations
  where allocation_id='84000000-0000-4000-8000-000000000001')),'approved',
  'configured approval count moves the record to approved');
select lives_ok(format($$select api.staff_record_disbursement_completion(
  '81000000-0000-4000-8000-000000000005',%L::uuid,'external-beta-payment-1')$$,
  (select preparation_id from app_private.disbursement_preparation_allocations
   where allocation_id='84000000-0000-4000-8000-000000000001')),
  'staff can record an externally executed payment without automated money movement');
select is((select status::text from app_private.disbursements where preparation_id=(
  select preparation_id from app_private.disbursement_preparation_allocations
  where allocation_id='84000000-0000-4000-8000-000000000001')),'completed',
  'external completion is retained in the manual ledger');
select is((select count(*)::integer from app_private.allocation_state_events
  where allocation_id='84000000-0000-4000-8000-000000000001' and status='disbursed'),
  1,'allocation state history records disbursement append-only');

select * from finish();
rollback;
