begin;

create extension if not exists pgtap with schema extensions;

select plan(37);

select has_table('app_private', 'donations', 'donations table exists');
select has_table('app_private', 'donation_devices', 'donation devices table exists');
select has_table('app_private', 'donation_shipments', 'donation shipments table exists');
select has_table('app_private', 'device_sale_results', 'device sale results table exists');
select has_table('app_private', 'donation_costs', 'donation costs table exists');
select has_table('app_private', 'proceeds_allocations', 'proceeds allocations table exists');
select has_table('app_private', 'disbursements', 'disbursements table exists');
select has_table('app_private', 'audit_events', 'audit events table exists');
select has_table('app_private', 'domain_events', 'domain events table exists');
select has_table('app_private', 'outbox_events', 'outbox events table exists');
select has_table('app_private', 'action_decisions', 'action decisions table exists');
select has_table('app_private', 'agent_actions', 'agent actions table exists');
select has_table('app_private', 'agent_escalations', 'agent escalations table exists');
select has_table('app_private', 'semantic_command_registry', 'semantic command registry table exists');

select has_type('app_private', 'donation_status', 'donation status enum exists');
select has_type('app_private', 'device_inspection_status', 'inspection status enum exists');
select has_type('app_private', 'allocation_status', 'allocation status enum exists');
select has_type('app_private', 'action_policy_outcome', 'action outcome enum exists');
select has_type('app_private', 'risk_level', 'risk level enum exists');

select col_is_pk('app_private', 'donations', 'id', 'donations use UUID primary key');
select col_type_is('app_private', 'donations', 'id', 'uuid', 'donation ID is UUID');
select col_type_is('app_private', 'donation_devices', 'assessed_value_cents', 'bigint', 'values use integer cents');
select col_type_is('app_private', 'proceeds_allocations', 'share_basis_points', 'integer', 'shares use basis points');
select col_type_is('app_private', 'proceeds_policy_versions', 'eligibility_rules', 'jsonb', 'policy eligibility is versioned JSON');

