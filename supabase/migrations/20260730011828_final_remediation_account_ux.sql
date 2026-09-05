-- Final beta remediation: close the financial revision lifecycle, make cost
-- calculations reproducible, complete partner invitation delivery, and expose
-- a role-aware account gateway. Production schemas and resources are not used.

-- A snapshot is allowed to contain zero resale-eligible devices. A donation
-- with only recycle/parts/return outcomes is a valid no-proceeds result.
alter table app_private.financial_reconciliation_snapshots
  drop constraint if exists financial_reconciliation_snapshots_eligible_device_count_check;
alter table app_private.financial_reconciliation_snapshots
  add constraint financial_reconciliation_snapshots_eligible_device_count_check
  check (eligible_device_count >= 0);

-- A reversal is historical. This view is the only definition of a current
-- proceeds allocation used by the finalizer and operational reads.
create or replace view app_private.effective_proceeds_allocations
with (security_invoker = true) as
select a.*
from app_private.proceeds_allocations a
where a.status in ('calculated','approved','disbursed','policy_hold')
  and not exists (
    select 1 from app_private.proceeds_allocations reversal
    where reversal.status = 'reversed' and reversal.reversal_of = a.id
  );
revoke all on app_private.effective_proceeds_allocations from public, anon, authenticated;
grant select on app_private.effective_proceeds_allocations to service_role;

-- One authoritative, fail-closed cost calculation primitive. The cap is
-- explicitly based on the frozen gross proceeds in the reconciliation
-- snapshot. Pro-rata is a shared cost applied once to the snapshot; the
-- deterministic remainder schedule is stored in the calculation evidence.
create or replace function app_private.calculate_policy_cost_cents(
  cost_amount_cents bigint,
  allocation_method app_private.cost_allocation_method,
  cap_basis_points integer,
  rule_metadata jsonb,
  gross_proceeds_cents bigint
) returns bigint
language plpgsql immutable
set search_path = pg_catalog, app_private
as $$
declare fixed_cents bigint;
begin
  if cost_amount_cents < 0 or gross_proceeds_cents < 0 then
    raise exception 'financial amounts cannot be negative' using errcode = '22023';
  end if;
  case allocation_method
    when 'direct' then return cost_amount_cents;
    when 'pro_rata' then return cost_amount_cents;
    when 'capped' then
      if cap_basis_points is null or cap_basis_points not between 0 and 10000 then
        return null;
      end if;
      return least(cost_amount_cents,
        greatest(0, ((gross_proceeds_cents::numeric * cap_basis_points) / 10000)::bigint));
    when 'fixed' then
      if rule_metadata is null or jsonb_typeof(rule_metadata) <> 'object'
        or not (rule_metadata ? 'fixed_cents') then
        return null;
      end if;
      begin fixed_cents := (rule_metadata ->> 'fixed_cents')::bigint;
      exception when invalid_text_representation then return null;
      end;
      if fixed_cents is null or fixed_cents < 0 then return null; end if;
      return least(cost_amount_cents, fixed_cents);
    else
      return null;
  end case;
end;
$$;

-- Direct table writes are not part of the public API, but this guard keeps a
-- finalized financial snapshot immutable even if an internal caller bypasses
-- one of the reviewed RPCs. Explicit reopen is the only correction path.
create or replace function app_private.prevent_finalized_device_mutation()
returns trigger language plpgsql
set search_path = pg_catalog, app_private as $$
begin
  if exists (select 1 from app_private.donations
    where id = coalesce(new.donation_id, old.donation_id)
      and financial_inputs_finalized_at is not null) then
    raise exception 'financial inputs finalized; reopen required' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists donation_devices_finalized_guard on app_private.donation_devices;
create trigger donation_devices_finalized_guard
before update or delete on app_private.donation_devices
for each row execute function app_private.prevent_finalized_device_mutation();

