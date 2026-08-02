-- Final beta authorization boundary: ordinary staff operate donations; admins own
-- publication, partner access, and payout authority. Production is untouched.

create or replace function app_private.assert_active_admin(actor_user_id uuid)
returns void
language plpgsql
set search_path = pg_catalog, app_private
as $$
begin
  if actor_user_id is null or not exists (
    select 1 from app_private.staff_memberships
    where user_id = actor_user_id and status = 'active' and role = 'admin'
  ) then
    raise exception 'active administrator membership required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app_private.assert_active_admin(uuid) from public, anon, authenticated;
grant all on function app_private.assert_active_admin(uuid) to service_role;

CREATE OR REPLACE FUNCTION api.staff_associate_partner_charity(actor_user_id uuid, candidate_organization_id uuid, candidate_charity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_admin(actor_user_id);
  if not exists(select 1 from app_private.organizations where id=candidate_organization_id and status='active')
    or not exists(select 1 from app_private.charities where id=candidate_charity_id and status='verified') then
    raise exception 'active organization and verified charity required' using errcode='22023'; end if;
  insert into app_private.organization_charities(organization_id,charity_id,status,verified_by,verified_at)
  values(candidate_organization_id,candidate_charity_id,'verified',actor_user_id,now())
  on conflict(organization_id,charity_id) do update set status='verified',verified_by=actor_user_id,verified_at=now();
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'partner.associate_charity','organization',candidate_organization_id,'verified_charity_association',
    jsonb_build_object('charity_id',candidate_charity_id),'{}');
  return jsonb_build_object('associated',true);
end $function$;

CREATE OR REPLACE FUNCTION api.staff_create_partner_organization(actor_user_id uuid, name_value text, slug_value text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$
declare organization_id uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_admin(actor_user_id);
  if lower(trim(slug_value)) in (select slug from app_private.reserved_route_slugs) then
    raise exception 'organization slug is reserved' using errcode='23514'; end if;
  insert into app_private.organizations(name,slug,status,created_by)
  values(trim(name_value),lower(trim(slug_value)),'active',actor_user_id) returning id into organization_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'partner.create_organization','organization',organization_id,'staff_partner_onboarding',
    jsonb_build_object('name',trim(name_value),'status','active'),'{}');
  return jsonb_build_object('organizationId',organization_id);
end $function$;

