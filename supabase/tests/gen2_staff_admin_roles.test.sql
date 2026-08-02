begin;
create extension if not exists pgtap with schema extensions;
select plan(35);
select set_config('request.jwt.claim.role','service_role',true);

select has_function('app_private','assert_active_admin',ARRAY['uuid'],'active administrator assertion exists');
select has_function('api','staff_session_context',ARRAY['uuid'],'staff session context RPC exists');
select is((select count(*)::bigint from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='api' and p.proname in ('staff_publish_campaign_revision','staff_create_partner_organization',
    'staff_associate_partner_charity','staff_verify_partner_charity','staff_invite_partner_admin',
    'staff_set_partner_member_status','staff_set_partner_organization_status','staff_prepare_disbursement',
    'staff_decide_disbursement','staff_record_disbursement_completion')
    and pg_get_functiondef(p.oid) like '%assert_active_admin%'),10::bigint,
  'every high-authority staff RPC requires the active-admin assertion');
select is((select count(*)::bigint from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='api' and p.proname='staff_session_context'
    and has_function_privilege('anon',p.oid,'execute')),0::bigint,
  'browser roles cannot execute the staff role context RPC');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('a4000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ops@example.com','',now(),now(),now()),
('a4000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin@example.com','',now(),now(),now()),
('a4000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','inactive-admin@example.com','',now(),now(),now()),
('a4000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','suspended-staff@example.com','',now(),now(),now()),
('a4000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','partner@example.com','',now(),now(),now());
insert into app_private.profiles(user_id) select id from auth.users where id::text like 'a4000000-%';
insert into app_private.staff_memberships(user_id,role,status,activated_at) values
('a4000000-0000-4000-8000-000000000001','staff','active',now()),
('a4000000-0000-4000-8000-000000000002','admin','active',now()),
('a4000000-0000-4000-8000-000000000003','admin','removed',now()),
('a4000000-0000-4000-8000-000000000004','staff','suspended',now());

select is(api.staff_session_context('a4000000-0000-4000-8000-000000000001')->>'role','staff','session context derives ordinary staff role');
select is(api.staff_session_context('a4000000-0000-4000-8000-000000000002')->>'role','admin','session context derives administrator role');
select throws_ok($$select api.staff_session_context('a4000000-0000-4000-8000-000000000003')$$,
  '42501','active staff membership required','inactive administrators cannot obtain staff context');

insert into app_private.organizations(id,name,slug,status,created_by)
values('a4100000-0000-4000-8000-000000000001','Boundary Partner','boundary-partner','active','a4000000-0000-4000-8000-000000000002');
insert into app_private.organization_memberships(organization_id,user_id,role,status,activated_at)
values('a4100000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000005','partner_admin','active',now());
insert into app_private.charities(id,pledge_id,canonical_name,status,verified_by,verified_at)
values('a4200000-0000-4000-8000-000000000001','a4200000-0000-4000-8000-000000000001','Boundary Charity','verified','a4000000-0000-4000-8000-000000000002',now());
insert into app_private.organization_charities(organization_id,charity_id,status,verified_by,verified_at)
values('a4100000-0000-4000-8000-000000000001','a4200000-0000-4000-8000-000000000001','verified','a4000000-0000-4000-8000-000000000002',now());

create temporary table donation_fixture as select api.create_donation(
  '{"clientSubmissionKey":"a4300000-0000-4000-8000-000000000001","shippingMethod":"label","donor":{"firstName":"Role","middleName":"","lastName":"Fixture","email":"role@example.com","address1":"1 Test Way","address2":"","city":"Kissimmee","state":"FL","zip":"34741","country":"US","marketingEmailConsent":false},"charity":{"pledgeId":"a4200000-0000-4000-8000-000000000001","name":"Boundary Charity"},"devices":[{"id":"role-phone","brand":"Apple","model":"iPhone 13","age":"2-3 years","condition":"Good","storage":"128 GB","powersOn":true,"unlocked":true}]}'::jsonb,
  'a4300000-0000-4000-8000-000000000001','a4300000-0000-4000-8000-000000000002',repeat('a',64),null) result;

