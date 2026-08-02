create extension if not exists btree_gist with schema extensions;

create schema if not exists app_private;
create schema if not exists api;

comment on schema app_private is
  'Private Donate by Mail operational data. Not exposed through the Data API.';
comment on schema api is
  'Narrow reviewed RPC surface. No generic table CRUD is exposed here.';

revoke all on schema app_private from public, anon, authenticated;
revoke all on schema api from public, anon, authenticated;
grant usage on schema app_private to service_role;
grant usage on schema api to service_role;

create type app_private.membership_status as enum (
  'invited', 'active', 'suspended', 'removed'
);
create type app_private.staff_role as enum ('staff', 'admin');
create type app_private.organization_status as enum (
  'prospect', 'active', 'paused', 'ended'
);
create type app_private.organization_role as enum (
  'partner_member', 'partner_admin'
);
create type app_private.policy_lifecycle as enum (
  'draft', 'approved', 'active', 'retired'
);
create type app_private.proceeds_scope as enum (
  'general', 'charity', 'partnership', 'campaign'
);
create type app_private.proceeds_calculation_method as enum (
  'net_proceeds_share', 'fixed_amount', 'custom'
);
create type app_private.cost_allocation_method as enum (
  'direct', 'pro_rata', 'fixed', 'capped'
);
create type app_private.actor_kind as enum (
  'donor', 'partner', 'staff', 'service', 'agent', 'system'
);
create type app_private.risk_level as enum (
  'low', 'moderate', 'high', 'critical'
);
create type app_private.action_policy_outcome as enum (
  'ALLOW_AUTOMATICALLY', 'REQUIRE_APPROVAL', 'ESCALATE', 'DENY'
);
create type app_private.action_execution_status as enum (
  'pending', 'allowed', 'awaiting_approval', 'escalated', 'denied',
  'executed', 'failed'
);
create type app_private.approval_outcome as enum (
  'approved', 'rejected', 'expired', 'cancelled'
);
create type app_private.agent_action_status as enum (
  'proposed', 'approved', 'running', 'completed', 'failed', 'cancelled'
);
create type app_private.escalation_status as enum (
  'open', 'acknowledged', 'resolved', 'dismissed'
);
create type app_private.outbox_status as enum (
  'pending', 'processing', 'retry', 'completed', 'failed'
);
create type app_private.campaign_alias_behavior as enum ('redirect', 'render');
create type app_private.campaign_alias_status as enum ('active', 'retired');

create table app_private.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (display_name is null or char_length(display_name) between 1 and 120)
);

create table app_private.staff_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role app_private.staff_role not null,
  status app_private.membership_status not null default 'invited',
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  activated_at timestamptz,
  suspended_at timestamptz,
  updated_at timestamptz not null default now()
);