-- Replace the finalizer with the complete policy-method implementation.
create or replace function api.staff_finalize_donation_financials(
  actor_user_id uuid, candidate_donation_id uuid
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, app_private
as $$
declare d app_private.donations%rowtype;
  recon_id uuid; allocation_id uuid; charity_id_value uuid;
  share integer; gross bigint := 0; eligible_costs bigint := 0;
  revision_value integer; eligible_count integer := 0;
  row_value record; calculated_cost bigint; applied bigint; remaining bigint;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_active_staff(actor_user_id);
  select * into d from app_private.donations where id = candidate_donation_id for update;
  if d.id is null or d.status = 'cancelled' or d.financial_inputs_finalized_at is not null then
    raise exception 'open donation financial inputs required' using errcode = '22023';
  end if;
  if exists (select 1 from app_private.donation_devices where donation_id = d.id
    and (receipt_status <> 'missing' and (inspection_status in ('pending','inspecting')
      or processing_status = 'pending'))) then
    raise exception 'all devices must be reconciled and processed' using errcode = '22023';
  end if;
  -- Resale is the only disposition that requires a completed sale. Recycle,
  -- reuse, parts, and returned devices may close with no proceeds.
  if exists (select 1 from app_private.donation_devices x
    where x.donation_id = d.id and x.receipt_status in ('received','unexpected')
      and x.inspection_status = 'inspected' and x.processing_status = 'resale'
      and not exists (select 1 from app_private.effective_device_sales s where s.device_id = x.id)) then
    raise exception 'every resale device requires an effective sale' using errcode = '22023';
  end if;
  select count(*) into eligible_count from (
    select distinct x.id
    from app_private.donation_devices x
    join app_private.effective_device_sales s on s.device_id = x.id
    where x.donation_id = d.id and x.receipt_status in ('received','unexpected')
      and x.inspection_status = 'inspected' and x.processing_status in ('resale','complete')
  ) eligible;
  if exists (select 1 from app_private.effective_proceeds_allocations a
    where a.donation_id = d.id) then
    raise exception 'active allocation already exists' using errcode = '23505';
  end if;
  revision_value := d.financial_revision + 1;
  insert into app_private.financial_reconciliation_snapshots
    (donation_id, revision, eligible_device_count, finalized_by)
  values (d.id, revision_value, eligible_count, actor_user_id)
  returning id into recon_id;
  insert into app_private.financial_reconciliation_devices
    (snapshot_id, device_id, sale_result_id, ordinal)
  select recon_id, x.id, s.id, row_number() over (order by x.id)
  from app_private.donation_devices x
  join app_private.effective_device_sales s on s.device_id = x.id
  where x.donation_id = d.id and x.receipt_status in ('received','unexpected')
    and x.inspection_status = 'inspected' and x.processing_status in ('resale','complete');
  select coalesce(sum(s.gross_amount_cents),0) into gross
  from app_private.financial_reconciliation_devices m
  join app_private.device_sale_results s on s.id = m.sale_result_id
  where m.snapshot_id = recon_id;
  if d.policy_version_snapshot_id is not null then
    select share_basis_points into share from app_private.proceeds_policy_versions
    where id = d.policy_version_snapshot_id and lifecycle in ('approved','active');
    for row_value in
      select c.*, r.id rule_id, r.allocation_method, r.cap_basis_points,
        r.metadata, r.priority
      from app_private.effective_donation_costs c
      join app_private.proceeds_policy_cost_rules r
        on r.policy_version_id = d.policy_version_snapshot_id
       and r.cost_category = c.category and r.deductible
      where c.donation_id = d.id
        and (c.device_id is null or exists (
          select 1 from app_private.financial_reconciliation_devices m
          where m.snapshot_id = recon_id and m.device_id = c.device_id))
      order by r.priority desc, c.incurred_at, c.id
    loop
      calculated_cost := app_private.calculate_policy_cost_cents(
        row_value.amount_cents, row_value.allocation_method,
        row_value.cap_basis_points, row_value.metadata, gross);
      if calculated_cost is null then
        raise exception 'cost policy rule is not safely configured' using errcode = '22023';
      end if;
      remaining := greatest(gross - eligible_costs, 0);
      applied := least(calculated_cost, remaining);
      insert into app_private.financial_cost_applications
        (snapshot_id, cost_id, policy_rule_id, applied_cents, calculation_snapshot)
      values (recon_id, row_value.id, row_value.rule_id, applied,
        jsonb_build_object(
          'costAmountCents', row_value.amount_cents,
          'method', row_value.allocation_method,
          'capBasisPoints', row_value.cap_basis_points,
          'capBase', 'gross_proceeds', 'capBaseCents', gross,
          'priority', row_value.priority,
          'eligibleDeviceCount', eligible_count,
          'denominator', case when row_value.allocation_method = 'pro_rata'
            then greatest(eligible_count, 1) else null end,
          'proRataBaseCents', case when row_value.allocation_method = 'pro_rata'
            then calculated_cost / greatest(eligible_count, 1) else null end,
          'proRataRemainderCents', case when row_value.allocation_method = 'pro_rata'
            then calculated_cost % greatest(eligible_count, 1) else null end,
          'fixedCents', case when row_value.metadata ? 'fixed_cents'
            then row_value.metadata ->> 'fixed_cents' else null end,
          'finalAppliedCents', applied, 'frozen', true));
      eligible_costs := eligible_costs + applied;
    end loop;
  end if;
  select id into charity_id_value from app_private.charities
  where pledge_id = d.selected_charity_pledge_id and status = 'verified';
  insert into app_private.proceeds_allocations
    (donation_id, policy_version_id, beneficiary_pledge_id, gross_cents,
     eligible_cost_cents, allocable_base_cents, share_basis_points,
     allocated_cents, status, calculation_snapshot, calculated_by, calculated_at,
     reconciliation_snapshot_id, beneficiary_charity_id, campaign_id, organization_id)
  values (d.id, d.policy_version_snapshot_id, d.selected_charity_pledge_id,
    gross, eligible_costs, greatest(gross - eligible_costs, 0), share,
    case when share is null then null
      else greatest(gross - eligible_costs, 0) * share / 10000 end,
    (case when share is null then 'policy_hold' else 'calculated' end)::app_private.allocation_status,
    jsonb_build_object('snapshotId', recon_id, 'revision', revision_value,
      'eligibleDeviceCount', eligible_count, 'grossCents', gross,
      'eligibleCostCents', eligible_costs, 'zeroProceeds', gross = 0,
      'orderIndependent', true), actor_user_id, now(), recon_id,
    charity_id_value, d.campaign_id,
    (select organization_id from app_private.campaigns where id = d.campaign_id))
  returning id into allocation_id;
  update app_private.donations set financial_inputs_finalized_at = now(),
    financial_inputs_finalized_by = actor_user_id, financial_revision = revision_value
  where id = d.id;
  insert into app_private.audit_events
    (actor, actor_ref, action_name, entity_type, entity_id, reason_code,
     redacted_changes, metadata)
  values ('staff', actor_user_id::text, 'finance.finalize_inputs',
    'proceeds_allocation', allocation_id, 'reconciled_financial_finalization',
    jsonb_build_object('gross_cents', gross, 'eligible_cost_cents', eligible_costs,
      'eligible_device_count', eligible_count),
    jsonb_build_object('snapshot_id', recon_id, 'revision', revision_value,
      'zero_proceeds', gross = 0));
  return jsonb_build_object('snapshotId', recon_id, 'allocationId', allocation_id,
    'allocationStatus', case when share is null then 'policy_hold' else 'calculated' end,
    'zeroProceeds', gross = 0);
end;
$$;

create or replace function api.staff_reopen_donation_financials(
  actor_user_id uuid, candidate_donation_id uuid, reason_value text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, app_private
as $$
declare active_allocation app_private.proceeds_allocations%rowtype; reversal_id uuid;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_active_staff(actor_user_id);
  if char_length(trim(coalesce(reason_value,''))) not between 1 and 500 then
    raise exception 'correction reason required' using errcode = '22023';
  end if;
  select a.* into active_allocation
  from app_private.effective_proceeds_allocations a
  where a.donation_id = candidate_donation_id
    and a.status in ('calculated','policy_hold')
  order by a.created_at desc limit 1 for update;
  if active_allocation.id is null or exists (
    select 1 from app_private.disbursement_preparation_allocations p
    join app_private.disbursements d on d.preparation_id = p.preparation_id
    where p.allocation_id = active_allocation.id
      and d.status not in ('cancelled','reversed')) then
    raise exception 'undisbursed calculated allocation required' using errcode = '22023';
  end if;
  insert into app_private.proceeds_allocations
    (donation_id, policy_version_id, beneficiary_pledge_id, gross_cents,
     eligible_cost_cents, allocable_base_cents, share_basis_points,
     allocated_cents, currency, status, calculation_snapshot, calculated_by,
     calculated_at, reversal_of, reconciliation_snapshot_id,
     beneficiary_charity_id, campaign_id, organization_id)
  values (active_allocation.donation_id, active_allocation.policy_version_id,
    active_allocation.beneficiary_pledge_id, active_allocation.gross_cents,
    active_allocation.eligible_cost_cents, active_allocation.allocable_base_cents,
    active_allocation.share_basis_points, active_allocation.allocated_cents,
    active_allocation.currency, 'reversed',
    jsonb_build_object('reason', left(trim(reason_value),500),
      'reverses', active_allocation.id), actor_user_id, now(), active_allocation.id,
    active_allocation.reconciliation_snapshot_id,
    active_allocation.beneficiary_charity_id, active_allocation.campaign_id,
    active_allocation.organization_id)
  returning id into reversal_id;
  update app_private.donations set financial_inputs_finalized_at = null,
    financial_inputs_finalized_by = null where id = candidate_donation_id;
  insert into app_private.audit_events
    (actor, actor_ref, action_name, entity_type, entity_id, reason_code,
     redacted_changes, metadata)
  values ('staff', actor_user_id::text, 'finance.reopen_inputs',
    'proceeds_allocation', reversal_id, 'explicit_financial_correction',
    jsonb_build_object('reversal_of', active_allocation.id),
    jsonb_build_object('reason', left(trim(reason_value),500)));
  return jsonb_build_object('reversalAllocationId', reversal_id, 'reopened', true,
    'previousAllocationId', active_allocation.id);
end;
$$;

-- Human financial facts must include a verified wipe before a resale sale.
create or replace function api.staff_record_sale_and_allocation(
  actor_user_id uuid, candidate_device_id uuid, gross_value_cents bigint,
  sale_channel text, external_ref text, sold_time timestamptz
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, app_private
as $$
declare device_row app_private.donation_devices%rowtype;
  donation_row app_private.donations%rowtype; sale_id uuid;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_active_staff(actor_user_id);
  select * into device_row from app_private.donation_devices
    where id = candidate_device_id for update;
  select * into donation_row from app_private.donations
    where id = device_row.donation_id for update;
  if device_row.id is null or donation_row.status = 'cancelled'
    or donation_row.financial_inputs_finalized_at is not null
    or device_row.receipt_status not in ('received','unexpected')
    or device_row.received_at is null or device_row.inspection_status <> 'inspected'
    or device_row.processing_status not in ('resale','complete')
    or device_row.data_wipe_status <> 'completed'
    or device_row.wipe_verified_at is null or device_row.wipe_verified_by is null then
    raise exception 'received, inspected, resale-eligible device required' using errcode = '22023';
  end if;
  insert into app_private.device_sale_results
    (device_id, gross_amount_cents, channel, external_reference, sold_at, recorded_by)
  values (candidate_device_id, gross_value_cents, trim(sale_channel),
    nullif(trim(external_ref),''), sold_time, actor_user_id)
  returning id into sale_id;
  insert into app_private.audit_events
    (actor, actor_ref, action_name, entity_type, entity_id, reason_code,
     redacted_changes, metadata)
  values ('staff', actor_user_id::text, 'finance.record_sale', 'sale_result',
    sale_id, 'staff_financial_entry', jsonb_build_object('gross_cents', gross_value_cents),
    jsonb_build_object('donation_id', donation_row.id, 'allocation_created', false,
      'wipe_verified', true));
  return jsonb_build_object('saleId', sale_id, 'allocationId', null,
    'allocationStatus', 'awaiting_finalization');
end;
$$;

-- Finalization guards on the reviewed staff RPCs.
create or replace function api.staff_add_unexpected_device(
  actor_user_id uuid, candidate_donation_id uuid, actual_brand text, actual_model text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, app_private
as $$
declare device_id uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  if char_length(trim(actual_brand)) not between 1 and 80
    or char_length(trim(actual_model)) not between 1 and 160 then
    raise exception 'invalid unexpected device' using errcode = '22023';
  end if;
  if not exists (select 1 from app_private.donations
    where id = candidate_donation_id and financial_inputs_finalized_at is null) then
    raise exception 'financial inputs finalized; reopen required' using errcode = '22023';
  end if;
  insert into app_private.donation_devices
    (donation_id, source, receipt_status, actual_brand, actual_model, received_at)
  values (candidate_donation_id, 'unexpected', 'unexpected', trim(actual_brand),
    trim(actual_model), now()) returning id into device_id;
  insert into app_private.audit_events
    (actor, actor_ref, action_name, entity_type, entity_id, reason_code,
     redacted_changes, metadata)
  values ('staff', actor_user_id::text, 'donation.add_unexpected_device',
    'donation_device', device_id, 'physical_device_found',
    jsonb_build_object('source','unexpected'), '{}'::jsonb);
  return jsonb_build_object('ok',true,'deviceId',device_id);
end;
$$;

create or replace function api.staff_record_receipt(
  actor_user_id uuid, candidate_donation_id uuid, receipt_time timestamptz,
  package_condition text, device_receipts jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, app_private
as $$
declare current_status app_private.donation_status; receipt jsonb;
  changed_count integer := 0; domain_event_id uuid; outbox_id uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  if receipt_time is null or receipt_time > now() + interval '5 minutes'
    or jsonb_typeof(device_receipts) <> 'array'
    or char_length(trim(coalesce(package_condition,''))) not between 1 and 500 then
    raise exception 'invalid receipt payload' using errcode = '22023';
  end if;
  select status into current_status from app_private.donations
    where id = candidate_donation_id and financial_inputs_finalized_at is null for update;
  if not found or current_status not in ('submitted','in_transit','exception') then
    raise exception 'donation cannot be received from current status' using errcode = '22023';
  end if;
  for receipt in select value from jsonb_array_elements(device_receipts) loop
    update app_private.donation_devices set
      receipt_status = case when coalesce((receipt ->> 'received')::boolean,false)
        then 'received'::app_private.device_receipt_status
        else 'missing'::app_private.device_receipt_status end,
      received_at = case when coalesce((receipt ->> 'received')::boolean,false)
        then receipt_time else null end, updated_at = now()
    where id = (receipt ->> 'deviceId')::uuid and donation_id = candidate_donation_id;
    if found then changed_count := changed_count + 1; end if;
  end loop;
  if changed_count <> jsonb_array_length(device_receipts) then
    raise exception 'receipt includes an unknown device' using errcode = '22023';
  end if;
  update app_private.donations set status = 'received', received_at = receipt_time,
    received_by = actor_user_id, package_condition = trim($4), updated_at = now()
    where id = candidate_donation_id;
  insert into app_private.donation_status_events
    (donation_id,status,donor_visible,public_message,actor,actor_user_id,occurred_at)
  values (candidate_donation_id,'received',true,
    'Your package has arrived at Donate by Mail and is awaiting inspection.',
    'staff',actor_user_id,receipt_time);
  insert into app_private.audit_events
    (actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values ('staff',actor_user_id::text,'donation.record_physical_receipt','donation',
    candidate_donation_id,'physical_package_received',
    jsonb_build_object('status',jsonb_build_object('from',current_status,'to','received'),
      'device_receipts_recorded',changed_count), '{}'::jsonb);
  insert into app_private.domain_events(event_type,aggregate_type,aggregate_id,aggregate_version,payload)
  values ('donation.received','donation',candidate_donation_id,2,
    jsonb_build_object('donationId',candidate_donation_id)) returning id into domain_event_id;
  insert into app_private.outbox_events(domain_event_id,handler_key,event_type,payload)
  values (domain_event_id,'donation_notifications','donation.received',
    jsonb_build_object('donationId',candidate_donation_id)) returning id into outbox_id;
  return jsonb_build_object('ok',true,'outboxEventId',outbox_id);
end;
$$;

-- A separate financial detail RPC keeps PII and operational evidence behind
-- the existing staff-only BFF boundary while giving the dashboard a complete
-- correction workflow.
create function api.staff_get_donation_financials(actor_user_id uuid, candidate_donation_id uuid)
returns jsonb language plpgsql security definer stable
set search_path = pg_catalog, app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select jsonb_build_object(
    'donationId', d.id, 'revision', d.financial_revision,
    'finalizedAt', d.financial_inputs_finalized_at,
    'activeAllocation', (select to_jsonb(a) from app_private.effective_proceeds_allocations a
      where a.donation_id=d.id order by a.created_at desc limit 1),
    'allocations', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc)
      from app_private.proceeds_allocations a where a.donation_id=d.id),'[]'::jsonb),
    'sales', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc)
      from app_private.device_sale_results s join app_private.donation_devices x on x.id=s.device_id
      where x.donation_id=d.id),'[]'::jsonb),
    'costs', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc)
      from app_private.donation_costs c where c.donation_id=d.id),'[]'::jsonb),
    'disbursed', exists (select 1 from app_private.proceeds_allocations a
      join app_private.disbursement_preparation_allocations pa on pa.allocation_id=a.id
      join app_private.disbursements ds on ds.preparation_id=pa.preparation_id
      where a.donation_id=d.id and ds.status='completed')
  ) into result from app_private.donations d where d.id=candidate_donation_id;
  return result;
