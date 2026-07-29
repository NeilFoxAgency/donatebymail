begin;

create extension if not exists pgtap with schema extensions;

select plan(36);

select has_schema('app_private', 'private operational schema exists');
select has_schema('api', 'narrow API schema exists');
select has_table('app_private', 'profiles', 'profile foundation exists');
select has_table('app_private', 'proceeds_policies', 'proceeds policy foundation exists');
select has_table('app_private', 'action_decisions', 'action decision ledger exists');
select has_table('app_private', 'outbox_events', 'transactional outbox exists');

select is(
  (
    select count(*)::bigint
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app_private'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  ),
  0::bigint,
  'RLS is enabled on every private table'
);

select is(
  has_schema_privilege('authenticated', 'app_private', 'usage'),
  false,
  'authenticated cannot use the private schema directly'
);
select is(
  has_schema_privilege('anon', 'app_private', 'usage'),
  false,
  'anonymous callers cannot use the private schema'
);
select is(
  has_schema_privilege('service_role', 'app_private', 'usage'),
  true,
  'service role can use the private schema'
);
select is(
  has_table_privilege('authenticated', 'app_private.proceeds_policies', 'select'),
  false,
  'authenticated has no generic policy-table read access'
);
select is(
  has_table_privilege('service_role', 'app_private.proceeds_policies', 'select'),
  true,
  'service role receives an explicit policy-table grant'
);
select is(
  has_function_privilege(
    'authenticated',
    'api.claim_outbox_events(text,integer,integer)',
    'execute'
  ),
  false,
  'authenticated cannot claim outbox work'
);
select is(
  has_function_privilege(
    'service_role',
    'api.claim_outbox_events(text,integer,integer)',
    'execute'
  ),
  true,
  'service role can call the narrow outbox claim RPC'
);

select is(
  (
    select required_approvals
    from app_private.financial_approval_policies
    where action_type = 'record_disbursement' and lifecycle = 'active'
  ),
  1,
  'beta financial approval defaults to one approver'
);
select is(
  (
    select preparer_may_approve
    from app_private.financial_approval_policies
    where action_type = 'record_disbursement' and lifecycle = 'active'
  ),
  true,
  'beta permits a preparer to satisfy the single approval policy'
);
select is(
  (
    select outcome::text
    from app_private.action_policy_rules
    where command_name = 'send_message'
      and actor = 'agent'
  ),
  'REQUIRE_APPROVAL',
  'beta email automation uses policy-configured approval'
);
select is(
  (
    select outcome::text
    from app_private.action_policy_rules
    where command_name = 'record_physical_receipt'
      and actor = 'agent'
  ),
  'DENY',
  'agent cannot record physical receipt'
);
select is(
  (
    select outcome::text
    from app_private.action_policy_rules
    where command_name = 'execute_disbursement'
      and actor = 'agent'
  ),
  'DENY',
  'agent cannot execute a disbursement'
);

insert into app_private.proceeds_policies (
  id, policy_key, name, purpose, lifecycle
) values (
  '20000000-0000-0000-0000-000000000001',
  'test_effective_dates',
  'Test policy',
  'Validates immutable effective periods.',
  'active'
);

insert into app_private.proceeds_policy_versions (
  id, policy_id, version, lifecycle, calculation_method,
  effective_from, effective_to, approved_at
) values (
  '20000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001',
  1,
  'active',
  'net_proceeds_share',
  '2026-01-01T00:00:00Z',
  '2027-01-01T00:00:00Z',
  now()
);

select throws_ok(
  $$
    insert into app_private.proceeds_policy_versions (
      policy_id, version, lifecycle, calculation_method,
      effective_from, effective_to, approved_at
    ) values (
      '20000000-0000-0000-0000-000000000001', 2, 'active',
      'net_proceeds_share', '2026-06-01T00:00:00Z',
      '2027-06-01T00:00:00Z', now()
    )
  $$,
  '23P01',
  null,
  'active versions for one proceeds policy cannot overlap'
);

insert into app_private.proceeds_policy_assignments (
  id, policy_version_id, scope, scope_id, precedence,
  effective_from, effective_to
) values (
  '20000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000002',
  'general', null, 10,
  '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z'
);

select throws_ok(
  $$
    insert into app_private.proceeds_policy_assignments (
      policy_version_id, scope, scope_id, precedence,
      effective_from, effective_to
    ) values (
      '20000000-0000-0000-0000-000000000002',
      'general', null, 10,
      '2026-06-01T00:00:00Z', '2027-06-01T00:00:00Z'
    )
  $$,
  '23P01',
  null,
  'equally ranked policy assignments cannot overlap'
);

select is(
  (select count(*)::bigint from app_private.proceeds_policy_versions
    where share_basis_points = 5000 and lifecycle = 'active'),
  0::bigint,
  'no universal active 50 percent proceeds policy is seeded'
);
select is(
  (select count(*)::bigint from app_private.proceeds_policy_versions
    where share_basis_points = 5000 and lifecycle = 'draft'),
  1::bigint,
  'local seed demonstrates 50 percent only as draft configuration'
);

select is(
  api.is_reserved_route_slug('admin'),
  true,
  'admin is permanently reserved'
);
select throws_ok(
  $$
    insert into app_private.campaign_route_aliases (
      root_slug, campaign_id, canonical_slug
    ) values (
      'admin', '30000000-0000-0000-0000-000000000001', 'example-campaign'
    )
  $$,
  '23514',
  'campaign alias conflicts with a permanently reserved route',
  'campaign aliases cannot collide with application routes'
);
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values (
  '30000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'route-test@example.com', '',
  now(), now(), now()
);
insert into app_private.organizations (id,name,slug,status,created_by) values (
  '30000000-0000-0000-0000-000000000002','Route Test','route-test','active',
  '30000000-0000-0000-0000-000000000003'
);
insert into app_private.charities(id,pledge_id,canonical_name,status,verified_by,verified_at) values(
  '30000000-0000-0000-0000-000000000004','3685b542-61d5-45da-9580-162dca725966',
  'Route Test Charity','verified','30000000-0000-0000-0000-000000000003',now()
);
insert into app_private.organization_charities(organization_id,charity_id,status,verified_by,verified_at) values(
  '30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000004','verified',
  '30000000-0000-0000-0000-000000000003',now()
);
insert into app_private.campaigns (
  id,organization_id,slug,name,selected_charity_pledge_id,
  selected_charity_name,charity_id,created_by
) values (
  '30000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002',
  'give-kids-the-world','Give Kids the World',
  '3685b542-61d5-45da-9580-162dca725966','Route Test Charity','30000000-0000-0000-0000-000000000004',
  '30000000-0000-0000-0000-000000000003'
);
select lives_ok(
  $$
    insert into app_private.campaign_route_aliases (
      root_slug, campaign_id, canonical_slug
    ) values (
      'give-kids-the-world',
      '30000000-0000-0000-0000-000000000001',
      'give-kids-the-world'
    )
  $$,
  'a safe root-level vanity alias can be reserved'
);
select throws_ok(
  $$delete from app_private.reserved_route_slugs where slug = 'admin'$$,
  '55000',
  'permanent reserved route slugs cannot be removed or renamed',
  'permanent route reservations cannot be deleted'
);

insert into app_private.audit_events (
  id, actor, actor_ref, action_name, entity_type, entity_id
) values (
  '40000000-0000-0000-0000-000000000001',
  'system', 'test', 'test.created', 'test_record',
  '40000000-0000-0000-0000-000000000002'
);
select throws_ok(
  $$
    update app_private.audit_events
    set reason_code = 'changed'
    where id = '40000000-0000-0000-0000-000000000001'
  $$,
  '55000',
  'audit_events is append-only',
  'audit history cannot be updated'
);

insert into app_private.domain_events (
  id, event_type, aggregate_type, aggregate_id,
  aggregate_version, payload
) values (
  '50000000-0000-0000-0000-000000000001',
  'test.created', 'test_record',
  '50000000-0000-0000-0000-000000000002', 1,
  '{"recordId":"50000000-0000-0000-0000-000000000002"}'::jsonb
);
select throws_ok(
  $$
    update app_private.domain_events
    set event_type = 'test.changed'
    where id = '50000000-0000-0000-0000-000000000001'
  $$,
  '55000',
  'domain_events is append-only',
  'domain event history cannot be updated'
);

insert into app_private.outbox_events (
  id, domain_event_id, handler_key, event_type, payload
) values (
  '50000000-0000-0000-0000-000000000003',
  '50000000-0000-0000-0000-000000000001',
  'test_handler', 'test.created',
  '{"recordId":"50000000-0000-0000-0000-000000000002"}'::jsonb
);

select set_config('request.jwt.claim.role', '', true);
select throws_ok(
  $$select count(*) from api.claim_outbox_events('test-worker', 10, 60)$$,
  '42501',
  'service role required',
  'outbox claim fails closed without a service claim'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select results_eq(
  $$select count(*) from api.claim_outbox_events('test-worker', 10, 60)$$,
  array[1::bigint],
  'the direct processor leases one due event'
);
select results_eq(
  $$select count(*) from api.claim_outbox_events('second-worker', 10, 60)$$,
  array[0::bigint],
  'a leased event cannot be claimed concurrently'
);
select is(
  api.complete_outbox_event(
    '50000000-0000-0000-0000-000000000003', 'wrong-worker'
  ),
  false,
  'another worker cannot complete the lease'
);
select is(
  api.complete_outbox_event(
    '50000000-0000-0000-0000-000000000003', 'test-worker'
  ),
  true,
  'the lease owner can complete the event'
);
select is(
  (
    select status::text from app_private.outbox_events
    where id = '50000000-0000-0000-0000-000000000003'
  ),
  'completed',
  'outbox completion is persisted'
);

insert into app_private.action_decisions (
  id, command_name, actor, actor_ref, risk, outcome,
  rationale_code, input_hash, correlation_id
) values (
  '60000000-0000-0000-0000-000000000001',
  'send_message', 'agent', 'test-agent', 'low',
  'REQUIRE_APPROVAL', 'test_policy', repeat('a', 64),
  '60000000-0000-0000-0000-000000000002'
);
select throws_ok(
  $$
    update app_private.action_decisions
    set outcome = 'ALLOW_AUTOMATICALLY'
    where id = '60000000-0000-0000-0000-000000000001'
  $$,
  '55000',
  'action_decisions is append-only',
  'recorded policy decisions cannot be rewritten'
);

select * from finish();
rollback;
