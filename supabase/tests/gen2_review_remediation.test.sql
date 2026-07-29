begin;
create extension if not exists pgtap with schema extensions;
select plan(49);
select set_config('request.jwt.claim.role','service_role',true);

select has_table('app_private','auth_login_attempts','server-side cross-device PKCE state exists');
select has_table('app_private','donation_claim_capabilities','one-time donation claims exist');
select has_table('app_private','charities','canonical charities exist');
select has_table('app_private','organization_charities','verified organization-charity links exist');
select has_table('app_private','cost_allocation_applications','cost allocation evidence exists');
select is(has_table_privilege('authenticated','app_private.auth_login_attempts','select'),false,'browser roles cannot read PKCE verifier state');
select is(has_function_privilege('anon','api.claim_donation(uuid,uuid,text)','execute'),false,'claims are Worker-only RPCs');

select lives_ok($$select api.create_auth_login_attempt(repeat('a',64),'/account','{"pkce":"server-only"}',now()+interval '10 minutes')$$,
  'cross-device PKCE state can be persisted by the BFF');
select is(api.consume_auth_login_attempt(repeat('a',64))->>'destination','/account','a different browser callback can consume state');
select is(api.consume_auth_login_attempt(repeat('a',64)),null,'PKCE callback state is one-time');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('91000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','claim@example.com','',now(),now(),now()),
('91000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','other@example.com','',now(),now(),now()),
('91000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','recycled@example.com','',now(),now(),now()),
('91000000-0000-4000-8000-000000000010','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff1@example.com','',now(),now(),now()),
('91000000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff2@example.com','',now(),now(),now()),
('91000000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff3@example.com','',now(),now(),now()),
('91000000-0000-4000-8000-000000000020','00000000-0000-0000-0000-000000000000','authenticated','authenticated','partner@example.com','',now(),now(),now());
insert into app_private.profiles(user_id) select id from auth.users where id::text like '91000000-%';
insert into app_private.staff_memberships(user_id,role,status,activated_at) values
('91000000-0000-4000-8000-000000000010','admin','active',now()),
('91000000-0000-4000-8000-000000000011','admin','active',now()),
('91000000-0000-4000-8000-000000000012','admin','active',now());

create temporary table claim_donation as select api.create_donation(
  '{"id":"DBM-PREVIEW","clientSubmissionKey":"91000000-0000-4000-8000-000000000099","shippingMethod":"label","donor":{"firstName":"Claim","middleName":"","lastName":"Donor","email":"claim@example.com","address1":"1 Main St","address2":"","city":"Kissimmee","state":"FL","zip":"34741","country":"US","marketingEmailConsent":false},"charity":{"pledgeId":"3685b542-61d5-45da-9580-162dca725966","name":"Charity"},"devices":[{"id":"p1","brand":"Apple","model":"Phone","age":"2-3 years","condition":"Good","storage":"128 GB","powersOn":true,"unlocked":true}]}'::jsonb,
  gen_random_uuid(),gen_random_uuid(),repeat('1',64),null) result;
select is(jsonb_array_length(api.donor_account_overview('91000000-0000-4000-8000-000000000001')->'donations'),0,'GET account reads do not claim by email');
select throws_ok(format($$select api.claim_donation('91000000-0000-4000-8000-000000000002',%L::uuid,'other@example.com')$$,
  (select result->>'donationId' from claim_donation)),'42501','verified donation identity required','different email cannot claim');
select is((api.claim_donation('91000000-0000-4000-8000-000000000001',(select (result->>'donationId')::uuid from claim_donation),'claim@example.com')->>'claimed')::boolean,true,'verified identity plus capability explicitly claims');
select is((api.claim_donation('91000000-0000-4000-8000-000000000001',(select (result->>'donationId')::uuid from claim_donation),'claim@example.com')->>'alreadyClaimed')::boolean,true,'same-user claim replay is idempotent');
select throws_ok(format($$select api.claim_donation('91000000-0000-4000-8000-000000000003',%L::uuid,'recycled@example.com')$$,
  (select result->>'donationId' from claim_donation)),'42501','verified donation identity required','another verified user cannot take ownership after a claim');
