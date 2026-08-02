-- Campaign assets are intentionally disabled until immutable byte storage,
-- signature validation, digest binding, and a public serving route exist.
update app_private.campaign_revisions set hero_asset_id=null where hero_asset_id is not null;
alter table app_private.campaign_revisions add constraint campaign_assets_deferred check(hero_asset_id is null);

create table app_private.partner_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_private.organizations(id) on delete cascade,
  email_search text not null check(email_search=lower(trim(email_search)) and char_length(email_search) between 3 and 320),
  role app_private.organization_role not null default 'partner_admin',
  status app_private.membership_status not null default 'invited',
  invited_by uuid not null references auth.users(id) on delete restrict,
  invited_at timestamptz not null default now(),
  activated_by uuid references auth.users(id) on delete restrict,
  activated_at timestamptz,
  suspended_by uuid references auth.users(id) on delete restrict,
  suspended_at timestamptz
);
create unique index partner_invitations_open_email_org_idx on app_private.partner_invitations(organization_id,email_search)
where status in ('invited','active');
alter table app_private.partner_invitations enable row level security;
revoke all on app_private.partner_invitations from public,anon,authenticated;
grant select,insert,update on app_private.partner_invitations to service_role;

create or replace function app_private.assert_org_member(actor_user_id uuid,candidate_organization_id uuid)
returns void language plpgsql set search_path=pg_catalog,app_private as $$
begin
  if actor_user_id is null or not exists(select 1 from app_private.organization_memberships m
    join app_private.organizations o on o.id=m.organization_id where m.user_id=actor_user_id
    and m.organization_id=candidate_organization_id and m.status='active' and o.status='active') then
    raise exception 'active organization membership required' using errcode='42501'; end if;
end $$;
create or replace function app_private.assert_org_admin(actor_user_id uuid,candidate_organization_id uuid)
returns void language plpgsql set search_path=pg_catalog,app_private as $$
begin
  if actor_user_id is null or not exists(select 1 from app_private.organization_memberships m
    join app_private.organizations o on o.id=m.organization_id where m.user_id=actor_user_id
    and m.organization_id=candidate_organization_id and m.status='active' and m.role='partner_admin' and o.status='active') then
    raise exception 'active organization administrator required' using errcode='42501'; end if;
end $$;

create function api.staff_create_partner_organization(actor_user_id uuid,name_value text,slug_value text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare organization_id uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  if lower(trim(slug_value)) in (select slug from app_private.reserved_route_slugs) then
    raise exception 'organization slug is reserved' using errcode='23514'; end if;
  insert into app_private.organizations(name,slug,status,created_by)
  values(trim(name_value),lower(trim(slug_value)),'active',actor_user_id) returning id into organization_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'partner.create_organization','organization',organization_id,'staff_partner_onboarding',
    jsonb_build_object('name',trim(name_value),'status','active'),'{}');
  return jsonb_build_object('organizationId',organization_id);
end $$;

create function api.staff_verify_partner_charity(actor_user_id uuid,pledge_id_value uuid,canonical_name_value text,
  ein_value text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare charity_id uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  insert into app_private.charities(pledge_id,canonical_name,ein,status,verified_by,verified_at)
  values(pledge_id_value,trim(canonical_name_value),nullif(trim(ein_value),''),'verified',actor_user_id,now())
  on conflict(pledge_id) do update set canonical_name=excluded.canonical_name,ein=coalesce(excluded.ein,app_private.charities.ein),
    status='verified',verified_by=actor_user_id,verified_at=now() returning id into charity_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'partner.verify_charity','charity',charity_id,'pledge_canonical_verification',
    jsonb_build_object('pledge_id',pledge_id_value,'canonical_name',trim(canonical_name_value)),'{}');
  return jsonb_build_object('charityId',charity_id);
end $$;