end;
$$;
revoke execute on function api.staff_get_donation_financials(uuid,uuid) from public,anon,authenticated;
grant execute on function api.staff_get_donation_financials(uuid,uuid) to service_role;

-- Partner invitations publish only identifier-based outbox payloads. The
-- recipient address is resolved server-side immediately before delivery.
create or replace function api.staff_invite_partner_admin(
  actor_user_id uuid, candidate_organization_id uuid, email_value text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private as $$
declare invitation_id uuid; normalized text := lower(trim(email_value));
  domain_event_id uuid; outbox_id uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  if normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or not exists (select 1 from app_private.organizations
      where id=candidate_organization_id and status='active') then
    raise exception 'active organization and valid email required' using errcode='22023';
  end if;
  insert into app_private.partner_invitations(organization_id,email_search,role,invited_by)
  values(candidate_organization_id,normalized,'partner_admin',actor_user_id)
  returning id into invitation_id;
  insert into app_private.audit_events
    (actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values ('staff',actor_user_id::text,'partner.invite_admin','partner_invitation',invitation_id,
    'audited_role_invitation',jsonb_build_object('organization_id',candidate_organization_id,'role','partner_admin'),
    jsonb_build_object('email_redacted',true));
  insert into app_private.domain_events(event_type,aggregate_type,aggregate_id,aggregate_version,payload)
  values ('partner.invitation_created','partner_invitation',invitation_id,
    (select count(*)::integer from app_private.audit_events where entity_type='partner_invitation' and entity_id=invitation_id),
    jsonb_build_object('invitationId',invitation_id)) returning id into domain_event_id;
  insert into app_private.outbox_events(domain_event_id,handler_key,event_type,payload)
  values (domain_event_id,'partner_invitation_email','partner.invitation_created',
    jsonb_build_object('invitationId',invitation_id)) returning id into outbox_id;
  return jsonb_build_object('invitationId',invitation_id,'outboxEventId',outbox_id);
end;
$$;

create function api.get_partner_invitation_email_payload(candidate_invitation_id uuid)
returns jsonb language plpgsql security definer stable
set search_path = pg_catalog, app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object('invitationId',i.id,'email',i.email_search,
    'organizationName',o.name,'loginPath','/login') into result
  from app_private.partner_invitations i join app_private.organizations o on o.id=i.organization_id
  where i.id=candidate_invitation_id and i.status='invited' and o.status='active';
  return result;
end;
$$;
revoke execute on function api.get_partner_invitation_email_payload(uuid) from public,anon,authenticated;
grant execute on function api.get_partner_invitation_email_payload(uuid) to service_role;

-- Account context is role-derived server-side. A donor identity is never
-- treated as a partner or staff identity merely because it selected a card.
create function api.account_context(actor_user_id uuid)
returns jsonb language plpgsql security definer stable
set search_path = pg_catalog, app_private, auth as $$
declare result jsonb; staff boolean; organizations jsonb;
begin
  perform app_private.assert_service_role();
  staff := exists (select 1 from app_private.staff_memberships
    where user_id=actor_user_id and status='active');
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'role',m.role)
    order by o.name),'[]'::jsonb) into organizations
  from app_private.organization_memberships m join app_private.organizations o on o.id=m.organization_id
  where m.user_id=actor_user_id and m.status='active' and o.status='active';
  select jsonb_build_object('userId',actor_user_id,'email',u.email,'staff',staff,
    'organizations',organizations,'donor',true) into result from auth.users u where u.id=actor_user_id;
  return result;