select throws_ok($$select api.create_donation(
  '{"clientSubmissionKey":"91000000-0000-4000-8000-000000000099"}'::jsonb,gen_random_uuid(),gen_random_uuid(),repeat('2',64),null)$$,
  '23505','idempotency key payload mismatch','altered replay is rejected before parsing');
select is((api.create_donation(
  '{"clientSubmissionKey":"91000000-0000-4000-8000-000000000099"}'::jsonb,gen_random_uuid(),gen_random_uuid(),repeat('1',64),null)->>'created')::boolean,
  false,'exact replay returns original result without creating a new capability');
select is(api.get_donation_tracking_material('DBM-20260729-FFFFFFFF'),null,'guessed public donation ID authorizes nothing');

insert into app_private.organizations(id,name,slug,status,created_by) values
('92000000-0000-4000-8000-000000000001','Verified Partner','verified-partner','active','91000000-0000-4000-8000-000000000010');
insert into app_private.organization_memberships(organization_id,user_id,role,status,activated_at) values
('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000020','partner_admin','active',now());
insert into app_private.charities(id,pledge_id,canonical_name,status,verified_by,verified_at) values
('92000000-0000-4000-8000-000000000002','3685b542-61d5-45da-9580-162dca725966','Verified Charity','verified','91000000-0000-4000-8000-000000000010',now());
insert into app_private.organization_charities(organization_id,charity_id,status,verified_by,verified_at) values
('92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','verified','91000000-0000-4000-8000-000000000010',now());
select lives_ok($$select api.partner_create_campaign('91000000-0000-4000-8000-000000000020','92000000-0000-4000-8000-000000000001',
  'verified-campaign','Verified Campaign','92000000-0000-4000-8000-000000000002','Headline','Summary','Story','Donate a Phone',repeat('3',64))$$,
  'partner can use only its verified canonical charity');
select throws_ok($$select api.partner_create_campaign('91000000-0000-4000-8000-000000000020','92000000-0000-4000-8000-000000000001',
  'bad-charity','Bad Charity',gen_random_uuid(),'Headline','Summary','Story','Donate a Phone',repeat('4',64))$$,
  '42501','verified organization charity required','partner cannot invent a charity');
select lives_ok(format($$select api.staff_publish_campaign_revision('91000000-0000-4000-8000-000000000010',%L::uuid,%L::uuid)$$,
  (select id from app_private.campaigns where slug='verified-campaign'),
  (select id from app_private.campaign_revisions where campaign_id=(select id from app_private.campaigns where slug='verified-campaign'))),
  'staff publication revalidates the canonical relationship');
select throws_ok($$select api.create_donation(
  '{"clientSubmissionKey":"93000000-0000-4000-8000-000000000001","shippingMethod":"label","donor":{"firstName":"X","middleName":"","lastName":"Y","email":"x@example.com","address1":"1 X","address2":"","city":"X","state":"FL","zip":"34741","country":"US","marketingEmailConsent":false},"charity":{"pledgeId":"ec0b21fc-2671-431e-8a81-783b7a9626c9","name":"Wrong"},"devices":[{"id":"p","brand":"Apple","model":"","age":"2-3 years","condition":"Good","storage":"128 GB","powersOn":true,"unlocked":true}]}'::jsonb,
  gen_random_uuid(),gen_random_uuid(),repeat('5',64),'verified-campaign')$$,
  '22023','campaign beneficiary mismatch','campaign donation mismatch rolls back atomically');

