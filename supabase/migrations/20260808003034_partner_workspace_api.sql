-- Narrow service-role API for partner applications, organization workspaces,
-- team access, and immutable public organization profiles.

create or replace function app_private.normalized_partner_role(role_value app_private.organization_role)
returns text language sql immutable set search_path=pg_catalog,app_private as $$
  select case role_value
    when 'partner_admin' then 'partner_admin'
    when 'partner_viewer' then 'partner_viewer'
    else 'partner_editor'
  end
$$;

create or replace function app_private.assert_org_editor(actor_user_id uuid,candidate_organization_id uuid)
returns void language plpgsql set search_path=pg_catalog,app_private as $$
begin
  if actor_user_id is null or not exists(
    select 1 from app_private.organization_memberships m
    join app_private.organizations o on o.id=m.organization_id
    where m.user_id=actor_user_id and m.organization_id=candidate_organization_id
      and m.status='active' and o.status='active'
      and m.role in ('partner_admin','partner_editor','partner_member')
  ) then raise exception 'active organization editor required' using errcode='42501'; end if;
end $$;

create or replace function app_private.assert_org_viewer(actor_user_id uuid,candidate_organization_id uuid)
returns void language plpgsql set search_path=pg_catalog,app_private as $$
begin
  if actor_user_id is null or not exists(
    select 1 from app_private.organization_memberships m
    join app_private.organizations o on o.id=m.organization_id
    where m.user_id=actor_user_id and m.organization_id=candidate_organization_id
      and m.status='active' and o.status='active'
  ) then raise exception 'active organization membership required' using errcode='42501'; end if;
end $$;

create function api.submit_partner_application(
  contact_name_value text, role_title_value text, email_value text,
  organization_name_value text, website_value text, audience_value text,
  goal_value text, timing_value text, consent_value boolean,
  session_hash_value text, idempotency_value text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare contact_id_value uuid; application_id_value uuid; lead_id_value uuid;
  event_id_value uuid; normalized_email text:=lower(trim(email_value));
begin
  perform app_private.assert_service_role();
  select id into application_id_value from app_private.partner_applications
    where idempotency_key=idempotency_value;
  if found then return jsonb_build_object('applicationId',application_id_value,'status','received','replayed',true); end if;
  if not consent_value then raise exception 'consent required' using errcode='22023'; end if;
  if session_hash_value !~ '^[a-f0-9]{64}$' or char_length(idempotency_value) not between 16 and 200 then
    raise exception 'invalid application controls' using errcode='22023'; end if;
  insert into app_private.partner_application_contacts(contact_name,role_title,email_search)
  values(trim(contact_name_value),trim(role_title_value),normalized_email) returning id into contact_id_value;
  insert into app_private.partner_applications(
    contact_id,organization_name,website_url,audience_summary,goal_summary,desired_timing,
    consented_at,idempotency_key,submitted_session_hash
  ) values (
    contact_id_value,trim(organization_name_value),trim(website_value),trim(audience_value),
    trim(goal_value),trim(timing_value),now(),idempotency_value,session_hash_value
  ) returning id into application_id_value;
  insert into app_private.partner_leads(
    requester_email_search,organization_name,website_url,audience_summary,goal_summary,
    timing_summary,request_summary,status,created_by_agent_ref,contact_id,application_id
  ) values (
    'private-contact-'||contact_id_value::text,trim(organization_name_value),trim(website_value),
    trim(audience_value),trim(goal_value),trim(timing_value),'Secure public partnership application.',
    'new','public-partner-application',contact_id_value,application_id_value
  ) returning id into lead_id_value;
  update app_private.partner_applications set partner_lead_id=lead_id_value where id=application_id_value;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('service','public-partner-application','partner.application_submitted','partner_application',application_id_value,
    'consented_public_intake',jsonb_build_object('organization_name',trim(organization_name_value),'status','new'),
    jsonb_build_object('pii_redacted',true,'contact_id',contact_id_value,'lead_id',lead_id_value));
  insert into app_private.domain_events(event_type,aggregate_type,aggregate_id,aggregate_version,payload)
  values('partner.application_submitted','partner_application',application_id_value,1,
    jsonb_build_object('applicationId',application_id_value,'contactId',contact_id_value,'leadId',lead_id_value))
  returning id into event_id_value;
  insert into app_private.outbox_events(domain_event_id,handler_key,event_type,payload)
  values(event_id_value,'partner_application_acknowledgment','partner.application_submitted',
    jsonb_build_object('applicationId',application_id_value));
  return jsonb_build_object('applicationId',application_id_value,'status','received','replayed',false);
end $$;

create function api.get_partner_application_notification(candidate_application_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object('applicationId',a.id,'contactName',c.contact_name,'email',c.email_search,
    'organizationName',a.organization_name,'status',a.status) into result
  from app_private.partner_applications a join app_private.partner_application_contacts c on c.id=a.contact_id
  where a.id=candidate_application_id;
  return result;
end $$;

create function api.staff_partner_application_queue(actor_user_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select jsonb_build_object('applications',coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'status',a.status,'organizationName',a.organization_name,'websiteUrl',a.website_url,
    'audience',a.audience_summary,'goal',a.goal_summary,'desiredTiming',a.desired_timing,
    'contact',jsonb_build_object('name',c.contact_name,'role',c.role_title,'email',c.email_search),
    'organizationId',a.organization_id,'createdAt',a.created_at
  ) order by a.created_at desc),'[]'::jsonb)) into result
  from app_private.partner_applications a join app_private.partner_application_contacts c on c.id=a.contact_id;
  return result;