create table app_private.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status app_private.organization_status not null default 'prospect',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app_private.organization_memberships (
  organization_id uuid not null references app_private.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_private.organization_role not null,
  status app_private.membership_status not null default 'invited',
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  activated_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_memberships_user_idx
  on app_private.organization_memberships (user_id, status);

create table app_private.proceeds_policies (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null unique
    check (policy_key ~ '^[a-z][a-z0-9_]{2,79}$'),
  name text not null check (char_length(name) between 1 and 160),
  purpose text not null check (char_length(purpose) between 1 and 1000),
  lifecycle app_private.policy_lifecycle not null default 'draft',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app_private.proceeds_policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references app_private.proceeds_policies(id) on delete restrict,
  version integer not null check (version > 0),
  lifecycle app_private.policy_lifecycle not null default 'draft',
  share_basis_points integer check (
    share_basis_points is null or share_basis_points between 0 and 10000
  ),
  calculation_method app_private.proceeds_calculation_method not null,
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  eligibility_rule_schema_version integer not null default 1
    check (eligibility_rule_schema_version > 0),
  eligibility_rules jsonb not null default '{}'::jsonb
    check (jsonb_typeof(eligibility_rules) = 'object'),
  effective_from timestamptz not null,
  effective_to timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (policy_id, version),
  check (effective_to is null or effective_to > effective_from),
  check (
    lifecycle not in ('approved', 'active')
    or approved_at is not null
  )
);

alter table app_private.proceeds_policy_versions
  add constraint proceeds_policy_versions_no_active_overlap
  exclude using gist (
    policy_id with =,
    tstzrange(effective_from, effective_to, '[)') with &&
  ) where (lifecycle in ('approved', 'active'));

create table app_private.proceeds_policy_cost_rules (
  id uuid primary key default gen_random_uuid(),
  policy_version_id uuid not null
    references app_private.proceeds_policy_versions(id) on delete cascade,
  cost_category text not null
    check (cost_category ~ '^[a-z][a-z0-9_]{2,79}$'),
  deductible boolean not null,
  allocation_method app_private.cost_allocation_method not null,
  cap_basis_points integer check (
    cap_basis_points is null or cap_basis_points between 0 and 10000
  ),
  priority integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  unique (policy_version_id, cost_category)
);

create table app_private.proceeds_policy_assignments (
  id uuid primary key default gen_random_uuid(),
  policy_version_id uuid not null
    references app_private.proceeds_policy_versions(id) on delete restrict,
  scope app_private.proceeds_scope not null,
  scope_id uuid,
  precedence integer not null default 0,
  effective_from timestamptz not null,
  effective_to timestamptz,
  enabled boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  check (
    (scope = 'general' and scope_id is null)
    or (scope <> 'general' and scope_id is not null)
  )
);

alter table app_private.proceeds_policy_assignments
  add constraint proceeds_policy_assignments_no_ambiguous_overlap
  exclude using gist (
    scope with =,
    coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    precedence with =,
    tstzrange(effective_from, effective_to, '[)') with &&
  ) where (enabled);

create index proceeds_policy_assignments_resolution_idx
  on app_private.proceeds_policy_assignments
  (scope, scope_id, enabled, precedence desc, effective_from);

create table app_private.financial_approval_policies (
  id uuid primary key default gen_random_uuid(),
  action_type text not null check (action_type ~ '^[a-z][a-z0-9_]{2,79}$'),
  version integer not null check (version > 0),
  lifecycle app_private.policy_lifecycle not null default 'draft',
  required_approvals integer not null default 1
    check (required_approvals between 1 and 10),
  preparer_may_approve boolean not null default true,
  conditions jsonb not null default '{}'::jsonb
    check (jsonb_typeof(conditions) = 'object'),
  effective_from timestamptz not null,
  effective_to timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (action_type, version),
  check (effective_to is null or effective_to > effective_from),
  check (
    lifecycle not in ('approved', 'active')
    or approved_at is not null
  )
);

alter table app_private.financial_approval_policies
  add constraint financial_approval_policies_no_active_overlap
  exclude using gist (
    action_type with =,
    tstzrange(effective_from, effective_to, '[)') with &&
  ) where (lifecycle in ('approved', 'active'));

create table app_private.action_policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null check (policy_key ~ '^[a-z][a-z0-9_]{2,79}$'),
  version integer not null check (version > 0),
  lifecycle app_private.policy_lifecycle not null default 'draft',
  effective_from timestamptz not null,
  effective_to timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (policy_key, version),
  check (effective_to is null or effective_to > effective_from),
  check (
    lifecycle not in ('approved', 'active')
    or approved_at is not null
  )
);

alter table app_private.action_policy_versions
  add constraint action_policy_versions_no_active_overlap
  exclude using gist (
    policy_key with =,
    tstzrange(effective_from, effective_to, '[)') with &&
  ) where (lifecycle in ('approved', 'active'));

