-- Deterministic, append-only financial lifecycle. Recording facts is separate
-- from freezing the reconciled device set and calculating one donation result.
alter table app_private.donations add column financial_inputs_finalized_at timestamptz;
alter table app_private.donations add column financial_inputs_finalized_by uuid references auth.users(id) on delete restrict;
alter table app_private.donations add column financial_revision integer not null default 0 check(financial_revision>=0);

create table app_private.financial_reconciliation_snapshots (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null references app_private.donations(id) on delete restrict,
  revision integer not null check(revision>0),
  eligible_device_count integer not null check(eligible_device_count>0),
  finalized_by uuid not null references auth.users(id) on delete restrict,
  finalized_at timestamptz not null default now(),
  unique(donation_id,revision)
);
create table app_private.financial_reconciliation_devices (
  snapshot_id uuid not null references app_private.financial_reconciliation_snapshots(id) on delete restrict,
  device_id uuid not null references app_private.donation_devices(id) on delete restrict,
  sale_result_id uuid not null references app_private.device_sale_results(id) on delete restrict,
  ordinal integer not null check(ordinal>0),
  primary key(snapshot_id,device_id), unique(snapshot_id,ordinal)
);
create table app_private.financial_cost_applications (
  snapshot_id uuid not null references app_private.financial_reconciliation_snapshots(id) on delete restrict,
  cost_id uuid not null references app_private.donation_costs(id) on delete restrict,
  policy_rule_id uuid not null references app_private.proceeds_policy_cost_rules(id) on delete restrict,
  applied_cents bigint not null check(applied_cents>=0),
  calculation_snapshot jsonb not null check(jsonb_typeof(calculation_snapshot)='object'),
  primary key(snapshot_id,cost_id)
);
alter table app_private.financial_reconciliation_snapshots enable row level security;
alter table app_private.financial_reconciliation_devices enable row level security;
alter table app_private.financial_cost_applications enable row level security;
revoke all on app_private.financial_reconciliation_snapshots,
  app_private.financial_reconciliation_devices,app_private.financial_cost_applications from public,anon,authenticated;
grant select,insert on app_private.financial_reconciliation_snapshots,
  app_private.financial_reconciliation_devices,app_private.financial_cost_applications to service_role;

alter table app_private.proceeds_allocations add column reconciliation_snapshot_id uuid
  references app_private.financial_reconciliation_snapshots(id) on delete restrict;
alter table app_private.proceeds_allocations add column beneficiary_charity_id uuid
  references app_private.charities(id) on delete restrict;
alter table app_private.proceeds_allocations add column campaign_id uuid
  references app_private.campaigns(id) on delete restrict;
alter table app_private.proceeds_allocations add column organization_id uuid
  references app_private.organizations(id) on delete restrict;

alter table app_private.disbursement_preparations add column beneficiary_charity_id uuid
  references app_private.charities(id) on delete restrict;
alter table app_private.disbursement_preparations add column beneficiary_pledge_id uuid;
alter table app_private.disbursement_preparations add column campaign_id uuid
  references app_private.campaigns(id) on delete restrict;
alter table app_private.disbursement_preparations add column organization_id uuid
  references app_private.organizations(id) on delete restrict;
alter table app_private.disbursement_preparations add column payment_memo text check(payment_memo is null or char_length(payment_memo)<=240);
alter table app_private.disbursement_preparations add column approval_policy_id uuid
  references app_private.financial_approval_policies(id) on delete restrict;
alter table app_private.disbursement_preparations add column approval_required_count integer check(approval_required_count>0);
alter table app_private.disbursement_preparations add column approval_preparer_may_approve boolean;

drop index if exists app_private.device_sale_results_one_active_sale_idx;
drop index if exists app_private.proceeds_allocations_sale_result_idx;

create view app_private.effective_device_sales with (security_invoker=true) as
select s.* from app_private.device_sale_results s
where s.status='recorded' and not exists(select 1 from app_private.device_sale_results r
  where r.status='reversed' and r.reversal_of=s.id);
