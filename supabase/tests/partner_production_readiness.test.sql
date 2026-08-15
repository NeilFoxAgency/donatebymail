begin;
create extension if not exists pgtap with schema extensions;
select plan(68);
select set_config('request.jwt.claim.role','service_role',true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('b1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-a@example.com','',now(),now(),now()),
('b1000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','editor-a@example.com','',now(),now(),now()),
('b1000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','viewer-a@example.com','',now(),now(),now()),
('b1000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-b@example.com','',now(),now(),now()),
('b1000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff@example.com','',now(),now(),now());
insert into app_private.profiles(user_id) select id from auth.users where id::text like 'b1000000-%';
insert into app_private.staff_memberships(user_id,role,status,activated_at)
values('b1000000-0000-4000-8000-000000000005','admin','active',now());
insert into app_private.organizations(id,name,slug,status,created_by) values
('b2000000-0000-4000-8000-000000000001','Partner A','partner-a','active','b1000000-0000-4000-8000-000000000005'),
('b2000000-0000-4000-8000-000000000002','Partner B','partner-b','active','b1000000-0000-4000-8000-000000000005');
insert into app_private.organization_memberships(organization_id,user_id,role,status,activated_at) values
('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','partner_admin','active',now()),
('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','partner_editor','active',now()),
('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000003','partner_viewer','active',now()),
('b2000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000004','partner_admin','active',now());
insert into app_private.charities(id,pledge_id,canonical_name,status,verified_by,verified_at) values
('b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000011','Verified Charity A','verified','b1000000-0000-4000-8000-000000000005',now()),
('b3000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000012','Verified Charity B','verified','b1000000-0000-4000-8000-000000000005',now());
insert into app_private.organization_charities(organization_id,charity_id,status,verified_by,verified_at) values
('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','verified','b1000000-0000-4000-8000-000000000005',now()),
('b2000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000002','verified','b1000000-0000-4000-8000-000000000005',now());

select has_table('app_private','partner_application_contacts','partner application PII has a separate private table');
select is(has_table_privilege('anon','app_private.partner_application_contacts','select'),false,'anonymous users cannot select application PII');
select is(has_table_privilege('authenticated','app_private.partner_application_contacts','select'),false,'authenticated users cannot select application PII');
select is(has_function_privilege('anon','api.partner_workspace(uuid)','execute'),false,'anonymous users cannot execute partner workspace RPCs');
select throws_ok($$select api.submit_partner_application('Applicant','Director','applicant@example.com','Applicant Org','https://example.org','Audience','Goal','Fall',false,repeat('a',64),'partner-app-idempotency-0001')$$,
  '22023','consent required','partner application requires explicit consent');
create temporary table application_fixture as select api.submit_partner_application(
  'Applicant','Director','applicant@example.com','Applicant Org','https://example.org','Audience','Goal','Fall',true,
  repeat('a',64),'partner-app-idempotency-0001') result;
select isnt((select result->>'applicationId' from application_fixture),null,'valid application is persisted');
select is((api.submit_partner_application('Changed','Director','changed@example.com','Changed Org','https://changed.example','Audience','Goal','Fall',true,repeat('b',64),'partner-app-idempotency-0001')->>'applicationId'),
  (select result->>'applicationId' from application_fixture),'application submission is idempotent');
select is(position('applicant@example.com' in (select o.payload::text from app_private.outbox_events o join app_private.domain_events d on d.id=o.domain_event_id where d.aggregate_id=(select (result->>'applicationId')::uuid from application_fixture))),0,
  'application outbox payload contains identifiers rather than PII');
select is((api.staff_partner_application_queue('b1000000-0000-4000-8000-000000000005')->'applications'->0->'contact'->>'email'),'applicant@example.com',
  'authorized staff can review the private application contact');

select throws_ok($$select api.partner_profile_detail('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002')$$,
  '42501','active organization membership required','profile access denies cross-tenant IDs');
select throws_ok($$select api.partner_campaign_slug_available('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002','cross-tenant')$$,
  '42501','active organization membership required','slug lookup denies cross-tenant organization IDs');
select throws_ok($$select api.partner_save_profile_draft('b1000000-0000-4000-8000-000000000003','b2000000-0000-4000-8000-000000000001',0,'Mission','Summary','https://partner-a.example','Kissimmee','FL','US',null,null)$$,
  '42501','active organization editor required','viewer cannot edit the organization profile');
select lives_ok($$select api.partner_save_profile_draft('b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001',0,'Mission A','Summary A','https://partner-a.example','Kissimmee','FL','US',null,null)$$,
  'editor can save an organization profile draft');
select is(api.partner_profile_detail('b1000000-0000-4000-8000-000000000003','b2000000-0000-4000-8000-000000000001')->'draft'->>'mission','Mission A',
  'viewer can read its own organization profile draft');
select throws_ok($$select api.partner_submit_profile_review('b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001')$$,
  '42501','active organization administrator required','editor cannot submit profile publication review');
create temporary table profile_revision_fixture as select api.partner_submit_profile_review(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001') result;
select isnt((select result->>'revisionId' from profile_revision_fixture),null,'partner administrator creates an immutable profile revision');
select is((api.staff_profile_revision_preview('b1000000-0000-4000-8000-000000000005','b2000000-0000-4000-8000-000000000001',
  (select (result->>'revisionId')::uuid from profile_revision_fixture))->'revision'->>'mission'),'Mission A',
  'staff profile preview resolves the exact immutable revision');
select throws_ok(format($$select api.staff_profile_revision_preview('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',%L::uuid)$$,
  (select result->>'revisionId' from profile_revision_fixture)),'42501','active staff membership required','partner identities cannot call staff profile previews');
select throws_ok(format($$update app_private.organization_profile_revisions set mission='tampered' where id=%L::uuid$$,
  (select result->>'revisionId' from profile_revision_fixture)),'23514','profile revision content is immutable','submitted profile content is immutable');
select lives_ok(format($$select api.staff_review_profile_revision('b1000000-0000-4000-8000-000000000005','b2000000-0000-4000-8000-000000000001',%L::uuid,'approved',null)$$,
  (select result->>'revisionId' from profile_revision_fixture)),'staff administrator approves the exact profile revision');
select lives_ok(format($$select api.staff_publish_profile_revision('b1000000-0000-4000-8000-000000000005','b2000000-0000-4000-8000-000000000001',%L::uuid)$$,
  (select result->>'revisionId' from profile_revision_fixture)),'staff administrator publishes the exact profile revision');
select is(api.get_public_nonprofit('partner-a')->>'mission','Mission A','published nonprofit profile resolves the approved immutable revision');
select is(position('applicant@example.com' in api.get_public_nonprofit('partner-a')::text),0,'public nonprofit profile contains no application contact PII');

create temporary table invitation_fixture as select api.partner_invite_member(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','invited-editor@example.com','partner_editor') result;
select isnt((select result->>'invitationId' from invitation_fixture),null,'partner administrator can invite an editor');
select throws_ok($$select api.partner_invite_member('b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','nope@example.com','partner_viewer')$$,
  '42501','active organization administrator required','editor cannot invite team members');
select throws_ok($$select api.partner_invite_member('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','admin@example.com','partner_admin')$$,
  '42501','partners may invite editors or viewers only','partner administrator cannot create another administrator');
select lives_ok(format($$select api.partner_revoke_invitation('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',%L::uuid)$$,
  (select result->>'invitationId' from invitation_fixture)),'partner administrator can revoke an unused invitation');
insert into app_private.partner_invitations(organization_id,email_search,role,status,invited_by,invited_at,expires_at)
values('b2000000-0000-4000-8000-000000000001','expired@example.com','partner_viewer','invited','b1000000-0000-4000-8000-000000000001',now()-interval '8 days',now()-interval '1 day');
select is(api.is_invited_partner_email('expired@example.com'),false,'expired invitation cannot bootstrap a partner identity');
select throws_ok($$select api.partner_set_member_status('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','suspended')$$,
  '42501','partner administrators cannot change administrator access','partner administrator cannot suspend another administrator');
insert into app_private.partner_invitations(organization_id,email_search,role,status,invited_by,invited_at,expires_at)
values('b2000000-0000-4000-8000-000000000001','pending-private@example.com','partner_viewer','invited','b1000000-0000-4000-8000-000000000001',now(),now()+interval '7 days');
select is(position('pending-private@example.com' in api.partner_workspace('b1000000-0000-4000-8000-000000000003')::text),0,
  'partner viewers cannot read pending invitation email addresses');
select isnt(position('pending-private@example.com' in api.partner_workspace('b1000000-0000-4000-8000-000000000001')::text),0,
  'partner administrators can manage pending invitation email addresses');

create temporary table campaign_fixture as select api.partner_create_campaign_v2(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',
  'partner-a-campaign','Partner A Campaign','Phones for a cause','Help this verified charity','A factual campaign story.','Donate a Phone',100,
  now()-interval '1 day',now()+interval '30 days','America/New_York',
  '[{"type":"quote","content":{"body":"A phone can help.","attribution":"Campaign director"}}]'::jsonb,'{}'::jsonb) result;
select isnt((select result->>'campaignId' from campaign_fixture),null,'partner administrator creates a guided campaign with the corrected quote schema');
select throws_ok($$select api.partner_create_campaign_v2(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',
  'invalid-quote','Invalid Quote','Headline','Summary','Story','Donate a Phone',null,null,null,'America/New_York',
  '[{"type":"quote","content":{"quote":"wrong field","source":"wrong field"}}]'::jsonb,'{}'::jsonb)$$,
  '22023','invalid campaign content','campaign validator rejects the former mismatched quote fields');
select throws_ok($$select api.partner_create_campaign_v2(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',
  'blank-name','   ','A headline','A useful summary','A factual story','Donate a Phone',null,null,null,'America/New_York','[]'::jsonb,'{}'::jsonb)$$,
  '22023','campaign name required','campaign onboarding rejects a blank campaign name');
select throws_ok($$select api.partner_create_campaign_v2(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',
  'blank-story','Valid Name','A headline','A useful summary','   ','Donate a Phone',null,null,null,'America/New_York','[]'::jsonb,'{}'::jsonb)$$,
  '22023','campaign story required','campaign onboarding rejects a blank campaign story');
select isnt(api.partner_campaign_workspace('b1000000-0000-4000-8000-000000000003',(select (result->>'campaignId')::uuid from campaign_fixture)),null,
  'viewer can read its organization campaign workspace');
select throws_ok(format($$select api.partner_campaign_workspace('b1000000-0000-4000-8000-000000000004',%L::uuid)$$,
  (select result->>'campaignId' from campaign_fixture)),'42501','active organization membership required','campaign workspace denies cross-tenant IDs');
select throws_ok(format($$select api.partner_mark_campaign_ready('b1000000-0000-4000-8000-000000000003',%L::uuid)$$,
  (select result->>'campaignId' from campaign_fixture)),'42501','active organization editor required','viewer cannot change campaign review state');
select lives_ok(format($$select api.partner_save_campaign_draft(
  'b1000000-0000-4000-8000-000000000002',%L::uuid,1,7,'Partner A Campaign','Phones for a cause','Help this verified charity',
  'An updated factual campaign story.','Donate a Phone','[{"type":"quote","content":{"body":"A phone can help.","attribution":"Campaign director"}}]'::jsonb,
  '{}'::jsonb,null,null,100,now()-interval '1 day',now()+interval '30 days','America/New_York')$$,
  (select result->>'campaignId' from campaign_fixture)),'editor can autosave a valid campaign working draft');
select lives_ok(format($$select api.partner_mark_campaign_ready('b1000000-0000-4000-8000-000000000002',%L::uuid)$$,
  (select result->>'campaignId' from campaign_fixture)),'editor can mark a complete draft ready for partner approval');
select throws_ok(format($$select api.partner_submit_campaign_review('b1000000-0000-4000-8000-000000000002',%L::uuid)$$,
  (select result->>'campaignId' from campaign_fixture)),'42501','active organization administrator required','editor cannot submit a campaign for staff publication review');
create temporary table campaign_revision_fixture as select api.partner_submit_campaign_review(
  'b1000000-0000-4000-8000-000000000001',(select (result->>'campaignId')::uuid from campaign_fixture)) result;
select isnt((select result->>'revisionId' from campaign_revision_fixture),null,'partner administrator submits an immutable campaign revision');
select throws_ok(format($$update app_private.campaign_revisions set headline='tampered' where id=%L::uuid$$,
  (select result->>'revisionId' from campaign_revision_fixture)),'23514','campaign revision content is immutable','submitted campaign content is immutable');
select lives_ok(format($$select api.staff_review_campaign_revision('b1000000-0000-4000-8000-000000000005',%L::uuid,%L::uuid,'approved',null)$$,
  (select result->>'campaignId' from campaign_fixture),(select result->>'revisionId' from campaign_revision_fixture)),'staff approves the exact campaign revision');
select lives_ok(format($$select api.staff_publish_campaign_revision('b1000000-0000-4000-8000-000000000005',%L::uuid,%L::uuid)$$,
  (select result->>'campaignId' from campaign_fixture),(select result->>'revisionId' from campaign_revision_fixture)),'staff publishes the exact campaign revision');
select is(api.get_public_campaign('partner-a-campaign')->>'headline','Phones for a cause','public campaign resolves the approved immutable revision');

create temporary table donation_fixture as select api.create_donation(
  '{"id":"DBM-PRIVATE-PARTNER-TEST","clientSubmissionKey":"b4000000-0000-4000-8000-000000000001","shippingMethod":"label","donor":{"firstName":"Sensitive","middleName":"","lastName":"Donor","email":"private-donor@example.com","address1":"99 Private Lane","address2":"","city":"Kissimmee","state":"FL","zip":"34741","country":"US","marketingEmailConsent":false},"charity":{"pledgeId":"b3000000-0000-4000-8000-000000000011","name":"Verified Charity A"},"devices":[{"id":"private-phone","brand":"Apple","model":"iPhone","age":"2-3 years","condition":"Good","storage":"128 GB","powersOn":true,"unlocked":true}]}'::jsonb,
  'b3000000-0000-4000-8000-000000000001',(select (result->>'campaignId')::uuid from campaign_fixture),repeat('d',64),null) result;
select isnt((select result->>'donationId' from donation_fixture),null,'published active campaign accepts an attributed donation');
select is(position('private-donor@example.com' in api.partner_campaign_workspace('b1000000-0000-4000-8000-000000000001',(select (result->>'campaignId')::uuid from campaign_fixture))::text),0,
  'partner campaign reporting excludes donor email PII');
select is(api.record_campaign_event('partner-a-campaign','view',repeat('e',64),'social'),true,'first privacy-preserving campaign event is accepted');
select is(api.record_campaign_event('partner-a-campaign','view',repeat('e',64),'social'),true,'duplicate campaign event is handled idempotently');
select is((select count(*) from app_private.campaign_events where campaign_id=(select (result->>'campaignId')::uuid from campaign_fixture) and event_key=repeat('e',64)),1::bigint,
  'duplicate event key produces one metric row');
select throws_ok(format($$select api.staff_set_campaign_alias('b1000000-0000-4000-8000-000000000005',%L::uuid,'staff','redirect')$$,
  (select result->>'campaignId' from campaign_fixture)),'23505','vanity alias unavailable','reserved application routes cannot become vanity aliases');
select lives_ok(format($$select api.staff_set_campaign_alias('b1000000-0000-4000-8000-000000000005',%L::uuid,'partner-a-gives','redirect')$$,
  (select result->>'campaignId' from campaign_fixture)),'staff can approve a non-colliding root vanity alias');
select is(api.partner_campaign_slug_available('b1000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',repeat('x',121)),false,
  'campaign slug availability rejects oversized route values');
select is(api.partner_campaign_slug_available('b1000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',null),false,
  'campaign slug availability rejects null route values');
select throws_ok(format($$select api.staff_set_campaign_alias('b1000000-0000-4000-8000-000000000005',%L::uuid,%L,'redirect')$$,
  (select result->>'campaignId' from campaign_fixture),repeat('x',121)),
  '22023','campaign vanity alias must be a lowercase route slug under 120 characters',
  'staff alias creation rejects oversized route values');

create temporary table campaign_asset_fixture as select api.partner_register_campaign_asset(
  'b1000000-0000-4000-8000-000000000002',(select (result->>'campaignId')::uuid from campaign_fixture),'hero_image',
  'campaigns/'||(select result->>'campaignId' from campaign_fixture)||'/'||gen_random_uuid()||'.webp','image/webp',1000,1200,630,
  'Campaign image',false,repeat('f',64)) result;
select throws_ok(format($$select api.partner_campaign_asset('b1000000-0000-4000-8000-000000000004',%L::uuid)$$,
  (select result->>'id' from campaign_asset_fixture)),'42501','active organization membership required','asset lookup denies cross-tenant IDs');
select is((select count(*)>0 from app_private.audit_events where action_name='campaign.save_draft' and entity_id=(select (result->>'campaignId')::uuid from campaign_fixture)),true,
  'campaign draft changes produce a redacted audit event');
select throws_ok($$update app_private.audit_events set reason_code='tampered' where action_name='campaign.save_draft'$$,
  '55000','audit_events is append-only','partner audit events are append-only');

update app_private.campaigns set status='scheduled',starts_at=now()-interval '2 hours',ends_at=now()+interval '1 hour'
where id=(select (result->>'campaignId')::uuid from campaign_fixture);
select is((api.advance_campaign_lifecycles()->>'started')::integer,1,'scheduled lifecycle job starts an eligible campaign');
select is((select count(*) from app_private.audit_events where action_name='campaign.lifecycle_started'
  and entity_id=(select (result->>'campaignId')::uuid from campaign_fixture)),1::bigint,'scheduled start creates an immutable audit event');
select is((select count(*) from app_private.domain_events where event_type='campaign.lifecycle_started'
  and aggregate_id=(select (result->>'campaignId')::uuid from campaign_fixture)),1::bigint,'scheduled start creates a domain event');
update app_private.campaigns set ends_at=now()-interval '1 minute' where id=(select (result->>'campaignId')::uuid from campaign_fixture);
select is((api.advance_campaign_lifecycles()->>'ended')::integer,1,'scheduled lifecycle job ends an eligible campaign');
select is((select count(*) from app_private.audit_events where action_name='campaign.lifecycle_ended'
  and entity_id=(select (result->>'campaignId')::uuid from campaign_fixture)),1::bigint,'scheduled end creates an immutable audit event');
update app_private.organization_charities set status='pending' where organization_id='b2000000-0000-4000-8000-000000000001'
  and charity_id='b3000000-0000-4000-8000-000000000001';
select is(api.get_public_campaign('partner-a-campaign'),null::jsonb,'public campaign detail fails closed when beneficiary verification is withdrawn');
select is(jsonb_array_length(api.get_public_campaigns()),0,'public campaign listing excludes campaigns with withdrawn beneficiary verification');

insert into app_private.organizations(id,name,slug,status,created_by)
select gen_random_uuid(), 'Bounded Partner ' || n::text, 'bounded-partner-' || n::text, 'active',
  'b1000000-0000-4000-8000-000000000005'::uuid
from generate_series(1,51) as values(n);
insert into app_private.organization_memberships(organization_id,user_id,role,status,activated_at)
select o.id, 'b1000000-0000-4000-8000-000000000001'::uuid, 'partner_viewer', 'active', now()
from app_private.organizations o where o.slug like 'bounded-partner-%';
select is(jsonb_array_length(api.partner_workspace('b1000000-0000-4000-8000-000000000001')->'organizations'), 50,
  'partner workspace caps organization snapshots');
select is(jsonb_array_length(api.partner_overview('b1000000-0000-4000-8000-000000000001')->'organizations'), 50,
  'partner overview caps organization snapshots');

select * from finish();
rollback;
