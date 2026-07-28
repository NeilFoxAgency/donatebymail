-- Complete the beta's human-operated financial command surface. No command
-- moves money; completion records an externally executed payment reference.

create table app_private.allocation_state_events (
  id uuid primary key default gen_random_uuid(),
  allocation_id uuid not null references app_private.proceeds_allocations(id) on delete restrict,
  status app_private.allocation_status not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9_]{2,79}$'),
  occurred_at timestamptz not null default now()
);
create index allocation_state_events_allocation_idx
  on app_private.allocation_state_events(allocation_id,occurred_at desc);
create trigger allocation_state_events_append_only before update or delete
on app_private.allocation_state_events for each row
execute function app_private.prevent_update_or_delete();
alter table app_private.allocation_state_events enable row level security;

create function api.staff_record_cost(actor_user_id uuid,candidate_donation_id uuid,
  candidate_device_id uuid,cost_category text,cost_amount_cents bigint,
  evidence_ref text,incurred_time timestamptz)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare cost_id uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  if candidate_device_id is not null and not exists(select 1 from app_private.donation_devices
    where id=candidate_device_id and donation_id=candidate_donation_id) then
    raise exception 'device does not belong to donation' using errcode='22023'; end if;
  insert into app_private.donation_costs
    (donation_id,device_id,category,amount_cents,evidence_reference,incurred_at,recorded_by)
  values(candidate_donation_id,candidate_device_id,cost_category,cost_amount_cents,
    nullif(trim(evidence_ref),''),incurred_time,actor_user_id) returning id into cost_id;
  insert into app_private.audit_events
    (actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'finance.record_cost','donation_cost',cost_id,
    'staff_financial_entry',jsonb_build_object('category',cost_category,'amount_cents',cost_amount_cents),
    jsonb_build_object('donation_id',candidate_donation_id,'evidence_present',evidence_ref is not null));
  return jsonb_build_object('costId',cost_id);
end; $$;