end $$;

create function api.staff_review_partner_application(
  actor_user_id uuid,candidate_application_id uuid,status_value app_private.partner_application_status,
  candidate_organization_id uuid default null
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_admin(actor_user_id);
  if status_value in ('verified','converted') and candidate_organization_id is null then
    raise exception 'verified applications require an organization' using errcode='22023'; end if;
  if candidate_organization_id is not null and not exists(select 1 from app_private.organizations where id=candidate_organization_id) then
    raise exception 'organization not found' using errcode='22023'; end if;
  update app_private.partner_applications set status=status_value,organization_id=candidate_organization_id,
    reviewed_by=actor_user_id,reviewed_at=now(),updated_at=now() where id=candidate_application_id;
  if not found then raise exception 'application not found' using errcode='22023'; end if;
  update app_private.partner_leads set status=case status_value
    when 'converted' then 'converted' when 'declined' then 'closed' when 'needs_information' then 'waiting_on_partner'
    when 'verified' then 'ready_for_admin' else 'qualified' end,organization_id=candidate_organization_id,updated_at=now()
  where application_id=candidate_application_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'partner.review_application','partner_application',candidate_application_id,
    'staff_application_review',jsonb_build_object('status',status_value,'organization_id',candidate_organization_id),
    jsonb_build_object('pii_redacted',true));
  return jsonb_build_object('applicationId',candidate_application_id,'status',status_value);
end $$;