select lives_ok(format($$select api.staff_record_receipt('a4000000-0000-4000-8000-000000000001',%L::uuid,now(),'intact',%L::jsonb)$$,
  (select result->>'donationId' from donation_fixture),
  (select jsonb_agg(jsonb_build_object('deviceId',id,'received',true))::text from app_private.donation_devices where donation_id=(select (result->>'donationId')::uuid from donation_fixture))),
  'ordinary staff can confirm physical receipt');
select lives_ok(format($$select api.staff_update_device('a4000000-0000-4000-8000-000000000001',%L::uuid,%L::uuid,'{"actualBrand":"Apple","actualModel":"iPhone 13","inspectionStatus":"inspected","processingStatus":"resale","dataWipeStatus":"completed","assessedValueCents":15000}'::jsonb)$$,
  (select result->>'donationId' from donation_fixture),(select id from app_private.donation_devices where donation_id=(select (result->>'donationId')::uuid from donation_fixture))),
  'ordinary staff can inspect, wipe, and assess a device');
select lives_ok(format($$select api.staff_add_internal_note('a4000000-0000-4000-8000-000000000001',%L::uuid,'Operational review complete.')$$,
  (select result->>'donationId' from donation_fixture)),'ordinary staff can add an internal note');
select lives_ok(format($$select api.staff_record_sale_and_allocation('a4000000-0000-4000-8000-000000000001',%L::uuid,10000,'role-test','role-sale',now())$$,
  (select id from app_private.donation_devices where donation_id=(select (result->>'donationId')::uuid from donation_fixture))),
  'ordinary staff can record sale evidence');

select throws_ok($$select api.staff_publish_campaign_revision('a4000000-0000-4000-8000-000000000001','a4100000-0000-4000-8000-000000000001','a4100000-0000-4000-8000-000000000002')$$,'42501','active administrator membership required','ordinary staff cannot publish campaigns');
select throws_ok($$select api.staff_create_partner_organization('a4000000-0000-4000-8000-000000000001','Nope','role-nope')$$,'42501','active administrator membership required','ordinary staff cannot create partner organizations');
select throws_ok($$select api.staff_invite_partner_admin('a4000000-0000-4000-8000-000000000001','a4100000-0000-4000-8000-000000000001','blocked@example.com')$$,'42501','active administrator membership required','ordinary staff cannot invite partner administrators');
select throws_ok($$select api.staff_set_partner_member_status('a4000000-0000-4000-8000-000000000001','a4100000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000005','suspended')$$,'42501','active administrator membership required','ordinary staff cannot change partner membership');
select throws_ok($$select api.staff_verify_partner_charity('a4000000-0000-4000-8000-000000000001','a4200000-0000-4000-8000-000000000002','Nope',null)$$,'42501','active administrator membership required','ordinary staff cannot verify nonprofits');
select throws_ok($$select api.staff_associate_partner_charity('a4000000-0000-4000-8000-000000000001','a4100000-0000-4000-8000-000000000001','a4200000-0000-4000-8000-000000000001')$$,'42501','active administrator membership required','ordinary staff cannot associate nonprofits');
select throws_ok($$select api.staff_prepare_disbursement('a4000000-0000-4000-8000-000000000001','a4300000-0000-4000-8000-000000000003',1,'nope','{}')$$,'42501','active administrator membership required','ordinary staff cannot prepare disbursements');
select throws_ok($$select api.staff_decide_disbursement('a4000000-0000-4000-8000-000000000001','a4300000-0000-4000-8000-000000000003','approved','nope')$$,'42501','active administrator membership required','ordinary staff cannot decide disbursements');
select throws_ok($$select api.staff_record_disbursement_completion('a4000000-0000-4000-8000-000000000001','a4300000-0000-4000-8000-000000000003','nope')$$,'42501','active administrator membership required','ordinary staff cannot complete disbursements');
select throws_ok($$select api.staff_set_partner_organization_status('a4000000-0000-4000-8000-000000000001','a4100000-0000-4000-8000-000000000001','paused')$$,'42501','active administrator membership required','ordinary staff cannot change partner organization status');