create view app_private.effective_donation_costs with (security_invoker=true) as
select c.* from app_private.donation_costs c
where c.status='recorded' and not exists(select 1 from app_private.donation_costs r
  where r.status='reversed' and r.reversal_of=c.id);
revoke all on app_private.effective_device_sales,app_private.effective_donation_costs from public,anon,authenticated;
grant select on app_private.effective_device_sales,app_private.effective_donation_costs to service_role;

create function app_private.enforce_effective_sale_uniqueness() returns trigger language plpgsql
set search_path=pg_catalog,app_private as $$
begin
  if new.status='recorded' then
    perform pg_advisory_xact_lock(hashtextextended(new.device_id::text,912));
    if exists(select 1 from app_private.effective_device_sales where device_id=new.device_id) then
      raise exception 'device already has an effective sale' using errcode='23505';
    end if;
  elsif new.reversal_of is not null and exists(select 1 from app_private.device_sale_results
    where reversal_of=new.reversal_of) then
    raise exception 'sale is already reversed' using errcode='23505';
  end if;
  return new;
end $$;
create trigger device_sale_effective_guard before insert on app_private.device_sale_results
for each row execute function app_private.enforce_effective_sale_uniqueness();

create function app_private.enforce_cost_reversal_uniqueness() returns trigger language plpgsql
set search_path=pg_catalog,app_private as $$
begin
  if new.reversal_of is not null and exists(select 1 from app_private.donation_costs where reversal_of=new.reversal_of) then
    raise exception 'cost is already reversed' using errcode='23505';
  end if;
  return new;
end $$;
create trigger donation_cost_reversal_guard before insert on app_private.donation_costs
for each row execute function app_private.enforce_cost_reversal_uniqueness();

create or replace function api.staff_record_sale_and_allocation(actor_user_id uuid,candidate_device_id uuid,
  gross_value_cents bigint,sale_channel text,external_ref text,sold_time timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare device_row app_private.donation_devices%rowtype; donation_row app_private.donations%rowtype; sale_id uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select * into device_row from app_private.donation_devices where id=candidate_device_id for update;
  select * into donation_row from app_private.donations where id=device_row.donation_id for update;
  if device_row.id is null or donation_row.status='cancelled' or donation_row.financial_inputs_finalized_at is not null
    or device_row.receipt_status not in ('received','unexpected') or device_row.received_at is null
    or device_row.inspection_status<>'inspected' or device_row.processing_status not in ('resale','complete') then
    raise exception 'received, inspected, resale-eligible device required' using errcode='22023';
  end if;
  insert into app_private.device_sale_results(device_id,gross_amount_cents,channel,external_reference,sold_at,recorded_by)
  values(candidate_device_id,gross_value_cents,trim(sale_channel),nullif(trim(external_ref),''),sold_time,actor_user_id)
  returning id into sale_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'finance.record_sale','sale_result',sale_id,'staff_financial_entry',
    jsonb_build_object('gross_cents',gross_value_cents),jsonb_build_object('donation_id',donation_row.id,'allocation_created',false));
  return jsonb_build_object('saleId',sale_id,'allocationId',null,'allocationStatus','awaiting_finalization');
end $$;

create or replace function api.staff_record_cost(actor_user_id uuid,candidate_donation_id uuid,
  candidate_device_id uuid,cost_category text,cost_amount_cents bigint,evidence_ref text,incurred_time timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare cost_id uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  if not exists(select 1 from app_private.donations where id=candidate_donation_id
      and status<>'cancelled' and financial_inputs_finalized_at is null) then
    raise exception 'open donation financial inputs required' using errcode='22023'; end if;
  if candidate_device_id is not null and not exists(select 1 from app_private.donation_devices
    where id=candidate_device_id and donation_id=candidate_donation_id) then
    raise exception 'device does not belong to donation' using errcode='22023'; end if;
  insert into app_private.donation_costs(donation_id,device_id,category,amount_cents,evidence_reference,incurred_at,recorded_by)
  values(candidate_donation_id,candidate_device_id,cost_category,cost_amount_cents,nullif(trim(evidence_ref),''),incurred_time,actor_user_id)
  returning id into cost_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'finance.record_cost','donation_cost',cost_id,'staff_financial_entry',
    jsonb_build_object('category',cost_category,'amount_cents',cost_amount_cents),
    jsonb_build_object('donation_id',candidate_donation_id,'evidence_present',evidence_ref is not null));
  return jsonb_build_object('costId',cost_id);