create or replace function api.partner_workspace(actor_user_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object('organizations',coalesce(jsonb_agg(jsonb_build_object(
    'id',o.id,'name',o.name,'slug',o.slug,'status',o.status,
    'role',app_private.normalized_partner_role(m.role),
    'onboarding',jsonb_build_object(
      'organizationProfile',o.active_profile_revision_id is not null,
      'team',(select count(*)>1 from app_private.organization_memberships x where x.organization_id=o.id and x.status='active'),
      'verifiedBeneficiary',exists(select 1 from app_private.organization_charities oc where oc.organization_id=o.id and oc.status='verified'),
      'campaignTerms',exists(select 1 from app_private.campaigns x join app_private.proceeds_policy_assignments a
        on a.scope='campaign' and a.scope_id=x.id and a.enabled join app_private.proceeds_policy_versions v
        on v.id=a.policy_version_id and v.lifecycle in ('approved','active') where x.organization_id=o.id),
      'campaignContent',exists(select 1 from app_private.campaign_working_drafts d join app_private.campaigns x on x.id=d.campaign_id
        where x.organization_id=o.id and char_length(trim(d.headline))>0 and char_length(trim(d.summary))>0 and char_length(trim(d.story))>0),
      'launchDates',exists(select 1 from app_private.campaigns x where x.organization_id=o.id and (x.starts_at is not null or x.ends_at is not null)),
      'toolkit',exists(select 1 from app_private.campaign_working_drafts d join app_private.campaigns x on x.id=d.campaign_id where x.organization_id=o.id and d.toolkit<>'{}'::jsonb),
      'publicationReview',exists(select 1 from app_private.campaign_revisions r join app_private.campaigns x on x.id=r.campaign_id
        where x.organization_id=o.id and r.status in ('staff_review','approved','published'))
    ),
    'profile',jsonb_build_object(
      'published',o.active_profile_revision_id is not null,
      'draft',(select jsonb_build_object('lockVersion',d.lock_version,'reviewState',d.review_state,'updatedAt',d.updated_at)
        from app_private.organization_profile_drafts d where d.organization_id=o.id)
    ),
    'verifiedCharities',(select coalesce(jsonb_agg(jsonb_build_object('id',ch.id,'name',ch.canonical_name,'pledgeId',ch.pledge_id)),'[]'::jsonb)
      from app_private.organization_charities oc join app_private.charities ch on ch.id=oc.charity_id
      where oc.organization_id=o.id and oc.status='verified' and ch.status='verified'),
    'campaigns',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',c.id,'name',c.name,'slug',c.slug,'status',c.status,'charityName',ch.canonical_name,
      'phoneGoal',c.phone_goal,'startsAt',c.starts_at,'endsAt',c.ends_at,
      'reviewState',coalesce(d.review_state,'editing'),'reviewFeedback',d.review_feedback,
      'metrics',jsonb_build_object(
        'views',(select count(*) from app_private.campaign_events e where e.campaign_id=c.id and e.event_type='view'),
        'donationStarts',(select count(*) from app_private.campaign_events e where e.campaign_id=c.id and e.event_type='donation_started'),
        'submittedDonations',(select count(*) from app_private.donations x where x.campaign_id=c.id),
        'phonesPledged',(select count(*) from app_private.donation_devices x join app_private.donations dn on dn.id=x.donation_id where dn.campaign_id=c.id),
        'phonesReceived',(select count(*) from app_private.donation_devices x join app_private.donations dn on dn.id=x.donation_id where dn.campaign_id=c.id and x.receipt_status in ('received','unexpected')),
        'phonesProcessed',(select count(*) from app_private.donation_devices x join app_private.donations dn on dn.id=x.donation_id where dn.campaign_id=c.id and x.processing_status='complete'),
        'completedDonations',(select count(*) from app_private.donations x where x.campaign_id=c.id and x.status='completed')
      ),
      'financial',jsonb_build_object(
        'grossProceedsCents',coalesce((select sum(a.gross_cents) from app_private.proceeds_allocations a
          join app_private.donations dn on dn.id=a.donation_id where dn.campaign_id=c.id and a.status<>'reversed'),0),
        'eligibleCostCents',coalesce((select sum(a.eligible_cost_cents) from app_private.proceeds_allocations a
          join app_private.donations dn on dn.id=a.donation_id where dn.campaign_id=c.id and a.status<>'reversed'),0),
        'allocableBaseCents',coalesce((select sum(a.allocable_base_cents) from app_private.proceeds_allocations a
          join app_private.donations dn on dn.id=a.donation_id where dn.campaign_id=c.id and a.status<>'reversed'),0),
        'allocationCents',coalesce((select sum(a.allocated_cents) from app_private.proceeds_allocations a
          join app_private.donations dn on dn.id=a.donation_id where dn.campaign_id=c.id and a.status<>'reversed'),0),
        'provisional',exists(select 1 from app_private.proceeds_allocations a join app_private.donations dn on dn.id=a.donation_id
          where dn.campaign_id=c.id and a.status in ('policy_hold','calculated')),
        'disbursementStatus',coalesce((select max(ds.status::text) from app_private.disbursements ds
          join app_private.disbursement_preparation_allocations dpa on dpa.preparation_id=ds.preparation_id
          join app_private.proceeds_allocations a on a.id=dpa.allocation_id
          join app_private.donations dn on dn.id=a.donation_id where dn.campaign_id=c.id),'not_prepared')
      )
    ) order by c.updated_at desc),'[]'::jsonb)
      from app_private.campaigns c join app_private.charities ch on ch.id=c.charity_id
      left join app_private.campaign_working_drafts d on d.campaign_id=c.id where c.organization_id=o.id),
    'recentActivity',(select coalesce(jsonb_agg(activity),'[]'::jsonb) from (
      select jsonb_build_object('type',e.action_name,'entityType',e.entity_type,'occurredAt',e.occurred_at) activity
      from app_private.audit_events e where e.metadata->>'organization_id'=o.id::text
        or (e.entity_type='organization' and e.entity_id=o.id)
      order by e.occurred_at desc limit 12
    ) recent),
    'team',(select coalesce(jsonb_agg(jsonb_build_object('userId',tm.user_id,'email',u.email,
      'role',app_private.normalized_partner_role(tm.role),'status',tm.status)),'[]'::jsonb)
      from app_private.organization_memberships tm join auth.users u on u.id=tm.user_id where tm.organization_id=o.id),
    'invitations',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'email',i.email_search,
      'role',app_private.normalized_partner_role(i.role),'status',i.status,'expiresAt',i.expires_at)),'[]'::jsonb)
      from app_private.partner_invitations i where i.organization_id=o.id and i.revoked_at is null)
  ) order by o.name),'[]'::jsonb)) into result
  from app_private.organization_memberships m join app_private.organizations o on o.id=m.organization_id
  where m.user_id=actor_user_id and m.status='active' and o.status='active';
  return result;
