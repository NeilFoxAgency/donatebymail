begin;
create extension if not exists pgtap with schema extensions;
select plan(22);
select set_config('request.jwt.claim.role','service_role',true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('a1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','claim2@example.com','',now(),now(),now()),
('a1000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','wrong2@example.com','',now(),now(),now()),
('a1000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff-review@example.com','',now(),now(),now()),
('a1000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','partner-review@example.com','',now(),now(),now());
insert into app_private.profiles(user_id) select id from auth.users where id::text like 'a1000000-%';
insert into app_private.staff_memberships(user_id,role,status,activated_at)
values('a1000000-0000-4000-8000-000000000003','admin','active',now());

create temporary table claim_fixture as select api.create_donation(
  '{"clientSubmissionKey":"a2000000-0000-4000-8000-000000000001","shippingMethod":"label","donor":{"firstName":"Claim","middleName":"","lastName":"Two","email":"claim2@example.com","address1":"1 Main","address2":"","city":"Kissimmee","state":"FL","zip":"34741","country":"US","marketingEmailConsent":true,"marketingConsentAt":"2026-07-29T00:00:00Z"},"charity":{"pledgeId":"3685b542-61d5-45da-9580-162dca725966","name":"Charity"},"devices":[{"id":"phone","brand":"Apple","model":"Phone","age":"2-3 years","condition":"Good","storage":"128 GB","powersOn":true,"unlocked":true}]}'::jsonb,
  gen_random_uuid(),gen_random_uuid(),repeat('a',64),null) result;
create temporary table pending_fixture as select api.create_pending_donation_claim((select (result->>'donationId')::uuid from claim_fixture)) id;
select isnt((select id from pending_fixture),null,'verified raw capability can be exchanged for opaque pending state');
select lives_ok(format($$select api.create_auth_login_attempt(repeat('b',64),'/account','{"pkce":"server"}',now()+interval '10 minutes',%L::uuid)$$,
  (select id from pending_fixture)),'pending claim is attached only to a bounded account login attempt');
select is((api.consume_auth_login_attempt(repeat('b',64))->>'pendingClaimId')::uuid,(select id from pending_fixture),'PKCE round trip preserves opaque claim state');
select throws_ok(format($$select api.complete_pending_donation_claim('a1000000-0000-4000-8000-000000000002',%L::uuid,'wrong2@example.com')$$,
  (select id from pending_fixture)),'42501','verified donation identity required','wrong authenticated email fails closed');
select is((api.complete_pending_donation_claim('a1000000-0000-4000-8000-000000000001',(select id from pending_fixture),'claim2@example.com')->>'claimed')::boolean,true,'correct account completes claim after PKCE without a second email click');
select throws_ok(format($$select api.complete_pending_donation_claim('a1000000-0000-4000-8000-000000000001',%L::uuid,'claim2@example.com')$$,
  (select id from pending_fixture)),'22023','pending claim expired or consumed','pending claim is one-time');
insert into app_private.pending_donation_claims(donation_id,expires_at) values((select (result->>'donationId')::uuid from claim_fixture),now()-interval '1 minute') returning id;
select throws_ok($$select api.complete_pending_donation_claim('a1000000-0000-4000-8000-000000000001',
  (select id from app_private.pending_donation_claims where expires_at<now() order by created_at desc limit 1),'claim2@example.com')$$,
  '22023','pending claim expired or consumed','expired pending claim fails closed');
select is(has_table_privilege('authenticated','app_private.pending_donation_claims','select'),false,'browser roles cannot read pending claims');
select is((select count(*) from pg_constraint where conname='campaign_assets_deferred'
  and conrelid='app_private.campaign_revisions'::regclass),0::bigint,'published campaign revisions may reference only controlled assets');

create temporary table org_fixture as select api.staff_create_partner_organization('a1000000-0000-4000-8000-000000000003','Review Partner','review-partner') result;
select isnt((select result->>'organizationId' from org_fixture),null,'staff creates a partner organization');
create temporary table charity_fixture as select api.staff_verify_partner_charity('a1000000-0000-4000-8000-000000000003',
  'ec0b21fc-2671-431e-8a81-783b7a9626c9','Review Charity',null) result;
select lives_ok(format($$select api.staff_associate_partner_charity('a1000000-0000-4000-8000-000000000003',%L::uuid,%L::uuid)$$,
  (select result->>'organizationId' from org_fixture),(select result->>'charityId' from charity_fixture)),'staff associates a verified canonical charity');
select lives_ok(format($$select api.staff_invite_partner_admin('a1000000-0000-4000-8000-000000000003',%L::uuid,'partner-review@example.com')$$,
  (select result->>'organizationId' from org_fixture)),'staff creates an audited passwordless partner-admin invitation');
select is(api.activate_partner_invitations('a1000000-0000-4000-8000-000000000004','partner-review@example.com'),1,'matching verified partner accepts invitation');
select is((select role::text from app_private.organization_memberships where user_id='a1000000-0000-4000-8000-000000000004'),'partner_admin','invitation grants only its intended organization role');
select is(jsonb_array_length(api.partner_overview('a1000000-0000-4000-8000-000000000004')->'organizations'),1,'partner sees only assigned organization');
select lives_ok(format($$select api.staff_set_partner_member_status('a1000000-0000-4000-8000-000000000003',%L::uuid,
  'a1000000-0000-4000-8000-000000000004','suspended')$$,(select result->>'organizationId' from org_fixture)),'staff suspends partner membership');
select is(jsonb_array_length(api.partner_overview('a1000000-0000-4000-8000-000000000004')->'organizations'),0,'suspended member loses tenant access');
select lives_ok(format($$select api.staff_set_partner_member_status('a1000000-0000-4000-8000-000000000003',%L::uuid,
  'a1000000-0000-4000-8000-000000000004','active')$$,(select result->>'organizationId' from org_fixture)),'staff can reactivate a member');
select lives_ok(format($$select api.staff_set_partner_organization_status('a1000000-0000-4000-8000-000000000003',%L::uuid,'paused')$$,
  (select result->>'organizationId' from org_fixture)),'staff suspends the organization');
select throws_ok(format($$select app_private.assert_org_admin('a1000000-0000-4000-8000-000000000004',%L::uuid)$$,
  (select result->>'organizationId' from org_fixture)),'42501','active organization administrator required','paused organization cannot use admin campaign authority');
select is((select count(*) from app_private.audit_events where action_name like 'partner.%' and actor='staff')>=5,true,'partner authorization mutations are audited');
select is((select human_only from app_private.semantic_command_registry where command_name='grant_role'),true,'agent cannot manage partner roles');

select * from finish();
rollback;