end $$;

create function api.staff_reverse_sale(actor_user_id uuid,candidate_sale_id uuid,reason_value text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare original app_private.device_sale_results%rowtype; donation_id_value uuid; reversal_id uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select s.* into original from app_private.device_sale_results s
    where s.id=candidate_sale_id and s.status='recorded' for update;
  select d.donation_id into donation_id_value from app_private.donation_devices d where d.id=original.device_id;
  if original.id is null or exists(select 1 from app_private.donations where id=donation_id_value and financial_inputs_finalized_at is not null)
    then raise exception 'effective sale on open financial inputs required' using errcode='22023'; end if;
  insert into app_private.device_sale_results(device_id,gross_amount_cents,currency,channel,external_reference,sold_at,status,reversal_of,recorded_by)
  values(original.device_id,original.gross_amount_cents,original.currency,'reversal',null,now(),'reversed',original.id,actor_user_id)
  returning id into reversal_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'finance.reverse_sale','sale_result',reversal_id,'financial_correction',
    jsonb_build_object('reversal_of',original.id),jsonb_build_object('reason',left(trim(reason_value),500)));
  return jsonb_build_object('reversalId',reversal_id);
end $$;

create function api.staff_reverse_cost(actor_user_id uuid,candidate_cost_id uuid,reason_value text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare original app_private.donation_costs%rowtype; reversal_id uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select * into original from app_private.donation_costs where id=candidate_cost_id and status='recorded' for update;
  if original.id is null or exists(select 1 from app_private.donations where id=original.donation_id and financial_inputs_finalized_at is not null)
    then raise exception 'effective cost on open financial inputs required' using errcode='22023'; end if;
  insert into app_private.donation_costs(donation_id,device_id,category,amount_cents,currency,evidence_reference,incurred_at,status,reversal_of,recorded_by)
  values(original.donation_id,original.device_id,original.category,original.amount_cents,original.currency,null,now(),'reversed',original.id,actor_user_id)
  returning id into reversal_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'finance.reverse_cost','donation_cost',reversal_id,'financial_correction',
    jsonb_build_object('reversal_of',original.id),jsonb_build_object('reason',left(trim(reason_value),500)));
  return jsonb_build_object('reversalId',reversal_id);
end $$;