insert into app_private.proceeds_policies(id,policy_key,name,purpose,lifecycle) values
('93000000-0000-4000-8000-000000000010','review_general','Review policy','Financial regression policy','active');
insert into app_private.proceeds_policy_versions(id,policy_id,version,lifecycle,share_basis_points,calculation_method,effective_from,approved_by,approved_at)
values('93000000-0000-4000-8000-000000000011','93000000-0000-4000-8000-000000000010',1,'active',5000,'net_proceeds_share','2026-01-01',
  '91000000-0000-4000-8000-000000000010',now());
insert into app_private.proceeds_policy_assignments(policy_version_id,scope,scope_id,precedence,effective_from)
values('93000000-0000-4000-8000-000000000011','general',null,1,'2026-01-01');
insert into app_private.proceeds_policy_cost_rules(policy_version_id,cost_category,deductible,allocation_method,cap_basis_points,priority,metadata) values
('93000000-0000-4000-8000-000000000011','shared_shipping',true,'pro_rata',null,30,'{}'),
('93000000-0000-4000-8000-000000000011','device_processing',true,'direct',null,20,'{}'),
('93000000-0000-4000-8000-000000000011','capped_fee',true,'capped',500,10,'{}'),
('93000000-0000-4000-8000-000000000011','non_deductible',false,'direct',null,100,'{}');
insert into app_private.proceeds_policy_assignments(policy_version_id,scope,scope_id,precedence,effective_from)
values('93000000-0000-4000-8000-000000000011','campaign',(select id from app_private.campaigns where slug='verified-campaign'),100,'2026-01-01');
create temporary table campaign_payload(payload jsonb);
insert into campaign_payload values(
  '{"clientSubmissionKey":"93000000-0000-4000-8000-000000000050","shippingMethod":"label","donor":{"firstName":"Campaign","middleName":"","lastName":"Donor","email":"campaign@example.com","address1":"1 Main","address2":"","city":"Kissimmee","state":"FL","zip":"34741","country":"US","marketingEmailConsent":false},"charity":{"pledgeId":"3685b542-61d5-45da-9580-162dca725966","name":"Verified Charity"},"devices":[{"id":"c1","brand":"Apple","model":"A","age":"2-3 years","condition":"Good","storage":"128 GB","powersOn":true,"unlocked":true}]}'::jsonb);
create temporary table campaign_donation as select api.create_donation(payload,gen_random_uuid(),gen_random_uuid(),repeat('7',64),'verified-campaign') result from campaign_payload;
select isnt((select campaign_id from app_private.donations where id=(select (result->>'donationId')::uuid from campaign_donation)),null,'valid campaign attribution commits with donation creation');
select is((select policy_version_snapshot_id from app_private.donations where id=(select (result->>'donationId')::uuid from campaign_donation)),
  '93000000-0000-4000-8000-000000000011'::uuid,'campaign-specific policy resolves in the creation transaction');
select is((api.create_donation((select payload from campaign_payload),gen_random_uuid(),gen_random_uuid(),repeat('7',64),'verified-campaign')->>'created')::boolean,
  false,'campaign donation retry returns the original transaction result');
select throws_ok($$select api.create_donation((select payload||'{"clientSubmissionKey":"93000000-0000-4000-8000-000000000051"}' from campaign_payload),
  gen_random_uuid(),gen_random_uuid(),repeat('8',64),'missing-campaign')$$,
  '22023','published eligible campaign required','invalid campaign slug cannot leave a generic donation');
select lives_ok($$select api.partner_create_campaign('91000000-0000-4000-8000-000000000020','92000000-0000-4000-8000-000000000001',
  'draft-campaign','Draft Campaign','92000000-0000-4000-8000-000000000002','Headline','Summary','Story','Donate a Phone',repeat('9',64))$$,
  'an unpublished campaign fixture can be created');
select throws_ok($$select api.create_donation((select payload||'{"clientSubmissionKey":"93000000-0000-4000-8000-000000000052"}' from campaign_payload),
  gen_random_uuid(),gen_random_uuid(),repeat('a',64),'draft-campaign')$$,
  '22023','published eligible campaign required','unpublished campaign cannot receive attributed donation');