end $$;

create function api.partner_invite_member(actor_user_id uuid,candidate_organization_id uuid,
  email_value text,role_value app_private.organization_role)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare invitation_id_value uuid; normalized_email text:=lower(trim(email_value)); event_id_value uuid; outbox_id_value uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_org_admin(actor_user_id,candidate_organization_id);
  if role_value not in ('partner_editor','partner_viewer') then
    raise exception 'partners may invite editors or viewers only' using errcode='42501'; end if;
  update app_private.partner_invitations set status='removed',revoked_by=actor_user_id,revoked_at=now()
    where organization_id=candidate_organization_id and email_search=normalized_email and status='invited';
  insert into app_private.partner_invitations(organization_id,email_search,role,status,invited_by,expires_at)
  values(candidate_organization_id,normalized_email,role_value,'invited',actor_user_id,now()+interval '7 days')
  returning id into invitation_id_value;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('partner',actor_user_id::text,'partner.invite_member','partner_invitation',invitation_id_value,
    'partner_team_management',jsonb_build_object('role',role_value,'expires_in_days',7),
    jsonb_build_object('organization_id',candidate_organization_id,'pii_redacted',true));
  insert into app_private.domain_events(event_type,aggregate_type,aggregate_id,aggregate_version,payload)
  values('partner.invitation_created','partner_invitation',invitation_id_value,1,
    jsonb_build_object('invitationId',invitation_id_value,'organizationId',candidate_organization_id))
  returning id into event_id_value;
  insert into app_private.outbox_events(domain_event_id,handler_key,event_type,payload)
  values(event_id_value,'partner_invitation_email','partner.invitation_created',jsonb_build_object('invitationId',invitation_id_value))
  returning id into outbox_id_value;
  return jsonb_build_object('invitationId',invitation_id_value,'outboxEventId',outbox_id_value,'expiresAt',now()+interval '7 days');
end $$;

create function api.partner_revoke_invitation(actor_user_id uuid,candidate_organization_id uuid,candidate_invitation_id uuid)
returns boolean language plpgsql security definer
set search_path=pg_catalog,app_private as $$
begin
  perform app_private.assert_service_role(); perform app_private.assert_org_admin(actor_user_id,candidate_organization_id);
  update app_private.partner_invitations set status='removed',revoked_by=actor_user_id,revoked_at=now()
    where id=candidate_invitation_id and organization_id=candidate_organization_id and status='invited';
  if not found then raise exception 'active invitation not found' using errcode='22023'; end if;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('partner',actor_user_id::text,'partner.revoke_invitation','partner_invitation',candidate_invitation_id,
    'partner_team_management',jsonb_build_object('status','removed'),
    jsonb_build_object('organization_id',candidate_organization_id,'pii_redacted',true));
  return true;
end $$;

create function api.partner_set_member_status(actor_user_id uuid,candidate_organization_id uuid,
  candidate_user_id uuid,status_value app_private.membership_status)
returns boolean language plpgsql security definer
set search_path=pg_catalog,app_private as $$
begin
  perform app_private.assert_service_role(); perform app_private.assert_org_admin(actor_user_id,candidate_organization_id);
  if status_value not in ('active','suspended','removed') then raise exception 'invalid member status' using errcode='22023'; end if;
  update app_private.organization_memberships set status=status_value,updated_at=now()
    where organization_id=candidate_organization_id and user_id=candidate_user_id
      and role in ('partner_editor','partner_viewer','partner_member');
  if not found then raise exception 'partner administrators cannot change administrator access' using errcode='42501'; end if;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('partner',actor_user_id::text,'partner.set_member_status','organization_membership',candidate_user_id,
    'partner_team_management',jsonb_build_object('status',status_value),
    jsonb_build_object('organization_id',candidate_organization_id));
  return true;
end $$;