create function api.staff_finalize_donation_financials(actor_user_id uuid,candidate_donation_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare d app_private.donations%rowtype; recon_id uuid; allocation_id uuid; charity_id_value uuid;
  share integer; gross bigint; eligible_costs bigint:=0; revision_value integer; eligible_count integer; row_value record;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select * into d from app_private.donations where id=candidate_donation_id for update;
  if d.id is null or d.status='cancelled' or d.financial_inputs_finalized_at is not null then
    raise exception 'open donation financial inputs required' using errcode='22023'; end if;
  if exists(select 1 from app_private.donation_devices where donation_id=d.id and
    (receipt_status='expected' or inspection_status in ('pending','inspecting') or processing_status='pending')) then
    raise exception 'all devices must be reconciled and processed' using errcode='22023'; end if;
  select count(*) into eligible_count from app_private.donation_devices where donation_id=d.id
    and receipt_status in ('received','unexpected') and inspection_status='inspected' and processing_status in ('resale','complete');
  if eligible_count=0 then raise exception 'at least one eligible device required' using errcode='22023'; end if;
  if exists(select 1 from app_private.donation_devices x where x.donation_id=d.id
    and x.receipt_status in ('received','unexpected') and x.inspection_status='inspected' and x.processing_status in ('resale','complete')
    and not exists(select 1 from app_private.effective_device_sales s where s.device_id=x.id)) then
    raise exception 'every eligible device requires an effective sale' using errcode='22023'; end if;
  if exists(select 1 from app_private.proceeds_allocations a where a.donation_id=d.id and not exists(
    select 1 from app_private.proceeds_allocations r where r.status='reversed' and r.reversal_of=a.id)) then
    raise exception 'active allocation already exists' using errcode='23505'; end if;
  revision_value:=d.financial_revision+1;
  insert into app_private.financial_reconciliation_snapshots(donation_id,revision,eligible_device_count,finalized_by)
  values(d.id,revision_value,eligible_count,actor_user_id) returning id into recon_id;
  insert into app_private.financial_reconciliation_devices(snapshot_id,device_id,sale_result_id,ordinal)
  select recon_id,x.id,s.id,row_number() over(order by x.id) from app_private.donation_devices x
    join app_private.effective_device_sales s on s.device_id=x.id where x.donation_id=d.id
    and x.receipt_status in ('received','unexpected') and x.inspection_status='inspected' and x.processing_status in ('resale','complete');
  select coalesce(sum(s.gross_amount_cents),0) into gross from app_private.financial_reconciliation_devices m
    join app_private.device_sale_results s on s.id=m.sale_result_id where m.snapshot_id=recon_id;
  if d.policy_version_snapshot_id is not null then
    select share_basis_points into share from app_private.proceeds_policy_versions where id=d.policy_version_snapshot_id and lifecycle in ('approved','active');
    for row_value in select c.*,r.id rule_id,r.allocation_method,r.cap_basis_points,r.metadata,r.priority
      from app_private.effective_donation_costs c join app_private.proceeds_policy_cost_rules r
      on r.policy_version_id=d.policy_version_snapshot_id and r.cost_category=c.category and r.deductible
      where c.donation_id=d.id and (c.device_id is null or exists(select 1 from app_private.financial_reconciliation_devices m
        where m.snapshot_id=recon_id and m.device_id=c.device_id)) order by r.priority desc,c.incurred_at,c.id
    loop
      insert into app_private.financial_cost_applications(snapshot_id,cost_id,policy_rule_id,applied_cents,calculation_snapshot)
      values(recon_id,row_value.id,row_value.rule_id,least(row_value.amount_cents,greatest(gross-eligible_costs,0)),
        jsonb_build_object('method',row_value.allocation_method,'eligibleDeviceCount',eligible_count,'frozen',true));
      eligible_costs:=eligible_costs+least(row_value.amount_cents,greatest(gross-eligible_costs,0));
    end loop;
  end if;
  select id into charity_id_value from app_private.charities where pledge_id=d.selected_charity_pledge_id and status='verified';
  insert into app_private.proceeds_allocations(donation_id,policy_version_id,beneficiary_pledge_id,gross_cents,
    eligible_cost_cents,allocable_base_cents,share_basis_points,allocated_cents,status,calculation_snapshot,
    calculated_by,calculated_at,reconciliation_snapshot_id,beneficiary_charity_id,campaign_id,organization_id)
  values(d.id,d.policy_version_snapshot_id,d.selected_charity_pledge_id,gross,eligible_costs,greatest(gross-eligible_costs,0),share,
    case when share is null then null else greatest(gross-eligible_costs,0)*share/10000 end,
    (case when share is null then 'policy_hold' else 'calculated' end)::app_private.allocation_status,
    jsonb_build_object('snapshotId',recon_id,'revision',revision_value,'eligibleDeviceCount',eligible_count,
      'grossCents',gross,'eligibleCostCents',eligible_costs,'orderIndependent',true),actor_user_id,now(),recon_id,
    charity_id_value,d.campaign_id,(select organization_id from app_private.campaigns where id=d.campaign_id)) returning id into allocation_id;
  update app_private.donations set financial_inputs_finalized_at=now(),financial_inputs_finalized_by=actor_user_id,
    financial_revision=revision_value where id=d.id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'finance.finalize_inputs','proceeds_allocation',allocation_id,'reconciled_financial_finalization',
    jsonb_build_object('gross_cents',gross,'eligible_cost_cents',eligible_costs,'eligible_device_count',eligible_count),
    jsonb_build_object('snapshot_id',recon_id,'revision',revision_value));
  return jsonb_build_object('snapshotId',recon_id,'allocationId',allocation_id,
    'allocationStatus',case when share is null then 'policy_hold' else 'calculated' end);