CREATE OR REPLACE FUNCTION api.staff_decide_disbursement(actor_user_id uuid, candidate_preparation_id uuid, decision_value app_private.approval_outcome, reason_value text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$
declare prep app_private.disbursement_preparations%rowtype; policy app_private.financial_approval_policies%rowtype;
  approval_count integer; next_status app_private.disbursement_status; current_status app_private.disbursement_status; allocation_value uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_admin(actor_user_id);
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
end $function$;

CREATE OR REPLACE FUNCTION api.staff_invite_partner_admin(actor_user_id uuid, candidate_organization_id uuid, email_value text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$
declare invitation_id uuid; normalized text := lower(trim(email_value));
  domain_event_id uuid; outbox_id uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_admin(actor_user_id);
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
$function$;

CREATE OR REPLACE FUNCTION api.staff_prepare_disbursement(actor_user_id uuid, candidate_allocation_id uuid, amount_value_cents bigint, payment_memo_value text, evidence_value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$
declare a app_private.proceeds_allocations%rowtype; charity app_private.charities%rowtype;
  policy app_private.financial_approval_policies%rowtype; preparation_id uuid; disbursement_id uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_admin(actor_user_id);
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
end $function$;

CREATE OR REPLACE FUNCTION api.staff_publish_campaign_revision(actor_user_id uuid, candidate_campaign_id uuid, candidate_revision_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$
declare old_revision uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_admin(actor_user_id);
  select c.active_revision_id into old_revision from app_private.campaigns c join app_private.organizations o on o.id=c.organization_id join app_private.charities ch on ch.id=c.charity_id join app_private.organization_charities oc on oc.organization_id=c.organization_id and oc.charity_id=c.charity_id where c.id=candidate_campaign_id and o.status='active' and ch.status='verified' and oc.status='verified' for update of c;
  if not found or not exists(select 1 from app_private.campaign_revisions r where r.id=candidate_revision_id and r.campaign_id=candidate_campaign_id and r.status='draft' and (r.hero_asset_id is null or exists(select 1 from app_private.campaign_assets a where a.id=r.hero_asset_id and a.content_sha256=r.hero_asset_sha256 and a.campaign_id=candidate_campaign_id and a.asset_kind='hero_image')) and (r.supporting_asset_id is null or exists(select 1 from app_private.campaign_assets a where a.id=r.supporting_asset_id and a.content_sha256=r.supporting_asset_sha256 and a.campaign_id=candidate_campaign_id and a.asset_kind='supporting_image')) and app_private.validate_campaign_blocks(r.content_blocks)) then raise exception 'publishable controlled revision with exact assets required' using errcode='22023'; end if;
  update app_private.campaign_revisions set status='superseded' where id=old_revision and status='published';
  update app_private.campaign_revisions set status='published',approved_by=actor_user_id,published_by=actor_user_id,published_at=now() where id=candidate_revision_id;
  update app_private.campaigns set active_revision_id=candidate_revision_id,status='published',updated_at=now() where id=candidate_campaign_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata) values('staff',actor_user_id::text,'campaign.publish_revision','campaign',candidate_campaign_id,'staff_publication',jsonb_build_object('from_revision',old_revision,'to_revision',candidate_revision_id),jsonb_build_object('exact_assets',true));
  return jsonb_build_object('ok',true,'slug',(select slug from app_private.campaigns where id=candidate_campaign_id));
end $function$;

CREATE OR REPLACE FUNCTION api.staff_record_disbursement_completion(actor_user_id uuid, candidate_preparation_id uuid, external_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$
declare disbursement_id uuid; allocation_value uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_admin(actor_user_id);
  update app_private.disbursements set status='completed',external_payment_reference=trim(external_ref),
    completed_by=actor_user_id,completed_at=now() where preparation_id=candidate_preparation_id and status='approved'
    returning id into disbursement_id;
  if disbursement_id is null then raise exception 'approved disbursement required' using errcode='22023'; end if;
  for allocation_value in select allocation_id from app_private.disbursement_preparation_allocations
    where preparation_id=candidate_preparation_id loop
    update app_private.proceeds_allocations set status='disbursed' where id=allocation_value and status='approved';
    insert into app_private.allocation_state_events(allocation_id,status,actor_user_id,reason_code)
    values(allocation_value,'disbursed',actor_user_id,'external_payment_recorded');
  end loop;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'finance.record_disbursement_completion','disbursement',disbursement_id,
    'externally_executed_payment',jsonb_build_object('completed',true,'external_reference_present',true),
    jsonb_build_object('automated_money_movement',false));
  return jsonb_build_object('disbursementId',disbursement_id,'status','completed');
end $function$;

CREATE OR REPLACE FUNCTION api.staff_set_partner_member_status(actor_user_id uuid, candidate_organization_id uuid, candidate_user_id uuid, status_value app_private.membership_status)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_admin(actor_user_id);
  if status_value not in ('active','suspended','removed') then raise exception 'invalid managed status' using errcode='22023'; end if;
  update app_private.organization_memberships set status=status_value,updated_at=now()
  where organization_id=candidate_organization_id and user_id=candidate_user_id;
  if not found then raise exception 'membership required' using errcode='22023'; end if;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'partner.change_member_status','organization',candidate_organization_id,'staff_access_management',
    jsonb_build_object('user_id',candidate_user_id,'status',status_value),'{}');
  return jsonb_build_object('status',status_value);
end $function$;

CREATE OR REPLACE FUNCTION api.staff_set_partner_organization_status(actor_user_id uuid, candidate_organization_id uuid, status_value app_private.organization_status)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_admin(actor_user_id);
  update app_private.organizations set status=status_value,updated_at=now() where id=candidate_organization_id;
  if not found then raise exception 'organization required' using errcode='22023'; end if;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'partner.change_organization_status','organization',candidate_organization_id,
    'staff_partner_lifecycle',jsonb_build_object('status',status_value),'{}');
  return jsonb_build_object('status',status_value);
end $function$;

CREATE OR REPLACE FUNCTION api.staff_verify_partner_charity(actor_user_id uuid, pledge_id_value uuid, canonical_name_value text, ein_value text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'app_private'
AS $function$
declare charity_id uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_admin(actor_user_id);
  insert into app_private.charities(pledge_id,canonical_name,ein,status,verified_by,verified_at)
  values(pledge_id_value,trim(canonical_name_value),nullif(trim(ein_value),''),'verified',actor_user_id,now())
  on conflict(pledge_id) do update set canonical_name=excluded.canonical_name,ein=coalesce(excluded.ein,app_private.charities.ein),
    status='verified',verified_by=actor_user_id,verified_at=now() returning id into charity_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'partner.verify_charity','charity',charity_id,'pledge_canonical_verification',
    jsonb_build_object('pledge_id',pledge_id_value,'canonical_name',trim(canonical_name_value)),'{}');
  return jsonb_build_object('charityId',charity_id);
end $function$;

create or replace function api.staff_session_context(actor_user_id uuid)
returns jsonb
language plpgsql security definer volatile
set search_path = pg_catalog, app_private
as $$
declare role_value app_private.staff_role;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_active_staff(actor_user_id);
  select role into role_value from app_private.staff_memberships
  where user_id = actor_user_id and status = 'active';
  return jsonb_build_object('active', true, 'role', role_value::text);
end;
$$;
revoke all on function api.staff_session_context(uuid) from public, anon, authenticated;
grant all on function api.staff_session_context(uuid) to service_role;

-- Re-apply the service-only boundary to every privileged replacement above.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end;
$$;