create function api.partner_profile_detail(actor_user_id uuid,candidate_organization_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role(); perform app_private.assert_org_viewer(actor_user_id,candidate_organization_id);
  select jsonb_build_object(
    'organization',jsonb_build_object('id',o.id,'name',o.name,'slug',o.slug,'activeRevisionId',o.active_profile_revision_id),
    'draft',(select jsonb_build_object('mission',d.mission,'summary',d.summary,'websiteUrl',d.website_url,
      'locality',d.locality,'region',d.region,'countryCode',d.country_code,'logoAssetId',d.logo_asset_id,
      'heroAssetId',d.hero_asset_id,'reviewState',d.review_state,'reviewFeedback',d.review_feedback,
      'lockVersion',d.lock_version,'updatedAt',d.updated_at) from app_private.organization_profile_drafts d where d.organization_id=o.id),
    'revisions',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'version',r.version,'status',r.status,
      'contentHash',r.content_hash,'createdAt',r.created_at,'publishedAt',r.published_at) order by r.version desc),'[]'::jsonb)
      from app_private.organization_profile_revisions r where r.organization_id=o.id),
    'assets',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'assetKind',a.asset_kind,'mimeType',a.mime_type,
      'altText',a.alt_text,'isDecorative',a.is_decorative,'width',a.width_pixels,'height',a.height_pixels,
      'previewUrl','/api/partner/organization-assets/'||a.id::text) order by a.created_at desc),'[]'::jsonb)
      from app_private.organization_assets a where a.organization_id=o.id),
    'reviews',(select coalesce(jsonb_agg(jsonb_build_object('revisionId',r.revision_id,'outcome',r.outcome,
      'feedback',r.feedback,'createdAt',r.created_at) order by r.created_at desc),'[]'::jsonb)
      from app_private.organization_profile_reviews r where r.organization_id=o.id)
  ) into result from app_private.organizations o where o.id=candidate_organization_id;
  return result;
end $$;

create function api.partner_save_profile_draft(actor_user_id uuid,candidate_organization_id uuid,
  expected_lock_version integer,mission_value text,summary_value text,website_value text,
  locality_value text,region_value text,country_value text,logo_asset_value uuid,hero_asset_value uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare next_lock integer;
begin
  perform app_private.assert_service_role(); perform app_private.assert_org_editor(actor_user_id,candidate_organization_id);
  if logo_asset_value is not null and not exists(select 1 from app_private.organization_assets where id=logo_asset_value and organization_id=candidate_organization_id and asset_kind='logo') then
    raise exception 'organization logo asset required' using errcode='22023'; end if;
  if hero_asset_value is not null and not exists(select 1 from app_private.organization_assets where id=hero_asset_value and organization_id=candidate_organization_id and asset_kind='hero_image') then
    raise exception 'organization hero asset required' using errcode='22023'; end if;
  insert into app_private.organization_profile_drafts(
    organization_id,mission,summary,website_url,locality,region,country_code,logo_asset_id,hero_asset_id,updated_by
  ) values(candidate_organization_id,trim(mission_value),trim(summary_value),nullif(trim(website_value),''),
    nullif(trim(locality_value),''),nullif(trim(region_value),''),upper(trim(country_value)),logo_asset_value,hero_asset_value,actor_user_id)
  on conflict(organization_id) do update set mission=excluded.mission,summary=excluded.summary,
    website_url=excluded.website_url,locality=excluded.locality,region=excluded.region,country_code=excluded.country_code,
    logo_asset_id=excluded.logo_asset_id,hero_asset_id=excluded.hero_asset_id,review_state='editing',review_feedback=null,
    lock_version=app_private.organization_profile_drafts.lock_version+1,updated_by=actor_user_id,updated_at=now()
  where app_private.organization_profile_drafts.lock_version=expected_lock_version
  returning lock_version into next_lock;
  if next_lock is null then raise exception 'profile draft conflict' using errcode='40001'; end if;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('partner',actor_user_id::text,'organization_profile.save_draft','organization',candidate_organization_id,
    'partner_profile_edit',jsonb_build_object('lock_version',next_lock,'has_logo',logo_asset_value is not null,
      'has_hero',hero_asset_value is not null),jsonb_build_object('content_redacted',true));
  return jsonb_build_object('lockVersion',next_lock,'savedAt',now());
end $$;

create function api.partner_submit_profile_review(actor_user_id uuid,candidate_organization_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare draft_row app_private.organization_profile_drafts%rowtype; next_version integer; revision_id_value uuid;
  logo_sha text; hero_sha text; canonical_hash text;
begin
  perform app_private.assert_service_role(); perform app_private.assert_org_admin(actor_user_id,candidate_organization_id);
  select * into draft_row from app_private.organization_profile_drafts where organization_id=candidate_organization_id for update;
  if char_length(trim(draft_row.mission))=0 or char_length(trim(draft_row.summary))=0 or draft_row.website_url is null then
    raise exception 'complete profile draft required' using errcode='22023'; end if;
  select content_sha256 into logo_sha from app_private.organization_assets where id=draft_row.logo_asset_id and organization_id=candidate_organization_id;
  select content_sha256 into hero_sha from app_private.organization_assets where id=draft_row.hero_asset_id and organization_id=candidate_organization_id;
  canonical_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'mission',draft_row.mission,'summary',draft_row.summary,'websiteUrl',draft_row.website_url,
    'locality',draft_row.locality,'region',draft_row.region,'countryCode',draft_row.country_code,
    'logoAssetId',draft_row.logo_asset_id,'logoAssetSha256',logo_sha,
    'heroAssetId',draft_row.hero_asset_id,'heroAssetSha256',hero_sha)::text,'utf8'),'sha256'),'hex');
  select coalesce(max(version),0)+1 into next_version from app_private.organization_profile_revisions where organization_id=candidate_organization_id;
  insert into app_private.organization_profile_revisions(
    organization_id,version,status,mission,summary,website_url,locality,region,country_code,
    logo_asset_id,logo_asset_sha256,hero_asset_id,hero_asset_sha256,content_hash,requested_by
  ) values(candidate_organization_id,next_version,'staff_review',draft_row.mission,draft_row.summary,draft_row.website_url,
    draft_row.locality,draft_row.region,draft_row.country_code,draft_row.logo_asset_id,logo_sha,
    draft_row.hero_asset_id,hero_sha,canonical_hash,actor_user_id) returning id into revision_id_value;
  update app_private.organization_profile_drafts set review_state='staff_review',review_feedback=null where organization_id=candidate_organization_id;
  insert into app_private.organization_profile_reviews(organization_id,revision_id,outcome,actor_kind,actor_user_id)
  values(candidate_organization_id,revision_id_value,'requested','partner',actor_user_id);
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('partner',actor_user_id::text,'organization_profile.request_staff_review','organization_profile_revision',revision_id_value,
    'partner_admin_approved_exact_revision',jsonb_build_object('version',next_version,'content_hash',canonical_hash),
    jsonb_build_object('organization_id',candidate_organization_id));
  return jsonb_build_object('revisionId',revision_id_value,'version',next_version,'status','staff_review');