end;
$$;
revoke execute on function api.account_context(uuid) from public,anon,authenticated;
grant execute on function api.account_context(uuid) to service_role;

-- Keep the application namespace permanently unavailable to vanity campaigns.
insert into app_private.reserved_route_slugs(slug,reason) values
  ('account','reserved donor account route'), ('login','reserved account gateway route'),
  ('settings','reserved account settings route'), ('staff','reserved staff route')
on conflict (slug) do nothing;

-- Future agent authorization fingerprints are generated by the Worker from the
-- complete canonical request envelope; this comment documents the DB contract.
comment on column app_private.action_decisions.input_hash is
  'SHA-256 of canonical agent identity, command, target, risk, facts, payload, and policy context.';

-- Device editing remains a human-only operation, with the wipe-before-resale
-- invariant enforced at the same boundary where processing is changed.
create or replace function api.staff_update_device(
  actor_user_id uuid, candidate_donation_id uuid, candidate_device_id uuid, patch jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, app_private
as $$
declare existing app_private.donation_devices%rowtype;
  next_inspection app_private.device_inspection_status;
  next_processing app_private.device_processing_status;
  next_wipe app_private.data_wipe_status;
  next_value bigint;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  if jsonb_typeof(patch) <> 'object' then
    raise exception 'invalid device patch' using errcode='22023';
  end if;
  select * into existing from app_private.donation_devices
    where id=candidate_device_id and donation_id=candidate_donation_id for update;
  if not found then raise exception 'device not found' using errcode='22023'; end if;
  if exists (select 1 from app_private.donations
    where id=candidate_donation_id and financial_inputs_finalized_at is not null) then
    raise exception 'financial inputs finalized; reopen required' using errcode='22023';
  end if;
  next_inspection := coalesce((patch ->> 'inspectionStatus')::app_private.device_inspection_status, existing.inspection_status);
  next_processing := coalesce((patch ->> 'processingStatus')::app_private.device_processing_status, existing.processing_status);
  next_wipe := coalesce((patch ->> 'dataWipeStatus')::app_private.data_wipe_status, existing.data_wipe_status);
  next_value := case when patch ? 'assessedValueCents'
    then nullif(patch ->> 'assessedValueCents','')::bigint else existing.assessed_value_cents end;
  if next_processing = 'resale' and (next_wipe <> 'completed'
    or (next_wipe = 'completed' and existing.wipe_verified_at is null
      and not (patch ? 'dataWipeStatus'))) then
    raise exception 'verified data wipe required before resale' using errcode='22023';
  end if;
  update app_private.donation_devices set
    actual_brand = case when patch ? 'actualBrand' then nullif(trim(patch ->> 'actualBrand'),'') else actual_brand end,
    actual_model = case when patch ? 'actualModel' then nullif(trim(patch ->> 'actualModel'),'') else actual_model end,
    serial_last_four = case when patch ? 'serialLastFour' then nullif(trim(patch ->> 'serialLastFour'),'') else serial_last_four end,
    inspection_status = next_inspection, processing_status = next_processing, data_wipe_status = next_wipe,
    assessed_value_cents = next_value,
    inspected_at = case when next_inspection='inspected' then coalesce(inspected_at,now()) else inspected_at end,
    inspected_by = case when next_inspection='inspected' then actor_user_id else inspected_by end,
    valued_at = case when next_value is not null then coalesce(valued_at,now()) else null end,
    valued_by = case when next_value is not null then actor_user_id else null end,
    wipe_verified_at = case when next_wipe='completed' then coalesce(wipe_verified_at,now()) else null end,
    wipe_verified_by = case when next_wipe='completed' then actor_user_id else null end,
    updated_at = now() where id=candidate_device_id;
  insert into app_private.audit_events
    (actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values ('staff',actor_user_id::text,'donation.update_device','donation_device',candidate_device_id,
    'staff_inspection_update',jsonb_build_object('inspection_status',next_inspection,
      'processing_status',next_processing,'data_wipe_status',next_wipe,
      'assessed_value_recorded',next_value is not null), '{}'::jsonb);
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function api.staff_change_donation_status(
  actor_user_id uuid, candidate_donation_id uuid,
  new_status app_private.donation_status, public_message text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, app_private
as $$
declare old_status app_private.donation_status; domain_event_id uuid; outbox_id uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select status into old_status from app_private.donations where id=candidate_donation_id for update;
  if not found or not app_private.valid_donation_transition(old_status,new_status) then
    raise exception 'invalid donation status transition' using errcode='22023';
  end if;
  if exists (select 1 from app_private.donations
    where id=candidate_donation_id and financial_inputs_finalized_at is not null) then
    raise exception 'financial inputs finalized; reopen required' using errcode='22023';
  end if;
  if public_message is not null and char_length(trim(public_message)) not between 1 and 500 then
    raise exception 'invalid public message' using errcode='22023';
  end if;
  update app_private.donations set status=new_status,
    completed_at=case when new_status='completed' then coalesce(completed_at,now()) else completed_at end,
    updated_at=now() where id=candidate_donation_id;
  insert into app_private.donation_status_events
    (donation_id,status,donor_visible,public_message,actor,actor_user_id)
  values (candidate_donation_id,new_status,public_message is not null,nullif(trim(public_message),''),'staff',actor_user_id);
  insert into app_private.audit_events
    (actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values ('staff',actor_user_id::text,'donation.change_status','donation',candidate_donation_id,
    'staff_status_update',jsonb_build_object('status',jsonb_build_object('from',old_status,'to',new_status)),
    '{}'::jsonb);
  insert into app_private.domain_events(event_type,aggregate_type,aggregate_id,aggregate_version,payload)
  values ('donation.status_changed','donation',candidate_donation_id,
    (select count(*)::integer from app_private.donation_status_events where donation_id=candidate_donation_id),
    jsonb_build_object('donationId',candidate_donation_id,'status',new_status)) returning id into domain_event_id;
  if public_message is not null then
    insert into app_private.outbox_events(domain_event_id,handler_key,event_type,payload)
    values (domain_event_id,'donation_notifications','donation.status_changed',jsonb_build_object('donationId',candidate_donation_id))
    returning id into outbox_id;
  end if;
  return jsonb_build_object('ok',true,'outboxEventId',outbox_id);
end;
$$;

alter function api.staff_get_donation_financials(uuid,uuid) volatile;
alter function api.account_context(uuid) volatile;
alter function api.get_partner_invitation_email_payload(uuid) volatile;

create or replace function api.account_profile(actor_user_id uuid)
returns jsonb language plpgsql security definer volatile
set search_path = pg_catalog, app_private, auth as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object('userId',u.id,'email',u.email,'displayName',p.display_name,
    'createdAt',u.created_at) into result
  from auth.users u left join app_private.profiles p on p.user_id=u.id where u.id=actor_user_id;
  return result;
end;
$$;

create or replace function api.update_account_profile(actor_user_id uuid, display_name_value text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private as $$
declare normalized text := nullif(trim(display_name_value),'');
begin
  perform app_private.assert_service_role();
  if normalized is not null and char_length(normalized) not between 1 and 120 then
    raise exception 'invalid display name' using errcode='22023';
  end if;
  insert into app_private.profiles(user_id,display_name) values(actor_user_id,normalized)
  on conflict (user_id) do update set display_name=excluded.display_name,updated_at=now();
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values ('donor',actor_user_id::text,'account.update_profile','profile',actor_user_id,
    'self_service_profile_update',jsonb_build_object('display_name_changed',true),jsonb_build_object('pii_redacted',true));
  return api.account_profile(actor_user_id);
end;
$$;
revoke execute on function api.account_profile(uuid),api.update_account_profile(uuid,text) from public,anon,authenticated;
grant execute on function api.account_profile(uuid),api.update_account_profile(uuid,text) to service_role;