create table app_private.action_policy_rules (
  id uuid primary key default gen_random_uuid(),
  policy_version_id uuid not null
    references app_private.action_policy_versions(id) on delete cascade,
  command_name text not null
    check (command_name = '*' or command_name ~ '^[a-z][a-z0-9_]{2,79}$'),
  actor app_private.actor_kind,
  risk_levels app_private.risk_level[] not null,
  target_type text,
  outcome app_private.action_policy_outcome not null,
  rationale_code text not null
    check (rationale_code ~ '^[a-z][a-z0-9_]{2,79}$'),
  priority integer not null default 0,
  conditions jsonb not null default '{}'::jsonb
    check (jsonb_typeof(conditions) = 'object'),
  created_at timestamptz not null default now(),
  check (cardinality(risk_levels) > 0),
  check (target_type is null or target_type ~ '^[a-z][a-z0-9_]{2,79}$')
);

create index action_policy_rules_lookup_idx
  on app_private.action_policy_rules
  (command_name, actor, priority desc, policy_version_id);

create table app_private.action_decisions (
  id uuid primary key default gen_random_uuid(),
  policy_version_id uuid references app_private.action_policy_versions(id) on delete restrict,
  policy_rule_id uuid references app_private.action_policy_rules(id) on delete restrict,
  command_name text not null
    check (command_name ~ '^[a-z][a-z0-9_]{2,79}$'),
  actor app_private.actor_kind not null,
  actor_ref text not null check (char_length(actor_ref) between 1 and 200),
  target_type text,
  target_id uuid,
  risk app_private.risk_level not null,
  context jsonb not null default '{}'::jsonb
    check (jsonb_typeof(context) = 'object'),
  outcome app_private.action_policy_outcome not null,
  rationale_code text not null,
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  correlation_id uuid not null,
  idempotency_key text,
  execution_status app_private.action_execution_status not null default 'pending',
  decided_at timestamptz not null default now(),
  check (idempotency_key is null or char_length(idempotency_key) between 8 and 200)
);

create unique index action_decisions_idempotency_idx
  on app_private.action_decisions (actor, actor_ref, idempotency_key)
  where idempotency_key is not null;

create table app_private.action_approvals (
  id uuid primary key default gen_random_uuid(),
  action_decision_id uuid not null
    references app_private.action_decisions(id) on delete restrict,
  approver_user_id uuid not null references auth.users(id) on delete restrict,
  outcome app_private.approval_outcome not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (action_decision_id, approver_user_id)
);

create table app_private.action_execution_results (
  id uuid primary key default gen_random_uuid(),
  action_decision_id uuid not null
    references app_private.action_decisions(id) on delete restrict,
  status app_private.action_execution_status not null,
  executor app_private.actor_kind not null,
  executor_ref text not null,
  result_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(result_metadata) = 'object'),
  verification_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(verification_metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table app_private.agent_actions (
  id uuid primary key default gen_random_uuid(),
  action_decision_id uuid not null unique
    references app_private.action_decisions(id) on delete restrict,
  agent_ref text not null check (char_length(agent_ref) between 1 and 200),
  status app_private.agent_action_status not null default 'proposed',
  invocation_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(invocation_metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app_private.agent_escalations (
  id uuid primary key default gen_random_uuid(),
  agent_action_id uuid not null
    references app_private.agent_actions(id) on delete restrict,
  severity app_private.risk_level not null,
  reason_code text not null
    check (reason_code ~ '^[a-z][a-z0-9_]{2,79}$'),
  summary text not null check (char_length(summary) between 1 and 2000),
  status app_private.escalation_status not null default 'open',
  assigned_to uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index agent_escalations_queue_idx
  on app_private.agent_escalations (status, severity, created_at);

create table app_private.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor app_private.actor_kind not null,
  actor_ref text not null check (char_length(actor_ref) between 1 and 200),
  action_name text not null check (action_name ~ '^[a-z][a-z0-9_.]{2,119}$'),
  entity_type text not null check (entity_type ~ '^[a-z][a-z0-9_]{2,79}$'),
  entity_id uuid,
  request_id uuid,
  correlation_id uuid,
  reason_code text,
  redacted_changes jsonb not null default '{}'::jsonb
    check (jsonb_typeof(redacted_changes) = 'object'),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now()
);

create index audit_events_entity_idx
  on app_private.audit_events (entity_type, entity_id, occurred_at desc);
create index audit_events_correlation_idx
  on app_private.audit_events (correlation_id)
  where correlation_id is not null;

create table app_private.domain_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.]{2,119}$'),
  aggregate_type text not null check (aggregate_type ~ '^[a-z][a-z0-9_]{2,79}$'),
  aggregate_id uuid not null,
  aggregate_version integer not null check (aggregate_version > 0),
  correlation_id uuid,
  causation_id uuid,
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default now(),
  unique (aggregate_type, aggregate_id, aggregate_version, event_type)
);

create index domain_events_aggregate_idx
  on app_private.domain_events (aggregate_type, aggregate_id, occurred_at);

create table app_private.outbox_events (
  id uuid primary key default gen_random_uuid(),
  domain_event_id uuid not null
    references app_private.domain_events(id) on delete restrict,
  handler_key text not null check (handler_key ~ '^[a-z][a-z0-9_.-]{2,119}$'),
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.]{2,119}$'),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  status app_private.outbox_status not null default 'pending',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 25),
  available_at timestamptz not null default now(),
  locked_by text,
  locked_until timestamptz,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (domain_event_id, handler_key),
  check ((locked_by is null) = (locked_until is null)),
  check (last_error_code is null or char_length(last_error_code) <= 160)
);