create temporary table created_org as select api.staff_create_partner_organization('a4000000-0000-4000-8000-000000000002','Admin Partner','admin-boundary-partner') result;
select isnt((select result->>'organizationId' from created_org),null,'active administrator can create a partner organization');
select lives_ok($$select api.staff_verify_partner_charity('a4000000-0000-4000-8000-000000000002','a4200000-0000-4000-8000-000000000002','Second Boundary Charity',null)$$,'active administrator can verify a nonprofit');
select lives_ok($$select api.staff_associate_partner_charity('a4000000-0000-4000-8000-000000000002','a4100000-0000-4000-8000-000000000001','a4200000-0000-4000-8000-000000000001')$$,'active administrator can associate a nonprofit');
select lives_ok($$select api.staff_invite_partner_admin('a4000000-0000-4000-8000-000000000002','a4100000-0000-4000-8000-000000000001','invited@example.com')$$,'active administrator can invite a partner administrator');
select lives_ok($$select api.staff_set_partner_member_status('a4000000-0000-4000-8000-000000000002','a4100000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000005','suspended')$$,'active administrator can change partner membership');
select lives_ok($$select api.staff_set_partner_organization_status('a4000000-0000-4000-8000-000000000002','a4100000-0000-4000-8000-000000000001','paused')$$,'active administrator can change partner organization status');

update app_private.organization_memberships set status='active' where organization_id='a4100000-0000-4000-8000-000000000001' and user_id='a4000000-0000-4000-8000-000000000005';
update app_private.organizations set status='active' where id='a4100000-0000-4000-8000-000000000001';
select lives_ok($$select api.partner_create_campaign('a4000000-0000-4000-8000-000000000005','a4100000-0000-4000-8000-000000000001','role-boundary-campaign','Role Boundary Campaign','a4200000-0000-4000-8000-000000000001','Role headline','Role summary','Role story','Donate a Phone',repeat('b',64))$$,'partner fixture creates a draft campaign');
select lives_ok(format($$select api.staff_publish_campaign_revision('a4000000-0000-4000-8000-000000000002',%L::uuid,%L::uuid)$$,
  (select id from app_private.campaigns where slug='role-boundary-campaign'),(select id from app_private.campaign_revisions where campaign_id=(select id from app_private.campaigns where slug='role-boundary-campaign'))),
  'active administrator can publish the exact campaign revision');

insert into app_private.proceeds_allocations(id,donation_id,policy_version_id,beneficiary_pledge_id,gross_cents,eligible_cost_cents,allocable_base_cents,share_basis_points,allocated_cents,status,calculated_by,calculated_at,beneficiary_charity_id)
values('a4300000-0000-4000-8000-000000000003',(select (result->>'donationId')::uuid from donation_fixture),'10000000-0000-0000-0000-000000000002','a4200000-0000-4000-8000-000000000001',10000,0,10000,5000,5000,'calculated','a4000000-0000-4000-8000-000000000002',now(),'a4200000-0000-4000-8000-000000000001');
create temporary table preparation_fixture as select api.staff_prepare_disbursement('a4000000-0000-4000-8000-000000000002','a4300000-0000-4000-8000-000000000003',5000,'Role payout','{"evidence":"role-test"}'::jsonb) result;
select isnt((select result->>'preparationId' from preparation_fixture),null,'active administrator can prepare a disbursement');
select lives_ok(format($$select api.staff_decide_disbursement('a4000000-0000-4000-8000-000000000002',%L::uuid,'approved','Role approval')$$,(select result->>'preparationId' from preparation_fixture)),'active administrator can approve a disbursement');
select lives_ok(format($$select api.staff_record_disbursement_completion('a4000000-0000-4000-8000-000000000002',%L::uuid,'role-payment-1')$$,(select result->>'preparationId' from preparation_fixture)),'active administrator can record external payout completion');

select throws_ok($$select api.staff_create_partner_organization('a4000000-0000-4000-8000-000000000003','Inactive','inactive-admin')$$,'42501','active administrator membership required','inactive administrator cannot use admin mutation');
select throws_ok($$select api.staff_record_receipt('a4000000-0000-4000-8000-000000000004',(select result->>'donationId' from donation_fixture)::uuid,now(),'nope','[]'::jsonb)$$,'42501','active staff membership required','suspended staff cannot use operational mutations');
select throws_ok($$select api.staff_search_donations('a4000000-0000-4000-8000-000000000099','',25)$$,'42501','active staff membership required','forged actor UUID cannot bypass membership');

select * from finish();
rollback;