select has_index('app_private', 'donations', 'donations_public_id_key', 'public donation ID is unique');
select has_index('app_private', 'donations', 'donations_client_submission_key_key', 'client submission key is unique');
select has_index('app_private', 'outbox_events', 'outbox_events_domain_event_id_handler_key_key', 'outbox delivery is idempotent by handler');
select has_index('app_private', 'proceeds_policies', 'proceeds_policies_policy_key_key', 'policy keys are unique');

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
    select r.outcome::text
    from app_private.action_policy_rules r
    join app_private.action_policy_versions v on v.id = r.policy_version_id
    where r.command_name = 'send_message'
      and r.actor = 'agent'
      and r.target_type is null
      and v.lifecycle = 'active'
  ),
  'REQUIRE_APPROVAL',
  'generic beta email automation remains policy-configured for approval'
);
select is(
  (
    select r.outcome::text
    from app_private.action_policy_rules r
    join app_private.action_policy_versions v on v.id = r.policy_version_id
    where r.command_name = 'record_physical_receipt'
      and r.actor = 'agent'
      and v.lifecycle = 'active'
  ),
  'DENY',
  'agent cannot record physical receipt'
);
select is(
  (
    select r.outcome::text
    from app_private.action_policy_rules r
    join app_private.action_policy_versions v on v.id = r.policy_version_id
    where r.command_name = 'execute_disbursement'
      and r.actor = 'agent'
      and v.lifecycle = 'active'
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
  'Validate immutable policy constraints',
  'draft'
);
insert into app_private.proceeds_policy_versions (
  id, policy_id, version, lifecycle, share_basis_points,
  calculation_method, eligibility_rules, effective_from
) values (
  '20000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000001',
  1,
  'draft',
  5000,
  'net_proceeds_share',
  '{"minimum_assessed_value_cents": 100}'::jsonb,
  '2026-01-01T00:00:00Z'
);

select throws_ok(
  $$
    update app_private.proceeds_policy_versions
    set effective_from = '2025-01-01T00:00:00Z'
    where id = '20000000-0000-0000-0000-000000000002'
  $$,
  'policy version effective dates and eligibility are immutable',
  'policy history cannot be rewritten'
);

insert into app_private.donor_contacts (
  id, first_name, last_name, email, email_search,
  address_line_1, city, region, postal_code, country_code
) values (
  '30000000-0000-0000-0000-000000000001',
  'Test',
  'Donor',
  'test@example.org',
  'test@example.org',
  '1 Main Street',
  'Kissimmee',
  'FL',
  '34741',
  'US'
);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values('30000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000000','authenticated','authenticated','staff-foundation@example.org','',now(),now(),now());
insert into app_private.donations (
  id, public_id, client_submission_key, donor_contact_id, shipping_method,
  selected_charity_pledge_id, selected_charity_name, tracking_nonce,
  policy_version_snapshot_id, request_hash, claim_nonce
) values (
  '30000000-0000-0000-0000-000000000002',
  'DBM-20260101-ABCDEF12',
  'test-client-submission-key',
  '30000000-0000-0000-0000-000000000001',
  'label',
  '30000000-0000-0000-0000-000000000003',
  'Test Charity',
  '30000000-0000-0000-0000-000000000004',
  '20000000-0000-0000-0000-000000000002',
  repeat('d', 64),
  '30000000-0000-0000-0000-000000000010'
);
insert into app_private.donation_devices (
  id, donation_id, source, donor_device_key, donor_brand, donor_model,
  donor_age, donor_condition, donor_storage, donor_powers_on, donor_unlocked
) values (
  '30000000-0000-0000-0000-000000000005',
  '30000000-0000-0000-0000-000000000002',
  'expected',
  'test-device',
  'Apple',
  'iPhone 13',
  '2-3 years',
  'good',
  '128 GB',
  true,
  true
);
insert into app_private.device_sale_results (
  id, device_id, gross_amount_cents, channel, sold_at, recorded_by
) values (
  '30000000-0000-0000-0000-000000000006',
  '30000000-0000-0000-0000-000000000005',
  10000,
  'test',
  now(),
  '30000000-0000-0000-0000-000000000007'
);
insert into app_private.donation_costs (
  id, donation_id, device_id, category, amount_cents, incurred_at, recorded_by
) values (
  '30000000-0000-0000-0000-000000000008',
  '30000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000005',
  'shipping',
  1000,
  now(),
  '30000000-0000-0000-0000-000000000007'
);
insert into app_private.proceeds_allocations (
  id, donation_id, policy_version_id, beneficiary_pledge_id,
  gross_cents, eligible_cost_cents, allocable_base_cents,
  share_basis_points, allocated_cents, status, calculation_snapshot,
  calculated_by, calculated_at
) values (
  '30000000-0000-0000-0000-000000000009',
  '30000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000003',
  10000,
  1000,
  9000,
  5000,
  4500,
  'calculated',
  '{"test":true}'::jsonb,
  '30000000-0000-0000-0000-000000000007',
  now()
);

select throws_ok(
  $$
    update app_private.proceeds_allocations
    set allocated_cents = 4000
    where id = '30000000-0000-0000-0000-000000000009'
  $$,
  'proceeds allocation calculation is immutable',
  'allocation accounting cannot be silently edited'
);

select throws_ok(
  $$
    update app_private.device_sale_results
    set gross_amount_cents = 11000
    where id = '30000000-0000-0000-0000-000000000006'
  $$,
  'device_sale_results is append-only',
  'sales history cannot be rewritten'
);

select throws_ok(
  $$
    delete from app_private.donation_costs
    where id = '30000000-0000-0000-0000-000000000008'
  $$,
  'donation_costs is append-only',
  'cost history cannot be erased'
);

select finish();
rollback;
