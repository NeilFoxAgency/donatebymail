-- Guided campaign builder, exact-revision review, aggregate reporting, public
-- lifecycle, privacy-preserving event capture, and staff vanity controls.

create function api.partner_campaign_slug_available(actor_user_id uuid,candidate_organization_id uuid,candidate_slug text)
returns boolean language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare normalized text:=lower(trim(candidate_slug));
begin
  perform app_private.assert_service_role(); perform app_private.assert_org_viewer(actor_user_id,candidate_organization_id);
  return normalized ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    and not exists(select 1 from app_private.reserved_route_slugs where slug=normalized)
    and not exists(select 1 from app_private.campaigns where slug=normalized)
    and not exists(select 1 from app_private.campaign_route_aliases where root_slug=normalized and status='active');
end $$;

create function api.partner_create_campaign_v2(
  actor_user_id uuid,candidate_organization_id uuid,candidate_charity_id uuid,
  campaign_slug text,campaign_name text,headline_value text,summary_value text,story_value text,
  cta_value text,phone_goal_value integer,starts_at_value timestamptz,ends_at_value timestamptz,
  timezone_value text,blocks_value jsonb,toolkit_value jsonb
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare campaign_id_value uuid; charity_row app_private.charities%rowtype; normalized_slug text:=lower(trim(campaign_slug));
begin
  perform app_private.assert_service_role(); perform app_private.assert_org_admin(actor_user_id,candidate_organization_id);
  if not api.partner_campaign_slug_available(actor_user_id,candidate_organization_id,normalized_slug) then
    raise exception 'campaign slug unavailable' using errcode='23505'; end if;
  select ch.* into charity_row from app_private.charities ch join app_private.organization_charities oc on oc.charity_id=ch.id
    where ch.id=candidate_charity_id and oc.organization_id=candidate_organization_id and ch.status='verified' and oc.status='verified';
  if not found then raise exception 'verified organization nonprofit required' using errcode='42501'; end if;
  if ends_at_value is not null and starts_at_value is not null and ends_at_value<=starts_at_value then
    raise exception 'campaign end must follow start' using errcode='22023'; end if;
  if not app_private.validate_campaign_blocks_v2(coalesce(blocks_value,'[]'::jsonb))
    or not app_private.validate_campaign_toolkit(coalesce(toolkit_value,'{}'::jsonb)) then
    raise exception 'invalid campaign content' using errcode='22023'; end if;
  insert into app_private.campaigns(organization_id,slug,name,selected_charity_pledge_id,selected_charity_name,
    charity_id,status,created_by,phone_goal,starts_at,ends_at,timezone)
  values(candidate_organization_id,normalized_slug,trim(campaign_name),charity_row.pledge_id,charity_row.canonical_name,
    charity_row.id,'draft',actor_user_id,phone_goal_value,starts_at_value,ends_at_value,coalesce(nullif(trim(timezone_value),''),'America/New_York'))
  returning id into campaign_id_value;
  insert into app_private.campaign_working_drafts(campaign_id,stage,headline,summary,story,cta_label,
    content_blocks,toolkit,phone_goal,starts_at,ends_at,timezone,updated_by)
  values(campaign_id_value,1,trim(headline_value),trim(summary_value),trim(story_value),
    coalesce(nullif(trim(cta_value),''),'Donate a Phone'),coalesce(blocks_value,'[]'::jsonb),
    coalesce(toolkit_value,'{}'::jsonb),phone_goal_value,starts_at_value,ends_at_value,
    coalesce(nullif(trim(timezone_value),''),'America/New_York'),actor_user_id);
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('partner',actor_user_id::text,'campaign.create_draft','campaign',campaign_id_value,'guided_campaign_builder',
    jsonb_build_object('slug',normalized_slug,'charity_id',charity_row.id,'phone_goal',phone_goal_value),
    jsonb_build_object('organization_id',candidate_organization_id));
  return jsonb_build_object('campaignId',campaign_id_value,'slug',normalized_slug,'lockVersion',1);
end $$;

create function api.partner_campaign_workspace(actor_user_id uuid,candidate_campaign_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare organization_id_value uuid; result jsonb;
begin
  perform app_private.assert_service_role();
  select organization_id into organization_id_value from app_private.campaigns where id=candidate_campaign_id;
  perform app_private.assert_org_viewer(actor_user_id,organization_id_value);
  select jsonb_build_object(
    'campaign',jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug,'status',c.status,
      'organizationId',c.organization_id,'organizationName',o.name,'organizationSlug',o.slug,
      'charityId',ch.id,'charityName',ch.canonical_name,'charityPledgeId',ch.pledge_id,
      'activeRevisionId',c.active_revision_id,'phoneGoal',c.phone_goal,'startsAt',c.starts_at,'endsAt',c.ends_at),
    'draft',(select jsonb_build_object('stage',d.stage,'headline',d.headline,'summary',d.summary,'story',d.story,
      'ctaLabel',d.cta_label,'blocks',d.content_blocks,'toolkit',d.toolkit,'heroAssetId',d.hero_asset_id,
      'supportingAssetId',d.supporting_asset_id,'phoneGoal',d.phone_goal,'startsAt',d.starts_at,
      'endsAt',d.ends_at,'timezone',d.timezone,'partnerReady',d.partner_ready,'reviewState',d.review_state,
      'reviewFeedback',d.review_feedback,'lockVersion',d.lock_version,'updatedAt',d.updated_at)
      from app_private.campaign_working_drafts d where d.campaign_id=c.id),
    'revisions',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'version',r.version,'status',r.status,
      'headline',r.headline,'summary',r.summary,'contentHash',r.content_hash,'createdAt',r.created_at,
      'publishedAt',r.published_at) order by r.version desc),'[]'::jsonb)
      from app_private.campaign_revisions r where r.campaign_id=c.id),
    'assets',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'assetKind',a.asset_kind,'mimeType',a.mime_type,
      'altText',a.alt_text,'isDecorative',a.is_decorative,'width',a.width_pixels,'height',a.height_pixels,
      'used',exists(select 1 from app_private.campaign_revisions r where r.hero_asset_id=a.id or r.supporting_asset_id=a.id)
        or exists(select 1 from app_private.campaign_working_drafts d where d.hero_asset_id=a.id or d.supporting_asset_id=a.id),
      'previewUrl','/api/partner/campaign-assets/'||a.id::text) order by a.created_at desc),'[]'::jsonb)
      from app_private.campaign_assets a where a.campaign_id=c.id),
    'reviews',(select coalesce(jsonb_agg(jsonb_build_object('revisionId',r.revision_id,'outcome',r.outcome,
      'feedback',r.feedback,'actorKind',r.actor_kind,'createdAt',r.created_at) order by r.created_at desc),'[]'::jsonb)
      from app_private.campaign_reviews r where r.campaign_id=c.id),
    'metrics',jsonb_build_object(
      'views',(select count(*) from app_private.campaign_events e where e.campaign_id=c.id and e.event_type='view'),
      'donationStarts',(select count(*) from app_private.campaign_events e where e.campaign_id=c.id and e.event_type='donation_started'),
      'submittedDonations',(select count(*) from app_private.donations dn where dn.campaign_id=c.id),
      'phonesPledged',(select count(*) from app_private.donation_devices x join app_private.donations dn on dn.id=x.donation_id where dn.campaign_id=c.id),
      'phonesReceived',(select count(*) from app_private.donation_devices x join app_private.donations dn on dn.id=x.donation_id where dn.campaign_id=c.id and x.receipt_status in ('received','unexpected')),
      'phonesProcessed',(select count(*) from app_private.donation_devices x join app_private.donations dn on dn.id=x.donation_id where dn.campaign_id=c.id and x.processing_status='complete'),
      'completedDonations',(select count(*) from app_private.donations dn where dn.campaign_id=c.id and dn.status='completed'),
      'sources',(select coalesce(jsonb_object_agg(source_category,total),'{}'::jsonb) from (
        select coalesce(source_category,'direct') source_category,count(*) total from app_private.campaign_events
        where campaign_id=c.id group by coalesce(source_category,'direct')) source_rollup)
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
      'policyVersions',(select coalesce(jsonb_agg(distinct jsonb_build_object('id',p.id,'version',p.version,
        'shareBasisPoints',p.share_basis_points,'calculationMethod',p.calculation_method)),'[]'::jsonb)
        from app_private.proceeds_allocations a join app_private.proceeds_policy_versions p on p.id=a.policy_version_id
        join app_private.donations dn on dn.id=a.donation_id where dn.campaign_id=c.id and a.status<>'reversed'),
      'provisional',exists(select 1 from app_private.proceeds_allocations a join app_private.donations dn on dn.id=a.donation_id
        where dn.campaign_id=c.id and a.status in ('policy_hold','calculated')),
      'disbursementStatus',coalesce((select max(ds.status::text) from app_private.disbursements ds
        join app_private.disbursement_preparation_allocations dpa on dpa.preparation_id=ds.preparation_id
        join app_private.proceeds_allocations a on a.id=dpa.allocation_id
        join app_private.donations dn on dn.id=a.donation_id where dn.campaign_id=c.id),'not_prepared')
    ),
    'toolkit',jsonb_build_object('canonicalUrl','/c/'||c.slug,
      'vanityUrl',(select '/'||root_slug from app_private.campaign_route_aliases
        where campaign_id=c.id and status='active' order by created_at desc limit 1),
      'sourceLinks',jsonb_build_object(
        'email','/c/'||c.slug||'?src=email','social','/c/'||c.slug||'?src=social',
        'web','/c/'||c.slug||'?src=web','event','/c/'||c.slug||'?src=event',
        'print','/c/'||c.slug||'?src=print','qr','/c/'||c.slug||'?src=qr'))
  ) into result from app_private.campaigns c join app_private.organizations o on o.id=c.organization_id
  join app_private.charities ch on ch.id=c.charity_id where c.id=candidate_campaign_id;
  return result;