end $$;

create function api.staff_reopen_donation_financials(actor_user_id uuid,candidate_donation_id uuid,reason_value text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare active_allocation app_private.proceeds_allocations%rowtype; reversal_id uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select a.* into active_allocation from app_private.proceeds_allocations a where a.donation_id=candidate_donation_id
    and not exists(select 1 from app_private.proceeds_allocations r where r.status='reversed' and r.reversal_of=a.id)
    order by a.created_at desc limit 1 for update;
  if active_allocation.id is null or active_allocation.status not in ('calculated','policy_hold')
    or exists(select 1 from app_private.disbursement_preparation_allocations p join app_private.disbursements d
      on d.preparation_id=p.preparation_id where p.allocation_id=active_allocation.id and d.status not in ('cancelled','reversed')) then
    raise exception 'undisbursed calculated allocation required' using errcode='22023'; end if;
  insert into app_private.proceeds_allocations(donation_id,policy_version_id,beneficiary_pledge_id,gross_cents,eligible_cost_cents,
    allocable_base_cents,share_basis_points,allocated_cents,currency,status,calculation_snapshot,calculated_by,calculated_at,
    reversal_of,reconciliation_snapshot_id,beneficiary_charity_id,campaign_id,organization_id)
  values(active_allocation.donation_id,active_allocation.policy_version_id,active_allocation.beneficiary_pledge_id,
    active_allocation.gross_cents,active_allocation.eligible_cost_cents,active_allocation.allocable_base_cents,
    active_allocation.share_basis_points,active_allocation.allocated_cents,active_allocation.currency,'reversed',
    jsonb_build_object('reason',left(trim(reason_value),500),'reverses',active_allocation.id),actor_user_id,now(),active_allocation.id,
    active_allocation.reconciliation_snapshot_id,active_allocation.beneficiary_charity_id,active_allocation.campaign_id,active_allocation.organization_id)
  returning id into reversal_id;
  update app_private.donations set financial_inputs_finalized_at=null,financial_inputs_finalized_by=null where id=candidate_donation_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'finance.reopen_inputs','proceeds_allocation',reversal_id,'explicit_financial_correction',
    jsonb_build_object('reversal_of',active_allocation.id),jsonb_build_object('reason',left(trim(reason_value),500)));
  return jsonb_build_object('reversalAllocationId',reversal_id,'reopened',true);
end $$;

drop function api.staff_prepare_disbursement(uuid,uuid,bigint,text,jsonb);
create function api.staff_prepare_disbursement(actor_user_id uuid,candidate_allocation_id uuid,
  amount_value_cents bigint,payment_memo_value text,evidence_value jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare a app_private.proceeds_allocations%rowtype; charity app_private.charities%rowtype;
  policy app_private.financial_approval_policies%rowtype; preparation_id uuid; disbursement_id uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select * into a from app_private.proceeds_allocations where id=candidate_allocation_id for update;
  select * into charity from app_private.charities where id=a.beneficiary_charity_id and pledge_id=a.beneficiary_pledge_id and status='verified';
  select * into policy from app_private.financial_approval_policies where action_type='record_disbursement'
    and lifecycle='active' and now()>=effective_from and (effective_to is null or now()<effective_to) order by version desc limit 1;
  if a.id is null or a.status<>'calculated' or a.allocated_cents is null or amount_value_cents<>a.allocated_cents
    or charity.id is null or policy.id is null then raise exception 'canonical calculated allocation and approval policy required' using errcode='22023'; end if;
  if exists(select 1 from app_private.disbursement_preparation_allocations x join app_private.disbursements d
    on d.preparation_id=x.preparation_id where x.allocation_id=a.id and d.status not in ('cancelled','reversed'))
    then raise exception 'allocation already has an active disbursement' using errcode='23505'; end if;
  insert into app_private.disbursement_preparations(amount_cents,beneficiary_reference,evidence,prepared_by,
    beneficiary_charity_id,beneficiary_pledge_id,campaign_id,organization_id,payment_memo,approval_policy_id,
    approval_required_count,approval_preparer_may_approve)
  values(amount_value_cents,charity.canonical_name,coalesce(evidence_value,'{}'),actor_user_id,charity.id,charity.pledge_id,
    a.campaign_id,a.organization_id,nullif(trim(payment_memo_value),''),policy.id,policy.required_approvals,
    policy.preparer_may_approve) returning id into preparation_id;
  insert into app_private.disbursement_preparation_allocations values(preparation_id,a.id,amount_value_cents);
  insert into app_private.disbursements(preparation_id) values(preparation_id) returning id into disbursement_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'finance.prepare_disbursement','disbursement',disbursement_id,'canonical_beneficiary_preparation',
    jsonb_build_object('amount_cents',amount_value_cents,'beneficiary_charity_id',charity.id),
    jsonb_build_object('allocation_id',a.id,'approval_policy_id',policy.id));
  return jsonb_build_object('preparationId',preparation_id,'disbursementId',disbursement_id);