create function api.staff_associate_partner_charity(actor_user_id uuid,candidate_organization_id uuid,
  candidate_charity_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,app_private as $$
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
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
end $$;

create function api.staff_invite_partner_admin(actor_user_id uuid,candidate_organization_id uuid,email_value text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare invitation_id uuid; normalized text:=lower(trim(email_value));
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  if normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or not exists(
    select 1 from app_private.organizations where id=candidate_organization_id and status='active') then
    raise exception 'active organization and valid email required' using errcode='22023'; end if;
  insert into app_private.partner_invitations(organization_id,email_search,role,invited_by)
  values(candidate_organization_id,normalized,'partner_admin',actor_user_id) returning id into invitation_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'partner.invite_admin','partner_invitation',invitation_id,'audited_role_invitation',
    jsonb_build_object('organization_id',candidate_organization_id,'role','partner_admin'),jsonb_build_object('email_redacted',true));
  return jsonb_build_object('invitationId',invitation_id);
end $$;

create function api.activate_partner_invitations(actor_user_id uuid,verified_email text) returns integer
language plpgsql security definer set search_path=pg_catalog,app_private,auth as $$
declare invite app_private.partner_invitations%rowtype; activated integer:=0; auth_email text;
begin
  perform app_private.assert_service_role();
  select lower(email) into auth_email from auth.users where id=actor_user_id and email_confirmed_at is not null;
  if auth_email is null or auth_email<>lower(trim(verified_email)) then raise exception 'verified partner identity required' using errcode='42501'; end if;
  insert into app_private.profiles(user_id) values(actor_user_id) on conflict do nothing;
  for invite in select * from app_private.partner_invitations where email_search=auth_email and status='invited' for update loop
    if exists(select 1 from app_private.organizations where id=invite.organization_id and status='active') then
      insert into app_private.organization_memberships(organization_id,user_id,role,status,invited_by,activated_at)
      values(invite.organization_id,actor_user_id,invite.role,'active',invite.invited_by,now())
      on conflict(organization_id,user_id) do update set role=excluded.role,status='active',activated_at=now(),updated_at=now();
      update app_private.partner_invitations set status='active',activated_by=actor_user_id,activated_at=now() where id=invite.id;
      insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
      values('partner',actor_user_id::text,'partner.accept_invitation','organization',invite.organization_id,'verified_passwordless_acceptance',
        jsonb_build_object('role',invite.role),jsonb_build_object('invitation_id',invite.id));
      activated:=activated+1;
    end if;
  end loop;
  return activated;
end $$;

create function api.staff_set_partner_member_status(actor_user_id uuid,candidate_organization_id uuid,
  candidate_user_id uuid,status_value app_private.membership_status) returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  if status_value not in ('active','suspended','removed') then raise exception 'invalid managed status' using errcode='22023'; end if;
  update app_private.organization_memberships set status=status_value,updated_at=now()
  where organization_id=candidate_organization_id and user_id=candidate_user_id;
  if not found then raise exception 'membership required' using errcode='22023'; end if;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'partner.change_member_status','organization',candidate_organization_id,'staff_access_management',
    jsonb_build_object('user_id',candidate_user_id,'status',status_value),'{}');
  return jsonb_build_object('status',status_value);
end $$;

create function api.staff_set_partner_organization_status(actor_user_id uuid,candidate_organization_id uuid,
  status_value app_private.organization_status) returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  update app_private.organizations set status=status_value,updated_at=now() where id=candidate_organization_id;
  if not found then raise exception 'organization required' using errcode='22023'; end if;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'partner.change_organization_status','organization',candidate_organization_id,
    'staff_partner_lifecycle',jsonb_build_object('status',status_value),'{}');
  return jsonb_build_object('status',status_value);
end $$;

create function api.staff_partner_overview(actor_user_id uuid) returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select jsonb_build_object('organizations',coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'slug',o.slug,'status',o.status,
    'charities',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.canonical_name,'pledgeId',c.pledge_id)),'[]')
      from app_private.organization_charities oc join app_private.charities c on c.id=oc.charity_id where oc.organization_id=o.id and oc.status='verified'),
    'members',(select coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'email',u.email,'role',m.role,'status',m.status)),'[]')
      from app_private.organization_memberships m join auth.users u on u.id=m.user_id where m.organization_id=o.id),
    'invitations',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'email',i.email_search,'role',i.role,'status',i.status)),'[]')
      from app_private.partner_invitations i where i.organization_id=o.id),
    'campaigns',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug,'status',c.status)),'[]')
      from app_private.campaigns c where c.organization_id=o.id)) order by o.name),'[]')) into result from app_private.organizations o;
  return result;
end $$;

revoke execute on function api.staff_create_partner_organization(uuid,text,text),
  api.staff_verify_partner_charity(uuid,uuid,text,text),api.staff_associate_partner_charity(uuid,uuid,uuid),
  api.staff_invite_partner_admin(uuid,uuid,text),api.activate_partner_invitations(uuid,text),
  api.staff_set_partner_member_status(uuid,uuid,uuid,app_private.membership_status),
  api.staff_set_partner_organization_status(uuid,uuid,app_private.organization_status),
  api.staff_partner_overview(uuid) from public,anon,authenticated;
grant execute on function api.staff_create_partner_organization(uuid,text,text),
  api.staff_verify_partner_charity(uuid,uuid,text,text),api.staff_associate_partner_charity(uuid,uuid,uuid),
  api.staff_invite_partner_admin(uuid,uuid,text),api.activate_partner_invitations(uuid,text),
  api.staff_set_partner_member_status(uuid,uuid,uuid,app_private.membership_status),
  api.staff_set_partner_organization_status(uuid,uuid,app_private.organization_status),
  api.staff_partner_overview(uuid) to service_role;