end $$;

create function api.partner_save_campaign_draft(
  actor_user_id uuid,candidate_campaign_id uuid,expected_lock_version integer,stage_value integer,
  campaign_name_value text,headline_value text,summary_value text,story_value text,cta_value text,
  blocks_value jsonb,toolkit_value jsonb,hero_asset_value uuid,supporting_asset_value uuid,
  phone_goal_value integer,starts_at_value timestamptz,ends_at_value timestamptz,timezone_value text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare organization_id_value uuid; next_lock integer;
begin
  perform app_private.assert_service_role();
  select organization_id into organization_id_value from app_private.campaigns where id=candidate_campaign_id for update;
  perform app_private.assert_org_editor(actor_user_id,organization_id_value);
  if not app_private.validate_campaign_blocks_v2(blocks_value) or not app_private.validate_campaign_toolkit(toolkit_value) then
    raise exception 'invalid structured campaign content' using errcode='22023'; end if;
  if hero_asset_value is not null and not exists(select 1 from app_private.campaign_assets where id=hero_asset_value and campaign_id=candidate_campaign_id and asset_kind='hero_image') then
    raise exception 'campaign hero asset required' using errcode='22023'; end if;
  if supporting_asset_value is not null and not exists(select 1 from app_private.campaign_assets where id=supporting_asset_value and campaign_id=candidate_campaign_id and asset_kind='supporting_image') then
    raise exception 'campaign supporting asset required' using errcode='22023'; end if;
  update app_private.campaign_working_drafts set stage=stage_value,headline=trim(headline_value),summary=trim(summary_value),
    story=trim(story_value),cta_label=coalesce(nullif(trim(cta_value),''),'Donate a Phone'),content_blocks=blocks_value,
    toolkit=toolkit_value,hero_asset_id=hero_asset_value,supporting_asset_id=supporting_asset_value,
    phone_goal=phone_goal_value,starts_at=starts_at_value,ends_at=ends_at_value,
    timezone=coalesce(nullif(trim(timezone_value),''),'America/New_York'),partner_ready=false,
    review_state='editing',review_feedback=null,lock_version=lock_version+1,updated_by=actor_user_id,updated_at=now()
    where campaign_id=candidate_campaign_id and lock_version=expected_lock_version returning lock_version into next_lock;
  if next_lock is null then raise exception 'campaign draft conflict' using errcode='40001'; end if;
  update app_private.campaigns set name=trim(campaign_name_value),phone_goal=phone_goal_value,
    starts_at=starts_at_value,ends_at=ends_at_value,timezone=coalesce(nullif(trim(timezone_value),''),'America/New_York'),updated_at=now()
    where id=candidate_campaign_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('partner',actor_user_id::text,'campaign.save_draft','campaign',candidate_campaign_id,
    'guided_builder_autosave',jsonb_build_object('lock_version',next_lock,'stage',stage_value,
      'has_hero',hero_asset_value is not null,'has_supporting_image',supporting_asset_value is not null),
    jsonb_build_object('organization_id',organization_id_value,'content_redacted',true));
  return jsonb_build_object('lockVersion',next_lock,'savedAt',now());
end $$;

create function api.partner_mark_campaign_ready(actor_user_id uuid,candidate_campaign_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare organization_id_value uuid;
begin
  perform app_private.assert_service_role(); select organization_id into organization_id_value from app_private.campaigns where id=candidate_campaign_id;
  perform app_private.assert_org_editor(actor_user_id,organization_id_value);
  update app_private.campaign_working_drafts set partner_ready=true,review_state='partner_review',review_feedback=null,
    lock_version=lock_version+1,updated_by=actor_user_id,updated_at=now()
    where campaign_id=candidate_campaign_id and stage=7 and char_length(trim(headline))>0
      and char_length(trim(summary))>0 and char_length(trim(story))>0;
  if not found then raise exception 'complete campaign draft required' using errcode='22023'; end if;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('partner',actor_user_id::text,'campaign.mark_partner_ready','campaign',candidate_campaign_id,
    'editor_completed_draft',jsonb_build_object('review_state','partner_review'),
    jsonb_build_object('organization_id',organization_id_value));
  return jsonb_build_object('reviewState','partner_review');
end $$;

create function api.partner_submit_campaign_review(actor_user_id uuid,candidate_campaign_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare organization_id_value uuid; draft_row app_private.campaign_working_drafts%rowtype;
  next_version integer; revision_id_value uuid; hero_sha text; supporting_sha text; item jsonb; item_order integer:=0;
  canonical_hash text;
begin
  perform app_private.assert_service_role();
  select organization_id into organization_id_value from app_private.campaigns where id=candidate_campaign_id for update;
  perform app_private.assert_org_admin(actor_user_id,organization_id_value);
  select * into draft_row from app_private.campaign_working_drafts where campaign_id=candidate_campaign_id for update;
  if not draft_row.partner_ready or draft_row.review_state<>'partner_review' then
    raise exception 'partner-reviewed campaign draft required' using errcode='22023'; end if;
  if char_length(trim(draft_row.headline))=0 or char_length(trim(draft_row.summary))=0 or char_length(trim(draft_row.story))=0 then
    raise exception 'complete campaign content required' using errcode='22023'; end if;
  select content_sha256 into hero_sha from app_private.campaign_assets where id=draft_row.hero_asset_id and campaign_id=candidate_campaign_id;
  select content_sha256 into supporting_sha from app_private.campaign_assets where id=draft_row.supporting_asset_id and campaign_id=candidate_campaign_id;
  canonical_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'headline',draft_row.headline,'summary',draft_row.summary,'story',draft_row.story,'ctaLabel',draft_row.cta_label,
    'heroAssetId',draft_row.hero_asset_id,'heroAssetSha256',hero_sha,
    'supportingAssetId',draft_row.supporting_asset_id,'supportingAssetSha256',supporting_sha,
    'blocks',draft_row.content_blocks,'phoneGoal',draft_row.phone_goal,'startsAt',draft_row.starts_at,
    'endsAt',draft_row.ends_at,'timezone',draft_row.timezone,'toolkit',draft_row.toolkit)::text,'utf8'),'sha256'),'hex');
  select coalesce(max(version),0)+1 into next_version from app_private.campaign_revisions where campaign_id=candidate_campaign_id;
  insert into app_private.campaign_revisions(campaign_id,version,status,headline,summary,story,cta_label,
    hero_asset_id,supporting_asset_id,hero_asset_sha256,supporting_asset_sha256,content_blocks,
    phone_goal,starts_at,ends_at,timezone,toolkit,content_hash,requested_by)
  values(candidate_campaign_id,next_version,'staff_review',draft_row.headline,draft_row.summary,draft_row.story,
    draft_row.cta_label,draft_row.hero_asset_id,draft_row.supporting_asset_id,hero_sha,supporting_sha,
    draft_row.content_blocks,draft_row.phone_goal,draft_row.starts_at,draft_row.ends_at,draft_row.timezone,
    draft_row.toolkit,canonical_hash,actor_user_id) returning id into revision_id_value;
  for item in select value from jsonb_array_elements(draft_row.content_blocks) loop
    insert into app_private.campaign_revision_blocks(revision_id,block_order,block_type,content)
    values(revision_id_value,item_order,item->>'type',item->'content'); item_order:=item_order+1;
  end loop;
  update app_private.campaign_working_drafts set review_state='staff_review',review_feedback=null,
    lock_version=lock_version+1,updated_at=now() where campaign_id=candidate_campaign_id;
  insert into app_private.campaign_reviews(campaign_id,revision_id,outcome,actor_kind,actor_user_id)
  values(candidate_campaign_id,revision_id_value,'requested','partner',actor_user_id);
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('partner',actor_user_id::text,'campaign.request_staff_review','campaign_revision',revision_id_value,
    'partner_admin_approved_exact_revision',jsonb_build_object('version',next_version,'content_hash',canonical_hash),
    jsonb_build_object('campaign_id',candidate_campaign_id,'organization_id',organization_id_value));
  return jsonb_build_object('revisionId',revision_id_value,'version',next_version,'status','staff_review');
