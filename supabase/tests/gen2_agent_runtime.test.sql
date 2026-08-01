begin;

create extension if not exists pgtap with schema extensions;

select plan(41);

select has_table('app_private', 'partner_leads', 'agent-created partner leads are private');
select has_column('app_private', 'donation_internal_notes', 'created_by_agent', 'internal notes retain agent attribution');
select has_column('app_private', 'campaign_revisions', 'requested_by_agent', 'campaign revisions retain agent attribution');
select has_function('api', 'agent_execute_command', array['uuid', 'text', 'text', 'uuid', 'jsonb'], 'agent execution uses a narrow semantic RPC');
select has_function('api', 'agent_get_donation_context', array['text'], 'agent donation reads use a redacted context RPC');
select has_function('api', 'agent_get_campaign_metrics', array['uuid'], 'agent campaign reads use aggregate metrics');
select has_function('api', 'agent_get_partner_context', array['uuid'], 'agent partner reads use a tenant-scoped context');
select is(has_table_privilege('anon', 'app_private.partner_leads', 'select'), false, 'anonymous callers cannot read partner lead PII');
select is(has_table_privilege('service_role', 'app_private.partner_leads', 'select'), true, 'only the service role receives partner lead table access');
select is(has_function_privilege('anon', 'api.agent_execute_command(uuid,text,text,uuid,jsonb)', 'execute'), false, 'anonymous callers cannot execute agent commands');
select is(has_function_privilege('service_role', 'api.agent_execute_command(uuid,text,text,uuid,jsonb)', 'execute'), true, 'the Worker service can execute bounded agent commands');
select is((select r.outcome::text from app_private.action_policy_rules r join app_private.action_policy_versions v on v.id=r.policy_version_id where r.command_name='update_campaign_content' and r.actor='agent' and v.lifecycle='active'), 'ALLOW_AUTOMATICALLY', 'routine campaign wording can be autonomous under the active policy');
select is((select r.outcome::text from app_private.action_policy_rules r join app_private.action_policy_versions v on v.id=r.policy_version_id where r.command_name='create_partner_lead' and r.actor='agent' and v.lifecycle='active'), 'ALLOW_AUTOMATICALLY', 'bounded partner lead creation can be autonomous');
select is((select r.outcome::text from app_private.action_policy_rules r join app_private.action_policy_versions v on v.id=r.policy_version_id where r.command_name='create_internal_note' and r.actor='agent' and v.lifecycle='active'), 'ALLOW_AUTOMATICALLY', 'bounded internal notes can be autonomous');
select is((select r.outcome::text from app_private.action_policy_rules r join app_private.action_policy_versions v on v.id=r.policy_version_id where r.command_name='send_message' and r.actor='agent' and v.lifecycle='active'), 'REQUIRE_APPROVAL', 'outbound email remains approval configurable in beta');
select is((select r.outcome::text from app_private.action_policy_rules r join app_private.action_policy_versions v on v.id=r.policy_version_id where r.command_name='change_donation_status' and r.actor='agent' and v.lifecycle='active'), 'REQUIRE_APPROVAL', 'donor-visible status changes remain approval configurable');
select is((select human_only from app_private.semantic_command_registry where command_name='record_physical_receipt'), true, 'physical receipt remains human-controlled');
select is((select human_only from app_private.semantic_command_registry where command_name='arbitrary_database_query'), true, 'arbitrary database access remains prohibited');

select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values('91000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','agent-runtime-staff@example.test','',now(),now(),now());
insert into app_private.profiles(user_id) values('91000000-0000-4000-8000-000000000001');
insert into app_private.staff_memberships(user_id,role,status,activated_at) values('91000000-0000-4000-8000-000000000001','admin','active',now());
insert into app_private.charities(id,pledge_id,canonical_name,status,verified_by,verified_at)
values('91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003','Agent Runtime Charity','verified','91000000-0000-4000-8000-000000000001',now());
insert into app_private.organizations(id,name,slug,status,created_by)
values('91000000-0000-4000-8000-000000000004','Agent Runtime Partner','agent-runtime-partner','active','91000000-0000-4000-8000-000000000001');
insert into app_private.organization_charities(organization_id,charity_id,status,verified_by,verified_at)
values('91000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000002','verified','91000000-0000-4000-8000-000000000001',now());
insert into app_private.campaigns(id,organization_id,slug,name,selected_charity_pledge_id,selected_charity_name,charity_id,status,created_by)
values('91000000-0000-4000-8000-000000000005','91000000-0000-4000-8000-000000000004','agent-runtime-campaign','Agent Runtime Campaign','91000000-0000-4000-8000-000000000003','Agent Runtime Charity','91000000-0000-4000-8000-000000000002','draft','91000000-0000-4000-8000-000000000001');

create temporary table donation_fixture as
select api.create_donation(
  jsonb_build_object('id','91000000-0000-4000-8000-000000000006','clientSubmissionKey','91000000-0000-4000-8000-000000000007','shippingMethod','label',
    'donor',jsonb_build_object('firstName','Agent','middleName','','lastName','Donor','email','agent-donor@example.test','address1','1 Agent Way','address2','','city','Kissimmee','state','FL','zip','34741','country','US','marketingEmailConsent',false),
    'charity',jsonb_build_object('pledgeId','91000000-0000-4000-8000-000000000003','name','Agent Runtime Charity'),
    'devices',jsonb_build_array(jsonb_build_object('id','agent-phone','brand','Apple','model','Phone','age','2-3 years','condition','Good','storage','128 GB','powersOn',true,'unlocked',true))),
  gen_random_uuid(),gen_random_uuid(),repeat('a',64),null) result;

select is((select result->>'publicId' from donation_fixture) ~ '^DBM-[0-9]{8}-[A-F0-9]{8}$', true, 'agent fixture donation has a donor-safe public ID');