create index outbox_events_claim_idx
  on app_private.outbox_events (status, available_at, created_at)
  where status in ('pending', 'retry');

create table app_private.outbox_handler_receipts (
  outbox_event_id uuid not null
    references app_private.outbox_events(id) on delete restrict,
  handler_name text not null,
  completed_at timestamptz not null default now(),
  result_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(result_metadata) = 'object'),
  primary key (outbox_event_id, handler_name)
);

create table app_private.reserved_route_slugs (
  slug text primary key check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  reason text not null check (char_length(reason) between 1 and 300),
  permanent boolean not null default true,
  created_at timestamptz not null default now()
);

create table app_private.campaign_route_aliases (
  id uuid primary key default gen_random_uuid(),
  root_slug text not null check (root_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  campaign_id uuid not null,
  canonical_slug text not null
    check (canonical_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  behavior app_private.campaign_alias_behavior not null default 'redirect',
  status app_private.campaign_alias_status not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  retired_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  check ((status = 'retired') = (retired_at is not null))
);

comment on column app_private.campaign_route_aliases.campaign_id is
  'Opaque campaign identifier in Phase 1A; a foreign key is added with the campaign identity table.';

create unique index campaign_route_aliases_active_slug_idx
  on app_private.campaign_route_aliases (root_slug)
  where status = 'active';

insert into app_private.reserved_route_slugs (slug, reason) values
  ('about', 'existing public route'),
  ('accessibility', 'existing public route'),
  ('admin', 'reserved application namespace'),
  ('api', 'reserved API namespace'),
  ('app', 'reserved donor application namespace'),
  ('auth', 'reserved authentication namespace'),
  ('c', 'canonical campaign namespace'),
  ('contact', 'existing public route'),
  ('data-security', 'existing public route'),
  ('donate-phone', 'existing donation route'),
  ('favicon', 'reserved site asset'),
  ('for-nonprofits', 'existing public route'),
  ('get-involved', 'existing public route'),
  ('help', 'reserved help route'),
  ('how-it-works', 'existing public route'),
  ('index', 'site root document'),
  ('llms', 'AI-readable site metadata'),
  ('partner', 'reserved partner application namespace'),
  ('phone-drives', 'existing public route'),
  ('prepare-phone', 'existing public route'),
  ('privacy', 'existing policy route'),
  ('receipts', 'existing public route'),
  ('resources', 'existing public route'),
  ('robots', 'reserved crawler metadata'),
  ('security', 'reserved security metadata'),
  ('sitemap', 'reserved crawler metadata'),
  ('site-shell', 'reserved site asset'),
  ('team', 'existing public route'),
  ('terms', 'existing policy route'),
  ('transparency', 'existing public route'),
  ('www', 'reserved hostname label')
on conflict (slug) do nothing;

create function app_private.prevent_update_or_delete()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end;
$$;

create trigger audit_events_append_only
before update or delete on app_private.audit_events
for each row execute function app_private.prevent_update_or_delete();

create trigger domain_events_append_only
before update or delete on app_private.domain_events
for each row execute function app_private.prevent_update_or_delete();

create trigger action_decisions_append_only
before update or delete on app_private.action_decisions
for each row execute function app_private.prevent_update_or_delete();

create trigger action_approvals_append_only
before update or delete on app_private.action_approvals
for each row execute function app_private.prevent_update_or_delete();

create trigger action_execution_results_append_only
before update or delete on app_private.action_execution_results
for each row execute function app_private.prevent_update_or_delete();

create function app_private.protect_reserved_route_slug()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.permanent and (tg_op = 'DELETE' or new.slug <> old.slug or not new.permanent) then
    raise exception 'permanent reserved route slugs cannot be removed or renamed'
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger reserved_route_slugs_permanent
before update or delete on app_private.reserved_route_slugs
for each row execute function app_private.protect_reserved_route_slug();

create function app_private.enforce_campaign_route_alias()
returns trigger
language plpgsql
set search_path = pg_catalog, app_private
as $$
begin
  new.root_slug := lower(trim(both '/' from new.root_slug));
  new.canonical_slug := lower(trim(both '/' from new.canonical_slug));
  if exists (
    select 1 from app_private.reserved_route_slugs where slug = new.root_slug
  ) then
    raise exception 'campaign alias conflicts with a permanently reserved route'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger campaign_route_aliases_validate
before insert or update of root_slug, canonical_slug, status
on app_private.campaign_route_aliases
for each row execute function app_private.enforce_campaign_route_alias();

create function api.claim_outbox_events(
  worker_id text,
  batch_size integer default 20,
  lease_seconds integer default 60
)
returns table (
  id uuid,
  domain_event_id uuid,
  handler_key text,
  event_type text,
  payload jsonb,
  attempt_count integer,
  max_attempts integer,
  locked_until timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if char_length(worker_id) not between 3 and 120 then
    raise exception 'invalid worker id' using errcode = '22023';
  end if;
  if batch_size not between 1 and 100 or lease_seconds not between 10 and 900 then
    raise exception 'invalid outbox lease bounds' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select candidate.id
    from app_private.outbox_events as candidate
    where candidate.status in ('pending', 'retry')
      and candidate.available_at <= now()
      and (candidate.locked_until is null or candidate.locked_until < now())
      and candidate.attempt_count < candidate.max_attempts
    order by candidate.available_at, candidate.created_at
    for update skip locked
    limit batch_size
  )
  update app_private.outbox_events as event
  set status = 'processing',
      locked_by = worker_id,
      locked_until = now() + make_interval(secs => lease_seconds),
      attempt_count = event.attempt_count + 1,
      updated_at = now()
  from candidates
  where event.id = candidates.id
  returning event.id, event.domain_event_id, event.handler_key,
    event.event_type, event.payload, event.attempt_count,
    event.max_attempts, event.locked_until;
end;
$$;

create function api.complete_outbox_event(event_id uuid, worker_id text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
declare
  changed integer;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update app_private.outbox_events
  set status = 'completed', completed_at = now(), locked_by = null,
      locked_until = null, last_error_code = null, updated_at = now()
  where id = event_id and status = 'processing' and locked_by = worker_id;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create function api.fail_outbox_event(
  event_id uuid,
  worker_id text,
  retry_at timestamptz,
  error_code text,
  retryable boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
declare
  changed integer;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if error_code is null or char_length(error_code) not between 1 and 160 then
    raise exception 'invalid redacted error code' using errcode = '22023';
  end if;
  update app_private.outbox_events
  set status = case
        when retryable and attempt_count < max_attempts then 'retry'::app_private.outbox_status
        else 'failed'::app_private.outbox_status
      end,
      available_at = case
        when retryable and attempt_count < max_attempts then retry_at
        else available_at
      end,
      locked_by = null,
      locked_until = null,
      last_error_code = error_code,
      updated_at = now()
  where id = event_id and status = 'processing' and locked_by = worker_id;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create function api.is_reserved_route_slug(candidate_slug text)
returns boolean
language sql
security invoker
set search_path = pg_catalog, app_private
stable
as $$
  select exists (
    select 1
    from app_private.reserved_route_slugs
    where slug = lower(trim(both '/' from candidate_slug))
  );
$$;

do $$
declare
  table_record record;
begin
  for table_record in
    select tablename from pg_tables where schemaname = 'app_private'
  loop
    execute format(
      'alter table app_private.%I enable row level security',
      table_record.tablename
    );
  end loop;
end;
$$;

revoke all on all tables in schema app_private from public, anon, authenticated;
revoke all on all sequences in schema app_private from public, anon, authenticated;
revoke all on all functions in schema app_private from public, anon, authenticated;
revoke all on all functions in schema api from public, anon, authenticated;

grant select, insert, update, delete on all tables in schema app_private to service_role;
grant usage, select on all sequences in schema app_private to service_role;
grant execute on all functions in schema app_private to service_role;
grant execute on function api.claim_outbox_events(text, integer, integer) to service_role;
grant execute on function api.complete_outbox_event(uuid, text) to service_role;
grant execute on function api.fail_outbox_event(uuid, text, timestamptz, text, boolean) to service_role;
grant execute on function api.is_reserved_route_slug(text) to service_role;

alter default privileges for role postgres in schema app_private
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema app_private
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema app_private
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema api
  revoke execute on functions from public, anon, authenticated;

insert into app_private.financial_approval_policies (
  action_type, version, lifecycle, required_approvals,
  preparer_may_approve, conditions, effective_from, approved_at
) values (
  'record_disbursement', 1, 'active', 1, true,
  '{"environment":"beta"}'::jsonb, '2026-01-01T00:00:00Z', now()
);

with policy_version as (
  insert into app_private.action_policy_versions (
    policy_key, version, lifecycle, effective_from, approved_at
  ) values (
    'beta_agent_actions', 1, 'active', '2026-01-01T00:00:00Z', now()
  )
  returning id
)
insert into app_private.action_policy_rules (
  policy_version_id, command_name, actor, risk_levels,
  outcome, rationale_code, priority
)
select id, command_name, 'agent'::app_private.actor_kind,
  risk_levels, outcome, rationale_code, priority
from policy_version
cross join (
  values
    ('send_message', array['low']::app_private.risk_level[],
      'REQUIRE_APPROVAL'::app_private.action_policy_outcome,
      'beta_external_message_review', 100),
    ('update_campaign_content', array['low']::app_private.risk_level[],
      'REQUIRE_APPROVAL'::app_private.action_policy_outcome,
      'beta_campaign_edit_review', 100),
    ('publish_campaign_revision', array['low', 'moderate']::app_private.risk_level[],
      'REQUIRE_APPROVAL'::app_private.action_policy_outcome,
      'beta_campaign_publish_review', 100),
    ('record_physical_receipt', array['low', 'moderate', 'high', 'critical']::app_private.risk_level[],
      'DENY'::app_private.action_policy_outcome,
      'human_physical_verification_required', 1000),
    ('record_device_valuation', array['low', 'moderate', 'high', 'critical']::app_private.risk_level[],
      'DENY'::app_private.action_policy_outcome,
      'human_device_valuation_required', 1000),
    ('execute_disbursement', array['low', 'moderate', 'high', 'critical']::app_private.risk_level[],
      'DENY'::app_private.action_policy_outcome,
      'human_financial_execution_required', 1000),
    ('arbitrary_database_query', array['low', 'moderate', 'high', 'critical']::app_private.risk_level[],
      'DENY'::app_private.action_policy_outcome,
      'arbitrary_database_access_prohibited', 1000)
) as seed_rules(command_name, risk_levels, outcome, rationale_code, priority);