end $$;

create function api.staff_review_profile_revision(actor_user_id uuid,candidate_organization_id uuid,
  candidate_revision_id uuid,outcome_value app_private.review_outcome,feedback_value text default null)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_admin(actor_user_id);
  if outcome_value not in ('approved','changes_requested') then raise exception 'invalid profile review outcome' using errcode='22023'; end if;
  update app_private.organization_profile_revisions set status=case when outcome_value='approved'
      then 'approved'::app_private.profile_revision_status else 'rejected'::app_private.profile_revision_status end,
    approved_by=case when outcome_value='approved' then actor_user_id else null end
    where id=candidate_revision_id and organization_id=candidate_organization_id and status='staff_review';
  if not found then raise exception 'reviewable exact profile revision required' using errcode='22023'; end if;
  update app_private.organization_profile_drafts set review_state=case when outcome_value='approved' then 'staff_review' else 'changes_requested' end,
    review_feedback=nullif(trim(feedback_value),'') where organization_id=candidate_organization_id;
  insert into app_private.organization_profile_reviews(organization_id,revision_id,outcome,feedback,actor_kind,actor_user_id)
  values(candidate_organization_id,candidate_revision_id,outcome_value,nullif(trim(feedback_value),''),'staff',actor_user_id);
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'organization_profile.review_revision','organization_profile_revision',candidate_revision_id,
    'staff_exact_revision_review',jsonb_build_object('outcome',outcome_value),
    jsonb_build_object('organization_id',candidate_organization_id,'feedback_recorded',nullif(trim(feedback_value),'') is not null));
  return jsonb_build_object('revisionId',candidate_revision_id,'outcome',outcome_value);
end $$;

