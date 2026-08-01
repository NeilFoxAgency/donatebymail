begin;
create extension if not exists pgtap with schema extensions;
select plan(34);
select set_config('request.jwt.claim.role','service_role',true);

select ok(to_regclass('app_private.partner_leads') is not null,
  'partner lead table exists');
select ok(to_regclass('app_private.agent_message_authorizations') is not null,
  'exact-message authorization table exists');
select ok(exists(select 1 from information_schema.columns
  where table_schema='app_private' and table_name='communication_threads' and column_name='donation_id'),
  'communication threads can link to donations');
select ok(exists(select 1 from information_schema.columns
  where table_schema='app_private' and table_name='communication_threads' and column_name='contact_email_search'),
  'communication threads store a normalized contact identity');
select ok(exists(select 1 from information_schema.columns
  where table_schema='app_private' and table_name='communication_threads' and column_name='status'),
  'communication threads have workflow status');

select is((select count(*)::bigint
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='api' and p.proname like 'agent_%') >= 11,true,
  'the bounded agent RPC surface is installed');
select is((select count(*)::bigint
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='api' and p.proname like 'agent_%'
    and (has_function_privilege('anon',p.oid,'execute')
      or has_function_privilege('authenticated',p.oid,'execute'))) = 0,true,
  'browser roles cannot execute agent RPCs');
select is((select count(*)::bigint
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='api' and p.proname like 'agent_%'
    and has_function_privilege('service_role',p.oid,'execute')) >= 11,true,
  'service role can execute all bounded agent RPCs');
select is((select count(*)::bigint from app_private.action_policy_rules r
  join app_private.action_policy_versions v on v.id=r.policy_version_id
  where r.command_name='send_message' and r.actor='agent' and r.target_type='support_email'
    and r.outcome='ALLOW_AUTOMATICALLY' and 'low'=any(r.risk_levels) and v.lifecycle='active'),1::bigint,
  'low-risk support email has one target-specific automatic policy rule');

create temporary table generic_decision as
select api.evaluate_agent_command(
  'workspace-agent-pgtap','send_message','support_email',null,'low','{}'::jsonb,
  repeat('a',64),'a5000000-0000-4000-8000-000000000001','generic-support-message-001'
) result;
select is((select result->>'outcome' from generic_decision),'ESCALATE',
  'generic policy evaluation cannot authorize support email');
select is((select result->>'rationaleCode' from generic_decision),
  'specialized_support_message_authorization_required',
  'generic support email directs callers to the specialized authorizer');

select is(api.agent_support_capabilities('workspace-agent-pgtap')->>'databaseAccess',
  'bounded_rpc_only','agent capability contract prohibits arbitrary SQL');

create temporary table faq_authorization as
select api.agent_authorize_support_message(
  'workspace-agent-pgtap','general_faq','faq-pgtap@example.org',
  'How Donate by Mail works',
  'Donate by Mail accepts eligible phones by mail. This is a test message.',
  'General process answer','faq-support-message-001'
) result;
select is((select result->>'outcome' from faq_authorization),'ALLOW_AUTOMATICALLY',
  'a bounded general FAQ can be authorized automatically');
select ok((select (result->>'autoSendAllowed')::boolean from faq_authorization),
  'a bounded general FAQ is marked eligible for automatic send');
select throws_ok(format(
  $$select api.agent_record_outbound_message(
    'workspace-agent-pgtap',%L::uuid,'How Donate by Mail works','Altered body.',%L,
    'gmail','pgtap-faq-thread','pgtap-faq-message','tre@donatebymail.org',now())$$,
  (select result->>'authorizationId' from faq_authorization),
  (select result->>'contentHash' from faq_authorization)),
  '22023','valid unconsumed exact-message authorization required',
  'outbound logging rejects a body changed after authorization');