select is((select count(*) from app_private.donations where client_submission_key in
  ('93000000-0000-4000-8000-000000000051','93000000-0000-4000-8000-000000000052')),0::bigint,'failed campaign validation leaves no generic donation');
select is((select count(*) from app_private.audit_events where action_name='donation.submit'
  and metadata->>'environment'='beta' and redacted_changes ? 'campaign_id')>0,true,'campaign attribution is audited in the same transaction');
create temporary table finance_donation as select api.create_donation(
  '{"clientSubmissionKey":"93000000-0000-4000-8000-000000000099","shippingMethod":"label","donor":{"firstName":"Finance","middleName":"","lastName":"Test","email":"finance@example.com","address1":"1 Main","address2":"","city":"Kissimmee","state":"FL","zip":"34741","country":"US","marketingEmailConsent":false},"charity":{"pledgeId":"3685b542-61d5-45da-9580-162dca725966","name":"Verified Charity"},"devices":[{"id":"f1","brand":"Apple","model":"A","age":"2-3 years","condition":"Good","storage":"128 GB","powersOn":true,"unlocked":true},{"id":"f2","brand":"Google","model":"B","age":"2-3 years","condition":"Good","storage":"128 GB","powersOn":true,"unlocked":true}]}'::jsonb,
  gen_random_uuid(),gen_random_uuid(),repeat('6',64),null) result;
select is((select policy_resolution_status from app_private.donations where id=(select (result->>'donationId')::uuid from finance_donation)),'resolved','general proceeds policy snapshots at submission');
insert into app_private.donation_costs(donation_id,device_id,category,amount_cents,incurred_at,recorded_by) values
((select (result->>'donationId')::uuid from finance_donation),null,'shared_shipping',1000,now(),'91000000-0000-4000-8000-000000000010'),
((select (result->>'donationId')::uuid from finance_donation),(select id from app_private.donation_devices where donation_id=(select (result->>'donationId')::uuid from finance_donation) order by id limit 1),'device_processing',300,now(),'91000000-0000-4000-8000-000000000010'),
((select (result->>'donationId')::uuid from finance_donation),null,'capped_fee',900,now(),'91000000-0000-4000-8000-000000000010'),
((select (result->>'donationId')::uuid from finance_donation),null,'non_deductible',9999,now(),'91000000-0000-4000-8000-000000000010');
select lives_ok(format($$select api.staff_record_sale_and_allocation('91000000-0000-4000-8000-000000000010',%L::uuid,10000,'test','sale-a',now())$$,
  (select id from app_private.donation_devices where donation_id=(select (result->>'donationId')::uuid from finance_donation) order by id limit 1)),
  'first device sale applies configured shared, direct, and capped rules');
select is((select eligible_cost_cents from app_private.proceeds_allocations where gross_cents=10000),1300::bigint,'first sale deducts exactly 1300 cents');
select is((select allocated_cents from app_private.proceeds_allocations where gross_cents=10000),4350::bigint,'first allocation is reproducible in cents');
select throws_ok(format($$select api.staff_record_sale_and_allocation('91000000-0000-4000-8000-000000000010',%L::uuid,10000,'test','duplicate',now())$$,
  (select id from app_private.donation_devices where donation_id=(select (result->>'donationId')::uuid from finance_donation) order by id limit 1)),
  '23505',null,'duplicate active device sale is rejected');
select lives_ok(format($$select api.staff_record_sale_and_allocation('91000000-0000-4000-8000-000000000010',%L::uuid,10001,'test','sale-b',now())$$,
  (select id from app_private.donation_devices where donation_id=(select (result->>'donationId')::uuid from finance_donation) order by id desc limit 1)),
  'second device sale receives only its deterministic shared-cost share');