create function api.staff_publish_profile_revision(actor_user_id uuid,candidate_organization_id uuid,candidate_revision_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare old_revision uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_admin(actor_user_id);
  select active_profile_revision_id into old_revision from app_private.organizations where id=candidate_organization_id for update;
  if not exists(select 1 from app_private.organization_profile_revisions r where r.id=candidate_revision_id
    and r.organization_id=candidate_organization_id and r.status='approved'
    and (r.logo_asset_id is null or exists(select 1 from app_private.organization_assets a where a.id=r.logo_asset_id and a.content_sha256=r.logo_asset_sha256))
    and (r.hero_asset_id is null or exists(select 1 from app_private.organization_assets a where a.id=r.hero_asset_id and a.content_sha256=r.hero_asset_sha256))) then
    raise exception 'approved exact profile revision with verified assets required' using errcode='22023'; end if;
  update app_private.organization_profile_revisions set status='superseded' where id=old_revision and status='published';
  update app_private.organization_profile_revisions set status='published',published_by=actor_user_id,published_at=now()
    where id=candidate_revision_id;
  update app_private.organizations set active_profile_revision_id=candidate_revision_id,updated_at=now() where id=candidate_organization_id;
  insert into app_private.organization_profile_reviews(organization_id,revision_id,outcome,actor_kind,actor_user_id)
  values(candidate_organization_id,candidate_revision_id,'published','staff',actor_user_id);
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'organization_profile.publish_revision','organization',candidate_organization_id,
    'staff_exact_revision_publication',jsonb_build_object('from_revision',old_revision,'to_revision',candidate_revision_id),
    jsonb_build_object('verified_assets',true));
  return jsonb_build_object('organizationId',candidate_organization_id,'revisionId',candidate_revision_id,
    'slug',(select slug from app_private.organizations where id=candidate_organization_id));
end $$;