create temporary table outbound_result as
select api.agent_record_outbound_message(
  'workspace-agent-pgtap',
  (select (result->>'authorizationId')::uuid from faq_authorization),
  'How Donate by Mail works',
  'Donate by Mail accepts eligible phones by mail. This is a test message.',
  (select result->>'contentHash' from faq_authorization),
  'gmail','pgtap-faq-thread','pgtap-faq-message','tre@donatebymail.org',now()
) result;
select ok((select (result->>'authorizationConsumed')::boolean from outbound_result),
  'an exact authorized outbound message is journaled and consumes authorization');
select ok((api.agent_record_outbound_message(
  'workspace-agent-pgtap',
  (select (result->>'authorizationId')::uuid from faq_authorization),
  'How Donate by Mail works',
  'Donate by Mail accepts eligible phones by mail. This is a test message.',
  (select result->>'contentHash' from faq_authorization),
  'gmail','pgtap-faq-thread','pgtap-faq-message','tre@donatebymail.org',now()
)->>'replayed')::boolean,
  'replaying the same recorded send is idempotent');

create temporary table donation_fixture as select api.create_donation(
  '{"clientSubmissionKey":"a5100000-0000-4000-8000-000000000004","shippingMethod":"label","donor":{"firstName":"Agent","middleName":"","lastName":"Fixture","email":"agent-donor-pgtap@example.org","address1":"1 Test Way","address2":"","city":"Kissimmee","state":"FL","zip":"34741","country":"US","marketingEmailConsent":false},"charity":{"pledgeId":"a5100000-0000-4000-8000-000000000001","name":"Agent Fixture Charity"},"devices":[{"id":"agent-phone","brand":"Apple","model":"iPhone 13","age":"2-3 years","condition":"Good","storage":"128 GB","powersOn":true,"unlocked":true}]}'::jsonb,
  'a5100000-0000-4000-8000-000000000002',
  'a5100000-0000-4000-8000-000000000003',repeat('b',64),null
) result;
select isnt((select result->>'donationId' from donation_fixture),null,
  'agent test donation is created');
select is((select count(*)::bigint from app_private.donation_shipments
  where donation_id=(select (result->>'donationId')::uuid from donation_fixture)
    and direction='inbound' and status='not_mailed'),1::bigint,
  'every new donation receives an explicit initial inbound shipment state');
select ok((api.agent_find_donations(
  'workspace-agent-pgtap','agent-donor-pgtap@example.org',null,10
)->>'identityVerifiedCount')::integer >= 1,
  'exact sender email finds a verified donation');
select ok((api.agent_get_donation_support_snapshot(
  'workspace-agent-pgtap',(select (result->>'donationId')::uuid from donation_fixture),
  'agent-donor-pgtap@example.org'
)->>'identityVerified')::boolean,
  'matching sender receives a private donation support snapshot');
select is((api.agent_get_donation_support_snapshot(
  'workspace-agent-pgtap',(select (result->>'donationId')::uuid from donation_fixture),
  'different-person-pgtap@example.org'
)->>'identityVerified')::boolean,false,
  'mismatched sender is denied the private donation snapshot');

create temporary table donation_authorization as
select api.agent_authorize_support_message(
  'workspace-agent-pgtap','donation_status','agent-donor-pgtap@example.org',
  'Your donation status','A verified donation update.','Verified donation status answer',
  'verified-donation-message-001',null,
  (select (result->>'donationId')::uuid from donation_fixture)
) result;
select is((select result->>'outcome' from donation_authorization),'ALLOW_AUTOMATICALLY',
  'verified donation status update can be authorized automatically');

create temporary table denied_donation_authorization as
select api.agent_authorize_support_message(
  'workspace-agent-pgtap','donation_status','different-person-pgtap@example.org',
  'Your donation status','A private donation update.','Identity mismatch test',
  'denied-donation-message-001',null,
  (select (result->>'donationId')::uuid from donation_fixture)
) result;
select is((select result->>'outcome' from denied_donation_authorization),'ESCALATE',
  'identity mismatch escalates instead of sending private donation facts');