create function api.staff_prepare_disbursement(actor_user_id uuid,candidate_allocation_id uuid,
  amount_value_cents bigint,beneficiary_ref text,evidence_value jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare allocation_row app_private.proceeds_allocations%rowtype; preparation_id uuid; disbursement_id uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select * into allocation_row from app_private.proceeds_allocations where id=candidate_allocation_id;
  if not found or allocation_row.status='policy_hold' or allocation_row.allocated_cents is null
    or amount_value_cents<=0 or amount_value_cents>allocation_row.allocated_cents then
    raise exception 'allocation is not eligible for disbursement' using errcode='22023'; end if;
  if exists(select 1 from app_private.disbursement_preparation_allocations x
    join app_private.disbursements d on d.preparation_id=x.preparation_id
    where x.allocation_id=candidate_allocation_id and d.status not in ('cancelled','reversed')) then
    raise exception 'allocation already has an active disbursement' using errcode='23505'; end if;
  insert into app_private.disbursement_preparations
    (amount_cents,beneficiary_reference,evidence,prepared_by)
  values(amount_value_cents,trim(beneficiary_ref),coalesce(evidence_value,'{}'::jsonb),actor_user_id)
  returning id into preparation_id;
  insert into app_private.disbursement_preparation_allocations(preparation_id,allocation_id,amount_cents)
    values(preparation_id,candidate_allocation_id,amount_value_cents);
  insert into app_private.disbursements(preparation_id) values(preparation_id) returning id into disbursement_id;
  insert into app_private.allocation_state_events(allocation_id,status,actor_user_id,reason_code)
    values(candidate_allocation_id,'approved',actor_user_id,'disbursement_prepared');
  insert into app_private.audit_events
    (actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'finance.prepare_disbursement','disbursement',disbursement_id,
    'manual_disbursement_preparation',jsonb_build_object('amount_cents',amount_value_cents),
    jsonb_build_object('allocation_id',candidate_allocation_id,'preparation_id',preparation_id));
  return jsonb_build_object('preparationId',preparation_id,'disbursementId',disbursement_id);
end; $$;

create function api.staff_decide_disbursement(actor_user_id uuid,candidate_preparation_id uuid,
  decision_value app_private.approval_outcome,reason_value text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare preparation_row app_private.disbursement_preparations%rowtype;
  policy_row app_private.financial_approval_policies%rowtype; approval_count integer; next_status app_private.disbursement_status;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select * into preparation_row from app_private.disbursement_preparations where id=candidate_preparation_id;
  select * into policy_row from app_private.financial_approval_policies
    where action_type='record_disbursement' and lifecycle='active'
      and now()>=effective_from and (effective_to is null or now()<effective_to)
    order by version desc limit 1;
  if preparation_row.id is null or policy_row.id is null then
    raise exception 'active approval policy and preparation required' using errcode='22023'; end if;
  if actor_user_id=preparation_row.prepared_by and not policy_row.preparer_may_approve then
    raise exception 'preparer cannot approve under active policy' using errcode='42501'; end if;
  insert into app_private.disbursement_approvals
    (preparation_id,approval_policy_id,approver_user_id,outcome,reason)
  values(candidate_preparation_id,policy_row.id,actor_user_id,decision_value,nullif(trim(reason_value),''));
  select count(*) into approval_count from app_private.disbursement_approvals
    where preparation_id=candidate_preparation_id and outcome='approved';
  next_status := case when decision_value='rejected' then 'cancelled'
    when approval_count>=policy_row.required_approvals then 'approved' else 'prepared' end;
  update app_private.disbursements set status=next_status where preparation_id=candidate_preparation_id;
  insert into app_private.audit_events
    (actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'finance.decide_disbursement','disbursement',
    (select id from app_private.disbursements where preparation_id=candidate_preparation_id),
    'configured_approval_policy',jsonb_build_object('outcome',decision_value,'resulting_status',next_status),
    jsonb_build_object('policy_id',policy_row.id,'approval_count',approval_count));
  return jsonb_build_object('status',next_status,'approvalCount',approval_count,
    'requiredApprovals',policy_row.required_approvals);
end; $$;

create function api.staff_record_disbursement_completion(actor_user_id uuid,
  candidate_preparation_id uuid,external_ref text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare disbursement_id uuid; allocation_value uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  update app_private.disbursements set status='completed',external_payment_reference=trim(external_ref),
    completed_by=actor_user_id,completed_at=now()
    where preparation_id=candidate_preparation_id and status='approved' returning id into disbursement_id;
  if disbursement_id is null then raise exception 'approved disbursement required' using errcode='22023'; end if;
  for allocation_value in select allocation_id from app_private.disbursement_preparation_allocations
    where preparation_id=candidate_preparation_id loop
    insert into app_private.allocation_state_events(allocation_id,status,actor_user_id,reason_code)
      values(allocation_value,'disbursed',actor_user_id,'external_payment_recorded');
  end loop;
  insert into app_private.audit_events
    (actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'finance.record_disbursement_completion','disbursement',disbursement_id,
    'externally_executed_payment',jsonb_build_object('completed',true,'external_reference_present',true),
    jsonb_build_object('automated_money_movement',false));
  return jsonb_build_object('disbursementId',disbursement_id,'status','completed');
end; $$;

revoke all on table app_private.allocation_state_events from public,anon,authenticated;
grant select,insert on table app_private.allocation_state_events to service_role;
revoke execute on function api.staff_record_cost(uuid,uuid,uuid,text,bigint,text,timestamptz) from public,anon,authenticated;
revoke execute on function api.staff_prepare_disbursement(uuid,uuid,bigint,text,jsonb) from public,anon,authenticated;
revoke execute on function api.staff_decide_disbursement(uuid,uuid,app_private.approval_outcome,text) from public,anon,authenticated;
revoke execute on function api.staff_record_disbursement_completion(uuid,uuid,text) from public,anon,authenticated;
grant execute on function api.staff_record_cost(uuid,uuid,uuid,text,bigint,text,timestamptz) to service_role;
grant execute on function api.staff_prepare_disbursement(uuid,uuid,bigint,text,jsonb) to service_role;
grant execute on function api.staff_decide_disbursement(uuid,uuid,app_private.approval_outcome,text) to service_role;
grant execute on function api.staff_record_disbursement_completion(uuid,uuid,text) to service_role;