select is((select sum(applied_cents) from app_private.cost_allocation_applications a join app_private.donation_costs c on c.id=a.cost_id where c.category='shared_shipping'),1000::numeric,'shared cost is allocated exactly once across devices');
select is((select count(*) from app_private.cost_allocation_applications a join app_private.donation_costs c on c.id=a.cost_id where c.category='non_deductible'),0::bigint,'non-deductible cost rule is excluded');

select throws_ok(format($$select api.staff_prepare_disbursement('91000000-0000-4000-8000-000000000010',%L::uuid,1,'Beneficiary','{}')$$,
  (select id from app_private.proceeds_allocations where gross_cents=10000)),'22023','full calculated allocation required','partial payment cannot strand a balance');
select lives_ok(format($$select api.staff_prepare_disbursement('91000000-0000-4000-8000-000000000010',%L::uuid,4350,'Beneficiary','{}')$$,
  (select id from app_private.proceeds_allocations where gross_cents=10000)),'full unpaid allocation can be prepared');
select lives_ok(format($$select api.staff_decide_disbursement('91000000-0000-4000-8000-000000000010',%L::uuid,'approved','reviewed')$$,
  (select preparation_id from app_private.disbursement_preparation_allocations x join app_private.proceeds_allocations a on a.id=x.allocation_id where a.gross_cents=10000)),
  'single-staff configurable approval can approve');
select lives_ok(format($$select api.staff_record_disbursement_completion('91000000-0000-4000-8000-000000000010',%L::uuid,'external-1')$$,
  (select preparation_id from app_private.disbursement_preparation_allocations x join app_private.proceeds_allocations a on a.id=x.allocation_id where a.gross_cents=10000)),
  'human records externally completed payment');
select is((select status::text from app_private.proceeds_allocations where gross_cents=10000),'disbursed','allocation current status agrees with append-only state history');
update app_private.financial_approval_policies set required_approvals=2,preparer_may_approve=false
where action_type='record_disbursement' and lifecycle='active';
select lives_ok(format($$select api.staff_prepare_disbursement('91000000-0000-4000-8000-000000000010',%L::uuid,4750,'Beneficiary','{}')$$,
  (select id from app_private.proceeds_allocations where gross_cents=10001)),'second full allocation can use a later approval policy configuration');
select throws_ok(format($$select api.staff_decide_disbursement('91000000-0000-4000-8000-000000000010',%L::uuid,'approved','self')$$,
  (select preparation_id from app_private.disbursement_preparation_allocations x join app_private.proceeds_allocations a on a.id=x.allocation_id where a.gross_cents=10001)),
  '42501','preparer cannot approve under active policy','preparer separation is configurable and enforced');
select is((api.staff_decide_disbursement('91000000-0000-4000-8000-000000000011',
  (select preparation_id from app_private.disbursement_preparation_allocations x join app_private.proceeds_allocations a on a.id=x.allocation_id where a.gross_cents=10001),
  'approved','first reviewer')->>'status'),'prepared','one of two required approvals is insufficient');
select lives_ok(format($$select api.staff_decide_disbursement('91000000-0000-4000-8000-000000000012',%L::uuid,'approved','second reviewer')$$,
  (select preparation_id from app_private.disbursement_preparation_allocations x join app_private.proceeds_allocations a on a.id=x.allocation_id where a.gross_cents=10001)),
  'second distinct approval satisfies dual-control policy');
select lives_ok(format($$select api.staff_record_disbursement_completion('91000000-0000-4000-8000-000000000012',%L::uuid,'external-2')$$,
  (select preparation_id from app_private.disbursement_preparation_allocations x join app_private.proceeds_allocations a on a.id=x.allocation_id where a.gross_cents=10001)),
  'approved dual-control preparation can record external completion');
select is((select status::text from app_private.proceeds_allocations where gross_cents=10001),'disbursed','dual-control completion updates allocation current status');

select * from finish();
rollback;