end $$;

create or replace function api.staff_decide_disbursement(actor_user_id uuid,candidate_preparation_id uuid,
  decision_value app_private.approval_outcome,reason_value text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare prep app_private.disbursement_preparations%rowtype; policy app_private.financial_approval_policies%rowtype;
  approval_count integer; next_status app_private.disbursement_status; current_status app_private.disbursement_status; allocation_value uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select * into prep from app_private.disbursement_preparations where id=candidate_preparation_id;
  select * into policy from app_private.financial_approval_policies where id=prep.approval_policy_id;
  select status into current_status from app_private.disbursements where preparation_id=candidate_preparation_id for update;
  if prep.id is null or policy.id is null or current_status<>'prepared' then raise exception 'snapshotted prepared disbursement required' using errcode='22023'; end if;
  if actor_user_id=prep.prepared_by and not prep.approval_preparer_may_approve then raise exception 'preparer cannot approve under snapshotted policy' using errcode='42501'; end if;
  insert into app_private.disbursement_approvals(preparation_id,approval_policy_id,approver_user_id,outcome,reason)
  values(prep.id,policy.id,actor_user_id,decision_value,nullif(trim(reason_value),''));
  select count(*) into approval_count from app_private.disbursement_approvals where preparation_id=prep.id
    and approval_policy_id=policy.id and outcome='approved';
  next_status:=case when decision_value='rejected' then 'cancelled'::app_private.disbursement_status
    when approval_count>=prep.approval_required_count then 'approved'::app_private.disbursement_status else 'prepared'::app_private.disbursement_status end;
  update app_private.disbursements set status=next_status where preparation_id=prep.id;
  if next_status='approved' then for allocation_value in select allocation_id from app_private.disbursement_preparation_allocations where preparation_id=prep.id loop
    update app_private.proceeds_allocations set status='approved' where id=allocation_value and status='calculated';
    insert into app_private.allocation_state_events(allocation_id,status,actor_user_id,reason_code)
    values(allocation_value,'approved',actor_user_id,'snapshotted_approvals_complete'); end loop; end if;
  return jsonb_build_object('status',next_status,'approvalCount',approval_count,'requiredApprovals',prep.approval_required_count,'policyId',policy.id);
end $$;

revoke execute on function api.staff_reverse_sale(uuid,uuid,text),api.staff_reverse_cost(uuid,uuid,text),
  api.staff_finalize_donation_financials(uuid,uuid),api.staff_reopen_donation_financials(uuid,uuid,text) from public,anon,authenticated;
grant execute on function api.staff_reverse_sale(uuid,uuid,text),api.staff_reverse_cost(uuid,uuid,text),
  api.staff_finalize_donation_financials(uuid,uuid),api.staff_reopen_donation_financials(uuid,uuid,text) to service_role;