create temporary table note_decision as
select api.evaluate_agent_command('agent-runtime','create_internal_note','donation',
  (select (result->>'donationId')::uuid from donation_fixture),'low','{"authenticated_sender":true}',repeat('b',64),gen_random_uuid(),'agent-runtime-note-1') result;
select is((select result->>'outcome' from note_decision), 'ALLOW_AUTOMATICALLY', 'internal note decision is automatically allowed');
select lives_ok(format($$select api.agent_execute_command(%L::uuid,'agent-runtime','create_internal_note',%L::uuid,'{"body":"Agent runtime note"}'::jsonb)$$,
  (select result->>'decisionId' from note_decision), (select result->>'donationId' from donation_fixture)), 'allowed internal note executes through the semantic command RPC');
select is((select count(*)::bigint from app_private.donation_internal_notes where created_by_agent='agent-runtime'), 1::bigint, 'agent note stores agent attribution');
select is((select status::text from app_private.action_execution_results where action_decision_id=(select (result->>'decisionId')::uuid from note_decision) order by created_at desc limit 1), 'executed', 'successful agent execution is append-only audited');
select is((select context ? 'donorEmail' from app_private.action_decisions where id=(select (result->>'decisionId')::uuid from note_decision)), false, 'untrusted PII is removed from the decision context');
select lives_ok(format($$select api.agent_execute_command(%L::uuid,'agent-runtime','create_internal_note',%L::uuid,'{"body":"Agent runtime note"}'::jsonb)$$,
  (select result->>'decisionId' from note_decision), (select result->>'donationId' from donation_fixture)), 'replaying an executed command is idempotent');
select is((select count(*)::bigint from app_private.donation_internal_notes where created_by_agent='agent-runtime'), 1::bigint, 'idempotent replay does not duplicate the note');

create temporary table lead_decision as
select api.evaluate_agent_command('agent-runtime','create_partner_lead','partner',null,'low','{}',repeat('c',64),gen_random_uuid(),'agent-runtime-lead-1') result;
select is((select result->>'outcome' from lead_decision), 'ALLOW_AUTOMATICALLY', 'partner lead creation is automatically allowed');
select lives_ok(format($$select api.agent_execute_command(%L::uuid,'agent-runtime','create_partner_lead',null,'{"email":"lead@example.test","organizationName":"New Partner"}'::jsonb)$$,
  (select result->>'decisionId' from lead_decision)), 'agent can create a bounded partner lead');
select is((select count(*)::bigint from app_private.partner_leads where created_by_agent='agent-runtime'), 1::bigint, 'partner lead creation is persisted privately');

create temporary table content_decision as
select api.evaluate_agent_command('agent-runtime','update_campaign_content','campaign','91000000-0000-4000-8000-000000000005'::uuid,'low','{}',repeat('d',64),gen_random_uuid(),'agent-runtime-content-1') result;
select is((select result->>'outcome' from content_decision), 'ALLOW_AUTOMATICALLY', 'campaign wording update is automatically allowed');
select lives_ok(format($$select api.agent_execute_command(%L::uuid,'agent-runtime','update_campaign_content','91000000-0000-4000-8000-000000000005'::uuid,%L::jsonb)$$,
  (select result->>'decisionId' from content_decision), '{"headline":"Updated headline","summary":"Updated summary","story":"Updated campaign story.","ctaLabel":"Donate a Phone","blocks":[]}'), 'agent can create a bounded draft campaign revision');
select is((select requested_by_agent from app_private.campaign_revisions where campaign_id='91000000-0000-4000-8000-000000000005' and requested_by_agent='agent-runtime' limit 1), 'agent-runtime', 'campaign revision retains agent attribution');

select is((api.agent_get_donation_context((select result->>'publicId' from donation_fixture))->>'publicId'), (select result->>'publicId' from donation_fixture), 'agent donation context resolves by public ID');
select is((api.agent_get_donation_context((select result->>'publicId' from donation_fixture)) ? 'donorEmail'), false, 'agent donation context excludes donor email');
select is((api.agent_get_donation_context((select result->>'publicId' from donation_fixture)) ? 'address'), false, 'agent donation context excludes donor address');
select is((api.agent_get_campaign_metrics('91000000-0000-4000-8000-000000000005')->>'campaignId'), '91000000-0000-4000-8000-000000000005', 'agent campaign metrics resolve the campaign');
select is((api.agent_get_partner_context('91000000-0000-4000-8000-000000000004')->'organization'->>'slug'), 'agent-runtime-partner', 'agent partner context is organization scoped');
select is((api.agent_get_partner_context('91000000-0000-4000-8000-000000000004') ? 'donorEmail'), false, 'agent partner context excludes donor PII');

create temporary table send_decision as
select api.evaluate_agent_command('agent-runtime','send_message','donation',null,'low','{}',repeat('e',64),gen_random_uuid(),'agent-runtime-send-1') result;
select throws_ok($$select api.agent_execute_command((select result->>'decisionId' from send_decision)::uuid,'agent-runtime','send_message',null,'{}'::jsonb)$$,
  '42501', 'agent command is not automatically allowed', 'an approval-gated command cannot be executed without an allowed decision');
select is(api.evaluate_agent_command('agent-runtime','record_physical_receipt','donation',null,'low','{}',repeat('e',64),gen_random_uuid(),'agent-runtime-physical-1')->>'outcome', 'DENY', 'agent physical actions remain denied');
select is(api.evaluate_agent_command('agent-runtime','arbitrary_database_query','database',null,'low','{}',repeat('f',64),gen_random_uuid(),'agent-runtime-sql-1')->>'outcome', 'DENY', 'agent arbitrary SQL remains denied');

select * from finish();

rollback;