end $$;

create function api.partner_restore_campaign_revision(actor_user_id uuid,candidate_campaign_id uuid,candidate_revision_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare organization_id_value uuid; next_lock integer;
begin
  perform app_private.assert_service_role(); select organization_id into organization_id_value from app_private.campaigns where id=candidate_campaign_id;
  perform app_private.assert_org_editor(actor_user_id,organization_id_value);
  update app_private.campaign_working_drafts d set headline=r.headline,summary=r.summary,story=r.story,cta_label=r.cta_label,
    content_blocks=r.content_blocks,toolkit=r.toolkit,hero_asset_id=r.hero_asset_id,supporting_asset_id=r.supporting_asset_id,
    phone_goal=r.phone_goal,starts_at=r.starts_at,ends_at=r.ends_at,timezone=r.timezone,partner_ready=false,
    review_state='editing',review_feedback=null,lock_version=d.lock_version+1,updated_by=actor_user_id,updated_at=now()
  from app_private.campaign_revisions r where d.campaign_id=candidate_campaign_id and r.id=candidate_revision_id
    and r.campaign_id=candidate_campaign_id returning d.lock_version into next_lock;
  if next_lock is null then raise exception 'restorable revision required' using errcode='22023'; end if;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('partner',actor_user_id::text,'campaign.restore_revision','campaign',candidate_campaign_id,
    'explicit_revision_restore',jsonb_build_object('source_revision_id',candidate_revision_id,'lock_version',next_lock),
    jsonb_build_object('organization_id',organization_id_value));
  return jsonb_build_object('lockVersion',next_lock,'restoredFromRevisionId',candidate_revision_id);
end $$;

create function api.partner_register_campaign_asset(actor_user_id uuid,candidate_campaign_id uuid,
  asset_kind_value text,storage_path_value text,mime_type_value text,byte_size_value integer,
  width_value integer,height_value integer,alt_text_value text,decorative_value boolean,content_sha256_value text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare organization_id_value uuid; asset_id_value uuid;
begin
  perform app_private.assert_service_role(); select organization_id into organization_id_value from app_private.campaigns where id=candidate_campaign_id;
  perform app_private.assert_org_editor(actor_user_id,organization_id_value);
  if storage_path_value !~ ('^campaigns/'||candidate_campaign_id::text||'/[0-9a-f-]{36}[.](jpg|jpeg|png|webp)$') then
    raise exception 'controlled campaign asset path required' using errcode='22023'; end if;
  insert into app_private.campaign_assets(campaign_id,asset_kind,storage_path,mime_type,byte_size,alt_text,
    uploaded_by,content_sha256,is_decorative,storage_format_version,width_pixels,height_pixels,metadata_scrubbed)
  values(candidate_campaign_id,asset_kind_value,storage_path_value,mime_type_value,byte_size_value,
    coalesce(trim(alt_text_value),''),actor_user_id,content_sha256_value,decorative_value,2,width_value,height_value,true)
  returning id into asset_id_value;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('partner',actor_user_id::text,'campaign.register_asset','campaign_asset',asset_id_value,
    'sanitized_campaign_media',jsonb_build_object('asset_kind',asset_kind_value,'mime_type',mime_type_value,
      'byte_size',byte_size_value,'width',width_value,'height',height_value,'content_sha256',content_sha256_value),
    jsonb_build_object('campaign_id',candidate_campaign_id,'organization_id',organization_id_value,'metadata_scrubbed',true));
  return jsonb_build_object('id',asset_id_value,'contentSha256',content_sha256_value,
    'previewUrl','/api/partner/campaign-assets/'||asset_id_value::text);
end $$;

create function api.partner_delete_unused_campaign_asset(actor_user_id uuid,candidate_campaign_id uuid,candidate_asset_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare organization_id_value uuid; storage_path_value text;
begin
  perform app_private.assert_service_role(); select organization_id into organization_id_value from app_private.campaigns where id=candidate_campaign_id;
  perform app_private.assert_org_editor(actor_user_id,organization_id_value);
  delete from app_private.campaign_assets where id=candidate_asset_id and campaign_id=candidate_campaign_id
    and not exists(select 1 from app_private.campaign_revisions r where r.hero_asset_id=candidate_asset_id or r.supporting_asset_id=candidate_asset_id)
    and not exists(select 1 from app_private.campaign_working_drafts d where d.hero_asset_id=candidate_asset_id or d.supporting_asset_id=candidate_asset_id)
  returning storage_path into storage_path_value;
  if storage_path_value is null then raise exception 'only unused campaign assets may be deleted' using errcode='23503'; end if;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('partner',actor_user_id::text,'campaign.delete_asset','campaign_asset',candidate_asset_id,
    'unused_campaign_media_removed',jsonb_build_object('removed',true),
    jsonb_build_object('campaign_id',candidate_campaign_id,'organization_id',organization_id_value));
  return jsonb_build_object('storagePath',storage_path_value);
end $$;

create function api.partner_campaign_asset(actor_user_id uuid,candidate_asset_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare result jsonb; organization_id_value uuid;
begin
  perform app_private.assert_service_role();
  select c.organization_id into organization_id_value from app_private.campaign_assets a
    join app_private.campaigns c on c.id=a.campaign_id where a.id=candidate_asset_id;
  perform app_private.assert_org_viewer(actor_user_id,organization_id_value);
  select jsonb_build_object('id',id,'storagePath',storage_path,'mimeType',mime_type,'contentSha256',content_sha256)
  into result from app_private.campaign_assets where id=candidate_asset_id;
  return result;
end $$;

create function api.staff_review_campaign_revision(actor_user_id uuid,candidate_campaign_id uuid,
  candidate_revision_id uuid,outcome_value app_private.review_outcome,feedback_value text default null)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_admin(actor_user_id);
  if outcome_value not in ('approved','changes_requested') then raise exception 'invalid campaign review outcome' using errcode='22023'; end if;
  update app_private.campaign_revisions set status=case when outcome_value='approved'
      then 'approved'::app_private.campaign_revision_status else 'rejected'::app_private.campaign_revision_status end,
    approved_by=case when outcome_value='approved' then actor_user_id else null end
    where id=candidate_revision_id and campaign_id=candidate_campaign_id and status='staff_review';
  if not found then raise exception 'reviewable exact campaign revision required' using errcode='22023'; end if;
  update app_private.campaign_working_drafts set review_state=case when outcome_value='approved' then 'staff_review' else 'changes_requested' end,
    review_feedback=nullif(trim(feedback_value),'') where campaign_id=candidate_campaign_id;
  insert into app_private.campaign_reviews(campaign_id,revision_id,outcome,feedback,actor_kind,actor_user_id)
  values(candidate_campaign_id,candidate_revision_id,outcome_value,nullif(trim(feedback_value),''),'staff',actor_user_id);
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'campaign.review_revision','campaign_revision',candidate_revision_id,
    'staff_exact_revision_review',jsonb_build_object('outcome',outcome_value),
    jsonb_build_object('campaign_id',candidate_campaign_id,'feedback_recorded',nullif(trim(feedback_value),'') is not null));
  return jsonb_build_object('revisionId',candidate_revision_id,'outcome',outcome_value);
end $$;

create or replace function api.staff_publish_campaign_revision(actor_user_id uuid,candidate_campaign_id uuid,candidate_revision_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare old_revision uuid; revision_row app_private.campaign_revisions%rowtype; next_status app_private.campaign_status;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_admin(actor_user_id);
  select * into revision_row from app_private.campaign_revisions r where r.id=candidate_revision_id
    and r.campaign_id=candidate_campaign_id and r.status in ('draft','staff_review','approved') for update;
  if not found then raise exception 'reviewable exact campaign revision required' using errcode='22023'; end if;
  if revision_row.status in ('draft','staff_review') then
    update app_private.campaign_revisions set status='approved',approved_by=actor_user_id
      where id=candidate_revision_id and campaign_id=candidate_campaign_id;
    insert into app_private.campaign_reviews(campaign_id,revision_id,outcome,actor_kind,actor_user_id)
    values(candidate_campaign_id,candidate_revision_id,'approved','staff',actor_user_id);
  end if;
  if revision_row.ends_at is not null and revision_row.ends_at<=now() then
    raise exception 'cannot publish an already ended campaign window' using errcode='22023'; end if;
  if (revision_row.hero_asset_id is not null and not exists(select 1 from app_private.campaign_assets a where a.id=revision_row.hero_asset_id and a.campaign_id=candidate_campaign_id and a.content_sha256=revision_row.hero_asset_sha256 and a.metadata_scrubbed))
    or (revision_row.supporting_asset_id is not null and not exists(select 1 from app_private.campaign_assets a where a.id=revision_row.supporting_asset_id and a.campaign_id=candidate_campaign_id and a.content_sha256=revision_row.supporting_asset_sha256 and a.metadata_scrubbed)) then
    raise exception 'verified revision assets required' using errcode='22023'; end if;
  select active_revision_id into old_revision from app_private.campaigns where id=candidate_campaign_id for update;
  update app_private.campaign_revisions set status='superseded' where id=old_revision and status='published';
  update app_private.campaign_revisions set status='published',approved_by=coalesce(approved_by,actor_user_id),
    published_by=actor_user_id,published_at=now() where id=candidate_revision_id;
  next_status:=case when revision_row.starts_at is not null and revision_row.starts_at>now()
    then 'scheduled'::app_private.campaign_status else 'published'::app_private.campaign_status end;
  update app_private.campaigns set active_revision_id=candidate_revision_id,status=next_status,
    phone_goal=revision_row.phone_goal,starts_at=revision_row.starts_at,ends_at=revision_row.ends_at,
    timezone=revision_row.timezone,review_feedback=null,updated_at=now() where id=candidate_campaign_id;
  update app_private.campaign_working_drafts set review_state='editing',partner_ready=false,review_feedback=null where campaign_id=candidate_campaign_id;
  insert into app_private.campaign_reviews(campaign_id,revision_id,outcome,actor_kind,actor_user_id)
  values(candidate_campaign_id,candidate_revision_id,case when next_status='scheduled'
    then 'scheduled'::app_private.review_outcome else 'published'::app_private.review_outcome end,'staff',actor_user_id);
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'campaign.publish_revision','campaign',candidate_campaign_id,'staff_exact_revision_publication',
    jsonb_build_object('from_revision',old_revision,'to_revision',candidate_revision_id,'status',next_status),
    jsonb_build_object('verified_assets',true));
  return jsonb_build_object('ok',true,'slug',(select slug from app_private.campaigns where id=candidate_campaign_id),'status',next_status);
end $$;

create function api.staff_set_campaign_alias(actor_user_id uuid,candidate_campaign_id uuid,alias_slug_value text,
  behavior_value app_private.campaign_alias_behavior default 'redirect')
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare normalized text:=lower(trim(both '/' from alias_slug_value)); alias_id_value uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_admin(actor_user_id);
  if normalized in (select slug from app_private.reserved_route_slugs)
    or exists(select 1 from app_private.campaigns where slug=normalized)
    or exists(select 1 from app_private.campaign_route_aliases where root_slug=normalized and status='active') then
    raise exception 'vanity alias unavailable' using errcode='23505'; end if;
  insert into app_private.campaign_route_aliases(root_slug,campaign_id,canonical_slug,behavior,status,created_by)
  select normalized,c.id,c.slug,behavior_value,'active',actor_user_id from app_private.campaigns c where c.id=candidate_campaign_id
  returning id into alias_id_value;
  if alias_id_value is null then raise exception 'campaign not found' using errcode='22023'; end if;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'campaign.set_vanity_alias','campaign_route_alias',alias_id_value,
    'staff_approved_marketing_route',jsonb_build_object('root_slug',normalized,'behavior',behavior_value),
    jsonb_build_object('campaign_id',candidate_campaign_id));
  return jsonb_build_object('aliasId',alias_id_value,'path','/'||normalized,'behavior',behavior_value);
end $$;

create function api.record_campaign_event(campaign_slug text,event_type_value text,event_key_value text,source_value text default null)
returns boolean language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare campaign_id_value uuid; normalized_source text:=coalesce(lower(trim(source_value)),'direct');
begin
  perform app_private.assert_service_role();
  if event_type_value not in ('view','donation_started') or event_key_value !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid public campaign event' using errcode='22023'; end if;
  if normalized_source='' or normalized_source not in ('email','social','web','event','print','qr','direct') then normalized_source:='direct'; end if;
  select id into campaign_id_value from app_private.campaigns where slug=lower(trim(campaign_slug))
    and active_revision_id is not null and status in ('scheduled','published','ended');
  if campaign_id_value is null then return false; end if;
  insert into app_private.campaign_events(campaign_id,event_type,event_key,source_category)
  values(campaign_id_value,event_type_value,event_key_value,normalized_source) on conflict do nothing;
  return true;
end $$;

create or replace function api.get_public_campaign(campaign_slug text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object('id',c.id,'slug',c.slug,'name',c.name,'status',c.status,
    'organization',jsonb_build_object('name',o.name,'slug',o.slug,'profileUrl',case when o.active_profile_revision_id is null then null else '/nonprofits/'||o.slug end),
    'charityPledgeId',ch.pledge_id,'charityName',ch.canonical_name,'headline',r.headline,'summary',r.summary,
    'story',r.story,'ctaLabel',r.cta_label,'blocks',r.content_blocks,'heroAssetId',r.hero_asset_id,
    'heroImageUrl',case when r.hero_asset_id is null then null else '/api/campaign-assets/'||r.hero_asset_id::text end,
    'heroAltText',(select alt_text from app_private.campaign_assets where id=r.hero_asset_id),
    'heroDecorative',coalesce((select is_decorative from app_private.campaign_assets where id=r.hero_asset_id),false),
    'supportingAssetId',r.supporting_asset_id,'supportingImageUrl',case when r.supporting_asset_id is null then null else '/api/campaign-assets/'||r.supporting_asset_id::text end,
    'supportingAltText',(select alt_text from app_private.campaign_assets where id=r.supporting_asset_id),
    'supportingDecorative',coalesce((select is_decorative from app_private.campaign_assets where id=r.supporting_asset_id),false),
    'phoneGoal',r.phone_goal,'startsAt',r.starts_at,'endsAt',r.ends_at,'timezone',r.timezone,
    'phonesReceived',(select count(*) from app_private.donation_devices x join app_private.donations dn on dn.id=x.donation_id
      where dn.campaign_id=c.id and x.receipt_status in ('received','unexpected')),
    'canDonate',c.status='published' and (c.starts_at is null or c.starts_at<=now()) and (c.ends_at is null or c.ends_at>now()),
    'revision',r.version,'contentHash',r.content_hash,'publishedAt',r.published_at)
  into result from app_private.campaigns c join app_private.organizations o on o.id=c.organization_id
  join app_private.charities ch on ch.id=c.charity_id join app_private.organization_charities oc on oc.organization_id=o.id and oc.charity_id=ch.id
  join app_private.campaign_revisions r on r.id=c.active_revision_id
  where c.slug=lower(trim(campaign_slug)) and c.status in ('scheduled','published','ended') and r.status='published'
    and o.status='active' and ch.status='verified' and oc.status='verified';
  return result;
end $$;

create function api.get_public_campaigns()
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
begin
  perform app_private.assert_service_role();
  return coalesce((select jsonb_agg(jsonb_build_object('slug',c.slug,'name',c.name,'status',c.status,
    'publishedAt',r.published_at,'updatedAt',c.updated_at)) from app_private.campaigns c
    join app_private.campaign_revisions r on r.id=c.active_revision_id
    where c.status in ('scheduled','published','ended') and r.status='published'),'[]'::jsonb);
end $$;

create or replace function api.get_public_campaign_asset(candidate_asset_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object('id',a.id,'storagePath',a.storage_path,'mimeType',a.mime_type,'altText',a.alt_text,
    'contentSha256',a.content_sha256) into result from app_private.campaign_assets a
  join app_private.campaign_revisions r on r.status='published' and (r.hero_asset_id=a.id or r.supporting_asset_id=a.id)
    and ((r.hero_asset_id=a.id and r.hero_asset_sha256=a.content_sha256) or (r.supporting_asset_id=a.id and r.supporting_asset_sha256=a.content_sha256))
  join app_private.campaigns c on c.id=r.campaign_id and c.active_revision_id=r.id and c.status in ('scheduled','published','ended')
  where a.id=candidate_asset_id and a.metadata_scrubbed;
  return result;
end $$;

create or replace function api.is_invited_partner_email(candidate_email text)
returns boolean language plpgsql security definer
set search_path=pg_catalog,app_private as $$
begin
  perform app_private.assert_service_role();
  return exists(select 1 from app_private.partner_invitations i join app_private.organizations o on o.id=i.organization_id
    where i.email_search=lower(trim(candidate_email)) and i.status='invited' and i.revoked_at is null
      and i.expires_at>now() and not i.accepted_once and o.status='active');
end $$;

create or replace function api.activate_partner_invitations(actor_user_id uuid,verified_email text)
returns integer language plpgsql security definer
set search_path=pg_catalog,app_private,auth as $$
declare invite app_private.partner_invitations%rowtype; activated integer:=0; auth_email text;
begin
  perform app_private.assert_service_role();
  select lower(email) into auth_email from auth.users where id=actor_user_id and email_confirmed_at is not null;
  if auth_email is null or auth_email<>lower(trim(verified_email)) then raise exception 'verified partner identity required' using errcode='42501'; end if;
  insert into app_private.profiles(user_id) values(actor_user_id) on conflict do nothing;
  for invite in select * from app_private.partner_invitations where email_search=auth_email and status='invited'
    and revoked_at is null and expires_at>now() and not accepted_once for update loop
    if exists(select 1 from app_private.organizations where id=invite.organization_id and status='active') then
      insert into app_private.organization_memberships(organization_id,user_id,role,status,invited_by,activated_at)
      values(invite.organization_id,actor_user_id,invite.role,'active',invite.invited_by,now())
      on conflict(organization_id,user_id) do update set role=excluded.role,status='active',activated_at=now(),updated_at=now();
      update app_private.partner_invitations set status='active',activated_by=actor_user_id,activated_at=now(),accepted_once=true where id=invite.id;
      insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
      values('partner',actor_user_id::text,'partner.accept_invitation','organization',invite.organization_id,'verified_one_time_passwordless_acceptance',
        jsonb_build_object('role',app_private.normalized_partner_role(invite.role)),jsonb_build_object('invitation_id',invite.id));
      activated:=activated+1;
    end if;
  end loop;
  return activated;
end $$;

create function api.advance_campaign_lifecycles()
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare started integer; ended integer;
begin
  perform app_private.assert_service_role();
  update app_private.campaigns set status='published',updated_at=now()
    where status='scheduled' and starts_at is not null and starts_at<=now(); get diagnostics started=row_count;
  update app_private.campaigns set status='ended',updated_at=now()
    where status='published' and ends_at is not null and ends_at<=now(); get diagnostics ended=row_count;
  return jsonb_build_object('started',started,'ended',ended);
end $$;

create function api.staff_partner_review_queue(actor_user_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  return jsonb_build_object(
    'applications',api.staff_partner_application_queue(actor_user_id)->'applications',
    'profiles',coalesce((select jsonb_agg(jsonb_build_object('organizationId',o.id,'organizationName',o.name,
      'organizationSlug',o.slug,'revisionId',r.id,'version',r.version,'status',r.status,'mission',r.mission,
      'summary',r.summary,'websiteUrl',r.website_url,'location',concat_ws(', ',r.locality,r.region,r.country_code),
      'contentHash',r.content_hash,'createdAt',r.created_at) order by r.created_at)
      from app_private.organization_profile_revisions r join app_private.organizations o on o.id=r.organization_id
      where r.status in ('staff_review','approved')),'[]'::jsonb),
    'campaigns',coalesce((select jsonb_agg(jsonb_build_object('campaignId',c.id,'campaignName',c.name,
      'organizationName',o.name,'revisionId',r.id,'version',r.version,'status',r.status,'headline',r.headline,
      'summary',r.summary,'contentHash',r.content_hash,'createdAt',r.created_at) order by r.created_at)
      from app_private.campaign_revisions r join app_private.campaigns c on c.id=r.campaign_id
      join app_private.organizations o on o.id=c.organization_id where r.status in ('staff_review','approved')),'[]'::jsonb)
  );
end $$;

-- Exact immutable profile review surface, including a field-level comparison with
-- the currently published revision. Staff never reviews a mutable draft.
create function api.staff_profile_revision_preview(actor_user_id uuid,candidate_organization_id uuid,
  candidate_revision_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select jsonb_build_object(
    'organization',jsonb_build_object('id',o.id,'name',o.name,'slug',o.slug),
    'revision',jsonb_build_object('id',r.id,'version',r.version,'status',r.status,'mission',r.mission,
      'summary',r.summary,'websiteUrl',r.website_url,'locality',r.locality,'region',r.region,
      'countryCode',r.country_code,'contentHash',r.content_hash,
      'logoAsset',case when la.id is null then null else jsonb_build_object('id',la.id,'imageUrl','/api/staff/organization-assets/'||la.id::text,
        'altText',la.alt_text,'isDecorative',la.is_decorative,'contentSha256',la.content_sha256) end,
      'heroAsset',case when ha.id is null then null else jsonb_build_object('id',ha.id,'imageUrl','/api/staff/organization-assets/'||ha.id::text,
        'altText',ha.alt_text,'isDecorative',ha.is_decorative,'contentSha256',ha.content_sha256) end),
    'publishedRevisionId',o.active_profile_revision_id,
    'differsFromPublished',o.active_profile_revision_id is distinct from r.id,
    'changedFields',case when published.id is null then jsonb_build_array('initial publication') else
      (select coalesce(jsonb_agg(field_name order by field_name),'[]'::jsonb) from (values
        ('mission',published.mission is distinct from r.mission),
        ('summary',published.summary is distinct from r.summary),
        ('website',published.website_url is distinct from r.website_url),
        ('location',row(published.locality,published.region,published.country_code) is distinct from row(r.locality,r.region,r.country_code)),
        ('logo',row(published.logo_asset_id,published.logo_asset_sha256) is distinct from row(r.logo_asset_id,r.logo_asset_sha256)),
        ('hero image',row(published.hero_asset_id,published.hero_asset_sha256) is distinct from row(r.hero_asset_id,r.hero_asset_sha256))
      ) changes(field_name,is_changed) where is_changed) end,
    'publishedRevision',case when published.id is null then null else jsonb_build_object(
      'id',published.id,'version',published.version,'mission',published.mission,'summary',published.summary,
      'websiteUrl',published.website_url,'locality',published.locality,'region',published.region,
      'countryCode',published.country_code,'contentHash',published.content_hash) end
  ) into result
  from app_private.organizations o
  join app_private.organization_profile_revisions r on r.organization_id=o.id
  left join app_private.organization_profile_revisions published on published.id=o.active_profile_revision_id
  left join app_private.organization_assets la on la.id=r.logo_asset_id
  left join app_private.organization_assets ha on ha.id=r.hero_asset_id
  where o.id=candidate_organization_id and r.id=candidate_revision_id
    and r.status in ('staff_review','approved','published','superseded');
  if result is null then raise exception 'profile revision not found' using errcode='42501'; end if;
  return result;
end $$;

create function api.staff_organization_profile_revision_asset(actor_user_id uuid,candidate_asset_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select jsonb_build_object('id',a.id,'storagePath',a.storage_path,'mimeType',a.mime_type,
    'contentSha256',a.content_sha256) into result
  from app_private.organization_assets a
  join app_private.organization_profile_revisions r on a.id in (r.logo_asset_id,r.hero_asset_id)
  where a.id=candidate_asset_id;
  if result is null then raise exception 'organization profile asset not found' using errcode='42501'; end if;
  return result;
end $$;

-- Enrich the established exact campaign preview with the published baseline and
-- a bounded list of changed fields. Asset responses remain digest-verified by the Worker.
create or replace function api.staff_campaign_revision_preview(actor_user_id uuid,candidate_campaign_id uuid,candidate_revision_id uuid)
returns jsonb language plpgsql security definer volatile
set search_path=pg_catalog,app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select jsonb_build_object(
    'campaign',jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug,'status',c.status),
    'organization',jsonb_build_object('id',o.id,'name',o.name),
    'charity',jsonb_build_object('id',ch.id,'pledgeId',ch.pledge_id,'name',ch.canonical_name,'ein',ch.ein,'status',ch.status),
    'revision',jsonb_build_object('id',r.id,'version',r.version,'status',r.status,'headline',r.headline,
      'summary',r.summary,'story',r.story,'ctaLabel',r.cta_label,'phoneGoal',r.phone_goal,
      'startsAt',r.starts_at,'endsAt',r.ends_at,'timezone',r.timezone,'toolkit',r.toolkit,
      'heroAsset',case when ha.id is null then null else jsonb_build_object('id',ha.id,'storagePath',ha.storage_path,
        'mimeType',ha.mime_type,'altText',ha.alt_text,'isDecorative',ha.is_decorative,
        'contentSha256',ha.content_sha256,'imageUrl','/api/staff/campaign-assets/'||ha.id::text) end,
      'supportingAsset',case when sa.id is null then null else jsonb_build_object('id',sa.id,'storagePath',sa.storage_path,
        'mimeType',sa.mime_type,'altText',sa.alt_text,'isDecorative',sa.is_decorative,
        'contentSha256',sa.content_sha256,'imageUrl','/api/staff/campaign-assets/'||sa.id::text) end,
      'blocks',r.content_blocks,'contentHash',r.content_hash),
    'publishedRevisionId',c.active_revision_id,'differsFromPublished',c.active_revision_id is distinct from r.id,
    'changedFields',case when published.id is null then jsonb_build_array('initial publication') else
      (select coalesce(jsonb_agg(field_name order by field_name),'[]'::jsonb) from (values
        ('headline',published.headline is distinct from r.headline),('summary',published.summary is distinct from r.summary),
        ('story',published.story is distinct from r.story),('call to action',published.cta_label is distinct from r.cta_label),
        ('content blocks',published.content_blocks is distinct from r.content_blocks),
        ('phone goal',published.phone_goal is distinct from r.phone_goal),
        ('campaign dates',row(published.starts_at,published.ends_at,published.timezone) is distinct from row(r.starts_at,r.ends_at,r.timezone)),
        ('promotion toolkit',published.toolkit is distinct from r.toolkit),
        ('hero image',row(published.hero_asset_id,published.hero_asset_sha256) is distinct from row(r.hero_asset_id,r.hero_asset_sha256)),
        ('supporting image',row(published.supporting_asset_id,published.supporting_asset_sha256) is distinct from row(r.supporting_asset_id,r.supporting_asset_sha256))
      ) changes(field_name,is_changed) where is_changed) end,
    'publishedRevision',case when published.id is null then null else jsonb_build_object('id',published.id,
      'version',published.version,'headline',published.headline,'summary',published.summary,'story',published.story,
      'ctaLabel',published.cta_label,'phoneGoal',published.phone_goal,'startsAt',published.starts_at,
      'endsAt',published.ends_at,'timezone',published.timezone,'toolkit',published.toolkit,
      'blocks',published.content_blocks,'contentHash',published.content_hash) end
  ) into result
  from app_private.campaigns c join app_private.organizations o on o.id=c.organization_id
  join app_private.charities ch on ch.id=c.charity_id join app_private.campaign_revisions r on r.campaign_id=c.id
  left join app_private.campaign_revisions published on published.id=c.active_revision_id
  left join app_private.campaign_assets ha on ha.id=r.hero_asset_id
  left join app_private.campaign_assets sa on sa.id=r.supporting_asset_id
  where c.id=candidate_campaign_id and r.id=candidate_revision_id
    and r.status in ('draft','staff_review','approved','published','superseded');
  if result is null then raise exception 'campaign revision not found' using errcode='42501'; end if;
  return result;
end $$;

revoke execute on all functions in schema api from public,anon,authenticated;
grant execute on function api.partner_campaign_slug_available(uuid,uuid,text),
  api.partner_create_campaign_v2(uuid,uuid,uuid,text,text,text,text,text,text,integer,timestamptz,timestamptz,text,jsonb,jsonb),
  api.partner_campaign_workspace(uuid,uuid),
  api.partner_save_campaign_draft(uuid,uuid,integer,integer,text,text,text,text,text,jsonb,jsonb,uuid,uuid,integer,timestamptz,timestamptz,text),
  api.partner_mark_campaign_ready(uuid,uuid),api.partner_submit_campaign_review(uuid,uuid),
  api.partner_restore_campaign_revision(uuid,uuid,uuid),
  api.partner_register_campaign_asset(uuid,uuid,text,text,text,integer,integer,integer,text,boolean,text),
  api.partner_delete_unused_campaign_asset(uuid,uuid,uuid),api.partner_campaign_asset(uuid,uuid),
  api.staff_review_campaign_revision(uuid,uuid,uuid,app_private.review_outcome,text),
  api.staff_publish_campaign_revision(uuid,uuid,uuid),
  api.staff_set_campaign_alias(uuid,uuid,text,app_private.campaign_alias_behavior),
  api.record_campaign_event(text,text,text,text),api.get_public_campaign(text),api.get_public_campaigns(),
  api.get_public_campaign_asset(uuid),api.is_invited_partner_email(text),api.activate_partner_invitations(uuid,text),
  api.advance_campaign_lifecycles(),api.staff_partner_review_queue(uuid),
  api.staff_profile_revision_preview(uuid,uuid,uuid),api.staff_organization_profile_revision_asset(uuid,uuid)
to service_role;
