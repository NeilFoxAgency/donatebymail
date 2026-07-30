-- Give partners a second, optional image slot for the campaign story. The
-- asset remains private and can only be served when a published revision
-- explicitly references it. This keeps the public mini-funnel customizable
-- without allowing arbitrary HTML or unreviewed uploads.
alter table app_private.campaign_revisions
  add column if not exists supporting_asset_id uuid references app_private.campaign_assets(id) on delete restrict;

create index if not exists campaign_revisions_supporting_asset_id_idx
  on app_private.campaign_revisions (supporting_asset_id);

drop function if exists api.partner_create_campaign_revision(uuid,uuid,text,text,text,text,uuid,text);
create function api.partner_create_campaign_revision(
  actor_user_id uuid,
  candidate_campaign_id uuid,
  headline_value text,
  summary_value text,
  story_value text,
  cta_value text,
  hero_asset_value uuid,
  supporting_asset_value uuid,
  content_hash_value text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, app_private
as $$
declare org_id uuid; next_version integer; revision_id uuid;
begin
  perform app_private.assert_service_role();
  select c.organization_id into org_id
    from app_private.campaigns c
    join app_private.organizations o on o.id=c.organization_id
    where c.id=candidate_campaign_id and o.status='active'
    for update of c;
  perform app_private.assert_org_member(actor_user_id,org_id);
  if hero_asset_value is not null and not exists(
    select 1 from app_private.campaign_assets
    where id=hero_asset_value and campaign_id=candidate_campaign_id and asset_kind='hero_image'
  ) then raise exception 'controlled hero asset required' using errcode='22023'; end if;
  if supporting_asset_value is not null and not exists(
    select 1 from app_private.campaign_assets
    where id=supporting_asset_value and campaign_id=candidate_campaign_id and asset_kind='supporting_image'
  ) then raise exception 'controlled supporting asset required' using errcode='22023'; end if;
  select coalesce(max(version),0)+1 into next_version
    from app_private.campaign_revisions where campaign_id=candidate_campaign_id;
  insert into app_private.campaign_revisions(
    campaign_id,version,headline,summary,story,cta_label,hero_asset_id,supporting_asset_id,content_hash,requested_by
  ) values (
    candidate_campaign_id,next_version,trim(headline_value),trim(summary_value),trim(story_value),
    coalesce(nullif(trim(cta_value),''),'Donate a Phone'),hero_asset_value,supporting_asset_value,
    content_hash_value,actor_user_id
  ) returning id into revision_id;
  insert into app_private.audit_events(
    actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata
  ) values (
    'partner',actor_user_id::text,'campaign.update_content','campaign_revision',revision_id,'partner_revision',
    jsonb_build_object('version',next_version,'content_hash',content_hash_value,
      'hero_asset_id',hero_asset_value,'supporting_asset_id',supporting_asset_value),
    jsonb_build_object('campaign_id',candidate_campaign_id)
  );
  return jsonb_build_object('revisionId',revision_id,'version',next_version);
end $$;

-- Preserve the beta API shape used by existing staff/test tooling. Omitting a
-- story image is intentionally equivalent to a null supporting asset.
create function api.partner_create_campaign_revision(
  actor_user_id uuid,candidate_campaign_id uuid,headline_value text,summary_value text,
  story_value text,cta_value text,hero_asset_value uuid,content_hash_value text
) returns jsonb
language sql security definer
set search_path = pg_catalog, app_private
as $$
  select api.partner_create_campaign_revision(
    actor_user_id,candidate_campaign_id,headline_value,summary_value,story_value,cta_value,
    hero_asset_value,null::uuid,content_hash_value
  )
$$;

create or replace function api.staff_publish_campaign_revision(
  actor_user_id uuid,candidate_campaign_id uuid,candidate_revision_id uuid
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare old_revision uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select c.active_revision_id into old_revision
    from app_private.campaigns c
    join app_private.organizations o on o.id=c.organization_id
    join app_private.charities ch on ch.id=c.charity_id
    join app_private.organization_charities oc on oc.organization_id=c.organization_id and oc.charity_id=c.charity_id
    where c.id=candidate_campaign_id and o.status='active' and ch.status='verified' and oc.status='verified'
    for update of c;
  if not found then raise exception 'active verified campaign relationship required' using errcode='42501'; end if;
  if not exists(
    select 1 from app_private.campaign_revisions r
    where r.id=candidate_revision_id and r.campaign_id=candidate_campaign_id and r.status='draft'
      and (r.hero_asset_id is null or exists(select 1 from app_private.campaign_assets a where a.id=r.hero_asset_id and a.campaign_id=candidate_campaign_id and a.asset_kind='hero_image'))
      and (r.supporting_asset_id is null or exists(select 1 from app_private.campaign_assets a where a.id=r.supporting_asset_id and a.campaign_id=candidate_campaign_id and a.asset_kind='supporting_image'))
  ) then raise exception 'publishable controlled revision required' using errcode='22023'; end if;
  update app_private.campaign_revisions set status='superseded' where id=old_revision and status='published';
  update app_private.campaign_revisions set status='published',approved_by=actor_user_id,published_by=actor_user_id,published_at=now()
    where id=candidate_revision_id;
  update app_private.campaigns set active_revision_id=candidate_revision_id,status='published',updated_at=now()
    where id=candidate_campaign_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'campaign.publish_revision','campaign',candidate_campaign_id,'staff_publication',
    jsonb_build_object('from_revision',old_revision,'to_revision',candidate_revision_id),
    jsonb_build_object('verified_relationship',true,'controlled_assets',true));
  return jsonb_build_object('ok',true,'slug',(select slug from app_private.campaigns where id=candidate_campaign_id));
end $$;

create or replace function api.get_public_campaign(campaign_slug text) returns jsonb
language plpgsql security definer stable
set search_path=pg_catalog,app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object(
    'id',c.id,'slug',c.slug,'name',c.name,'charityPledgeId',ch.pledge_id,'charityName',ch.canonical_name,
    'headline',r.headline,'summary',r.summary,'story',r.story,'ctaLabel',r.cta_label,
    'heroAssetId',r.hero_asset_id,'heroImageUrl',case when r.hero_asset_id is null then null else '/api/campaign-assets/'||r.hero_asset_id::text end,
    'supportingAssetId',r.supporting_asset_id,'supportingImageUrl',case when r.supporting_asset_id is null then null else '/api/campaign-assets/'||r.supporting_asset_id::text end,
    'revision',r.version,'contentHash',r.content_hash
  ) into result
  from app_private.campaigns c
  join app_private.organizations o on o.id=c.organization_id
  join app_private.charities ch on ch.id=c.charity_id
  join app_private.organization_charities oc on oc.organization_id=c.organization_id and oc.charity_id=c.charity_id
  join app_private.campaign_revisions r on r.id=c.active_revision_id
  where c.slug=lower(trim(campaign_slug)) and c.status='published' and r.status='published'
    and o.status='active' and ch.status='verified' and oc.status='verified';
  return result;
end $$;

create or replace function api.partner_campaign_detail(actor_user_id uuid,candidate_campaign_id uuid) returns jsonb
language plpgsql security definer stable
set search_path=pg_catalog,app_private as $$
declare result jsonb; org_id uuid;
begin
  perform app_private.assert_service_role();
  select organization_id into org_id from app_private.campaigns where id=candidate_campaign_id;
  perform app_private.assert_org_member(actor_user_id,org_id);
  select jsonb_build_object(
    'id',c.id,'organizationId',c.organization_id,'slug',c.slug,'name',c.name,'status',c.status,
    'charityName',ch.canonical_name,'activeRevisionId',c.active_revision_id,
    'revisions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',r.id,'version',r.version,'status',r.status,'headline',r.headline,'summary',r.summary,'story',r.story,
      'ctaLabel',r.cta_label,'heroAssetId',r.hero_asset_id,'supportingAssetId',r.supporting_asset_id,
      'contentHash',r.content_hash,'createdAt',r.created_at,'publishedAt',r.published_at
    ) order by r.version desc) from app_private.campaign_revisions r where r.campaign_id=c.id),'[]'::jsonb)
  ) into result
  from app_private.campaigns c join app_private.charities ch on ch.id=c.charity_id where c.id=candidate_campaign_id;
  return result;