create function api.get_public_nonprofit(profile_slug text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object('id',o.id,'slug',o.slug,'name',o.name,'mission',r.mission,'summary',r.summary,
    'websiteUrl',r.website_url,'locality',r.locality,'region',r.region,'countryCode',r.country_code,
    'logoImageUrl',case when r.logo_asset_id is null then null else '/api/nonprofit-assets/'||r.logo_asset_id::text end,
    'heroImageUrl',case when r.hero_asset_id is null then null else '/api/nonprofit-assets/'||r.hero_asset_id::text end,
    'logoAltText',(select alt_text from app_private.organization_assets where id=r.logo_asset_id),
    'heroAltText',(select alt_text from app_private.organization_assets where id=r.hero_asset_id),
    'contentHash',r.content_hash,'publishedAt',r.published_at,
    'primaryCharity',(select jsonb_build_object('name',ch.canonical_name,'pledgeId',ch.pledge_id,'ein',ch.ein)
      from app_private.organization_charities oc join app_private.charities ch on ch.id=oc.charity_id
      where oc.organization_id=o.id and oc.status='verified' and ch.status='verified' order by oc.verified_at limit 1),
    'campaigns',(select coalesce(jsonb_agg(jsonb_build_object('slug',c.slug,'name',c.name,'status',c.status,
      'startsAt',c.starts_at,'endsAt',c.ends_at,'phoneGoal',c.phone_goal) order by c.created_at desc),'[]'::jsonb)
      from app_private.campaigns c where c.organization_id=o.id and c.status in ('scheduled','published','ended'))
  ) into result from app_private.organizations o join app_private.organization_profile_revisions r on r.id=o.active_profile_revision_id
  where o.slug=lower(trim(profile_slug)) and o.status='active' and r.status='published';
  return result;
end $$;

create function api.get_public_nonprofits()
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
begin
  perform app_private.assert_service_role();
  return coalesce((select jsonb_agg(jsonb_build_object('slug',o.slug,'name',o.name,'summary',r.summary,
    'publishedAt',r.published_at) order by o.name) from app_private.organizations o
    join app_private.organization_profile_revisions r on r.id=o.active_profile_revision_id
    where o.status='active' and r.status='published'),'[]'::jsonb);
end $$;

create function api.partner_register_organization_asset(actor_user_id uuid,candidate_organization_id uuid,
  asset_kind_value text,storage_path_value text,mime_type_value text,byte_size_value integer,
  width_value integer,height_value integer,alt_text_value text,decorative_value boolean,content_sha256_value text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare asset_id_value uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_org_editor(actor_user_id,candidate_organization_id);
  if storage_path_value !~ ('^organizations/'||candidate_organization_id::text||'/[0-9a-f-]{36}[.](jpg|jpeg|png|webp)$') then
    raise exception 'controlled organization asset path required' using errcode='22023'; end if;
  insert into app_private.organization_assets(organization_id,asset_kind,storage_path,mime_type,byte_size,
    width_pixels,height_pixels,content_sha256,alt_text,is_decorative,metadata_scrubbed,uploaded_by)
  values(candidate_organization_id,asset_kind_value,storage_path_value,mime_type_value,byte_size_value,
    width_value,height_value,content_sha256_value,coalesce(trim(alt_text_value),''),decorative_value,true,actor_user_id)
  returning id into asset_id_value;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('partner',actor_user_id::text,'organization_profile.register_asset','organization_asset',asset_id_value,
    'sanitized_partner_media',jsonb_build_object('asset_kind',asset_kind_value,'mime_type',mime_type_value,
      'byte_size',byte_size_value,'width',width_value,'height',height_value,'content_sha256',content_sha256_value),
    jsonb_build_object('organization_id',candidate_organization_id,'metadata_scrubbed',true));
  return jsonb_build_object('id',asset_id_value,'previewUrl','/api/partner/organization-assets/'||asset_id_value::text);
end $$;

create function api.partner_delete_organization_asset(actor_user_id uuid,candidate_organization_id uuid,candidate_asset_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare storage_path_value text;
begin
  perform app_private.assert_service_role(); perform app_private.assert_org_editor(actor_user_id,candidate_organization_id);
  delete from app_private.organization_assets where id=candidate_asset_id and organization_id=candidate_organization_id
    and not exists(select 1 from app_private.organization_profile_drafts d where d.logo_asset_id=candidate_asset_id or d.hero_asset_id=candidate_asset_id)
  returning storage_path into storage_path_value;
  if storage_path_value is null then raise exception 'only unused organization assets may be deleted' using errcode='23503'; end if;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('partner',actor_user_id::text,'organization_profile.delete_asset','organization_asset',candidate_asset_id,
    'unused_partner_media_removed',jsonb_build_object('removed',true),
    jsonb_build_object('organization_id',candidate_organization_id));
  return jsonb_build_object('storagePath',storage_path_value);
end $$;

create function api.get_public_nonprofit_asset(candidate_asset_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object('id',a.id,'storagePath',a.storage_path,'mimeType',a.mime_type,'altText',a.alt_text,
    'contentSha256',a.content_sha256) into result from app_private.organization_assets a
  join app_private.organization_profile_revisions r on r.status='published' and (r.logo_asset_id=a.id or r.hero_asset_id=a.id)
  join app_private.organizations o on o.id=r.organization_id and o.active_profile_revision_id=r.id and o.status='active'
  where a.id=candidate_asset_id;
  return result;
end $$;

create function api.partner_organization_asset(actor_user_id uuid,candidate_asset_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare result jsonb; organization_id_value uuid;
begin
  perform app_private.assert_service_role();
  select organization_id into organization_id_value from app_private.organization_assets where id=candidate_asset_id;
  perform app_private.assert_org_viewer(actor_user_id,organization_id_value);
  select jsonb_build_object('id',id,'storagePath',storage_path,'mimeType',mime_type,'contentSha256',content_sha256)
  into result from app_private.organization_assets where id=candidate_asset_id;
  return result;
end $$;

revoke execute on all functions in schema api from public,anon,authenticated;
grant execute on function api.submit_partner_application(text,text,text,text,text,text,text,text,boolean,text,text),
  api.get_partner_application_notification(uuid),api.staff_partner_application_queue(uuid),
  api.staff_review_partner_application(uuid,uuid,app_private.partner_application_status,uuid),
  api.partner_workspace(uuid),api.partner_invite_member(uuid,uuid,text,app_private.organization_role),
  api.partner_revoke_invitation(uuid,uuid,uuid),api.partner_set_member_status(uuid,uuid,uuid,app_private.membership_status),
  api.partner_profile_detail(uuid,uuid),api.partner_save_profile_draft(uuid,uuid,integer,text,text,text,text,text,text,uuid,uuid),
  api.partner_submit_profile_review(uuid,uuid),api.staff_review_profile_revision(uuid,uuid,uuid,app_private.review_outcome,text),
  api.staff_publish_profile_revision(uuid,uuid,uuid),api.get_public_nonprofit(text),api.get_public_nonprofits(),
  api.partner_register_organization_asset(uuid,uuid,text,text,text,integer,integer,integer,text,boolean,text),
  api.partner_delete_organization_asset(uuid,uuid,uuid),api.get_public_nonprofit_asset(uuid),
  api.partner_organization_asset(uuid,uuid)
to service_role;

revoke execute on function app_private.normalized_partner_role(app_private.organization_role),
  app_private.assert_org_editor(uuid,uuid),app_private.assert_org_viewer(uuid,uuid)
from public,anon,authenticated;