create temporary table sensitive_authorization as
select api.agent_authorize_support_message(
  'workspace-agent-pgtap','general_faq','sensitive-pgtap@example.org',
  'A financial request','Please disburse funds.','Financial action request',
  'sensitive-support-message-001',null,null,null,null,true,false,false,false,false
) result;
select is((select result->>'outcome' from sensitive_authorization),'ESCALATE',
  'a financial-action request is never auto-sent as routine support');

create temporary table inbound_result as
select api.agent_record_inbound_message(
  'workspace-agent-pgtap','gmail','pgtap-inbound-thread','pgtap-inbound-message',
  'agent-donor-pgtap@example.org',jsonb_build_array('tre@donatebymail.org'),
  'Donation question','Donor asked for an update.','gmail:pgtap-inbound-message',now(),
  (select (result->>'donationId')::uuid from donation_fixture),null,null
) result;
select ok((select (result->>'donationLinked')::boolean from inbound_result),
  'verified inbound Gmail message is linked to its donation');
select ok((api.agent_record_inbound_message(
  'workspace-agent-pgtap','gmail','pgtap-inbound-thread','pgtap-inbound-message',
  'agent-donor-pgtap@example.org',jsonb_build_array('tre@donatebymail.org'),
  'Donation question','Donor asked for an update.','gmail:pgtap-inbound-message',now(),
  (select (result->>'donationId')::uuid from donation_fixture),null,null
)->>'replayed')::boolean,
  'replaying an inbound provider message is idempotent');
select is(api.agent_set_communication_thread_status(
  'workspace-agent-pgtap',(select (result->>'threadId')::uuid from inbound_result),'resolved'
)->>'status','resolved','agent can maintain bounded communication workflow state');

create temporary table lead_result as
select api.agent_create_partner_lead(
  'workspace-agent-pgtap','partner-lead-pgtap@example.org','Agent Fixture Nonprofit',
  'Interested in a phone drive.','partner-lead-message-001',null,
  'https://example.org','Email subscribers','Test a pilot','Fall','pgtap-partner-thread'
) result;
select is((select result->>'outcome' from lead_result),'ALLOW_AUTOMATICALLY',
  'agent can autonomously create a bounded partner lead');
select ok((api.agent_create_partner_lead(
  'workspace-agent-pgtap','partner-lead-pgtap@example.org','Agent Fixture Nonprofit',
  'Interested in a phone drive.','partner-lead-message-001',null,
  'https://example.org','Email subscribers','Test a pilot','Fall','pgtap-partner-thread'
)->>'replayed')::boolean,
  'partner lead creation is idempotent');
select ok(api.agent_get_operations_overview('workspace-agent-pgtap') ? 'humanActionQueue',
  'operations overview exposes a human escalation queue');

create temporary table prohibited_decision as
select api.evaluate_agent_command(
  'workspace-agent-pgtap','arbitrary_database_query','database',null,'low','{}'::jsonb,
  repeat('c',64),'a5000000-0000-4000-8000-000000000002','prohibited-command-001'
) result;
select is((select result->>'outcome' from prohibited_decision),'DENY',
  'arbitrary database access remains denied to agents');

create temporary table tre_escalation as
select api.agent_authorize_support_message(
  'workspace-agent-pgtap','internal_escalation','tre@donatebymail.org',
  'Agent escalation','A redacted case requires review.','Redacted internal escalation',
  'internal-escalation-tre-001'
) result;
select is((select result->>'outcome' from tre_escalation),'ALLOW_AUTOMATICALLY',
  'redacted internal escalation to Tre can be sent automatically');

create temporary table wrong_escalation_recipient as
select api.agent_authorize_support_message(
  'workspace-agent-pgtap','internal_escalation','other-admin-pgtap@example.org',
  'Agent escalation','A redacted case requires review.','Wrong escalation recipient',
  'internal-escalation-other-001'
) result;
select is((select result->>'outcome' from wrong_escalation_recipient),'ESCALATE',
  'internal escalation category cannot auto-send to an unapproved recipient');

select * from finish();
rollback;