end $$;

create or replace function api.get_public_campaign_asset(candidate_asset_id uuid)
returns jsonb language plpgsql security definer stable
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object('id',a.id,'storagePath',a.storage_path,'mimeType',a.mime_type,'altText',a.alt_text)
    into result
  from app_private.campaign_assets a
  join app_private.campaigns c on c.id=a.campaign_id
  join app_private.campaign_revisions r on r.id=c.active_revision_id
    and (r.hero_asset_id=a.id or r.supporting_asset_id=a.id)
  join app_private.organizations o on o.id=c.organization_id
  join app_private.charities ch on ch.id=c.charity_id
  join app_private.organization_charities oc on oc.organization_id=c.organization_id and oc.charity_id=c.charity_id
  where a.id=candidate_asset_id and c.status='published' and r.status='published'
    and o.status='active' and ch.status='verified' and oc.status='verified';
  return result;
end $$;

alter function api.get_public_campaign(text) volatile;
alter function api.partner_campaign_detail(uuid,uuid) volatile;
alter function api.get_public_campaign_asset(uuid) volatile;

revoke execute on function api.partner_create_campaign_revision(uuid,uuid,text,text,text,text,uuid,uuid,text)
  from public,anon,authenticated;
revoke execute on function api.partner_create_campaign_revision(uuid,uuid,text,text,text,text,uuid,text)
  from public,anon,authenticated;
grant execute on function api.partner_create_campaign_revision(uuid,uuid,text,text,text,text,uuid,uuid,text) to service_role;
grant execute on function api.partner_create_campaign_revision(uuid,uuid,text,text,text,text,uuid,text) to service_role;
