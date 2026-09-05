-- Production-boundary remediation: minimize partner invitation PII, ensure every
-- public listing and asset rechecks the live verification chain, and journal
-- scheduled lifecycle transitions as immutable domain and audit events.

alter function api.partner_workspace(uuid) rename to partner_workspace_unfiltered;
alter function api.partner_workspace_unfiltered(uuid) set schema app_private;

create function api.partner_workspace(actor_user_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare raw_workspace jsonb; result jsonb;
begin
  perform app_private.assert_service_role();
  raw_workspace:=app_private.partner_workspace_unfiltered(actor_user_id);
  select jsonb_build_object('organizations',coalesce(jsonb_agg(
    case when organization->>'role'='partner_admin' then organization
      else jsonb_set(organization,'{invitations}','[]'::jsonb,true) end
    order by organization->>'name'),'[]'::jsonb)) into result
  from jsonb_array_elements(coalesce(raw_workspace->'organizations','[]'::jsonb)) as items(organization);
  return result;
end $$;

create or replace function api.get_public_campaigns()
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
begin
  perform app_private.assert_service_role();
  return coalesce((select jsonb_agg(jsonb_build_object('slug',c.slug,'name',c.name,'status',c.status,
    'publishedAt',r.published_at,'updatedAt',c.updated_at) order by c.updated_at desc)
    from app_private.campaigns c
    join app_private.campaign_revisions r on r.id=c.active_revision_id and r.status='published'
    join app_private.organizations o on o.id=c.organization_id and o.status='active'
    join app_private.charities ch on ch.id=c.charity_id and ch.status='verified'
    join app_private.organization_charities oc on oc.organization_id=o.id and oc.charity_id=ch.id and oc.status='verified'
    where c.status in ('scheduled','published','ended')),'[]'::jsonb);
end $$;

create or replace function api.get_public_nonprofit(profile_slug text)
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
      from app_private.campaigns c
      join app_private.charities ch on ch.id=c.charity_id and ch.status='verified'
      join app_private.organization_charities oc on oc.organization_id=o.id and oc.charity_id=ch.id and oc.status='verified'
      join app_private.campaign_revisions cr on cr.id=c.active_revision_id and cr.status='published'
      where c.organization_id=o.id and c.status in ('scheduled','published','ended'))
  ) into result from app_private.organizations o
  join app_private.organization_profile_revisions r on r.id=o.active_profile_revision_id
  where o.slug=lower(trim(profile_slug)) and o.status='active' and r.status='published';
  return result;
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
  join app_private.organizations o on o.id=c.organization_id and o.status='active'
  join app_private.charities ch on ch.id=c.charity_id and ch.status='verified'
  join app_private.organization_charities oc on oc.organization_id=o.id and oc.charity_id=ch.id and oc.status='verified'
  where a.id=candidate_asset_id and a.metadata_scrubbed;
  return result;
end $$;

create or replace function api.get_public_nonprofit_asset(candidate_asset_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object('id',a.id,'storagePath',a.storage_path,'mimeType',a.mime_type,'altText',a.alt_text,
    'contentSha256',a.content_sha256) into result from app_private.organization_assets a
  join app_private.organization_profile_revisions r on r.status='published' and (r.logo_asset_id=a.id or r.hero_asset_id=a.id)
    and ((r.logo_asset_id=a.id and r.logo_asset_sha256=a.content_sha256) or (r.hero_asset_id=a.id and r.hero_asset_sha256=a.content_sha256))
  join app_private.organizations o on o.id=r.organization_id and o.active_profile_revision_id=r.id and o.status='active'
  where a.id=candidate_asset_id and a.metadata_scrubbed;
  return result;
end $$;

create or replace function api.advance_campaign_lifecycles()
returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare transitioned record; started integer:=0; ended integer:=0; next_version integer;
begin
  perform app_private.assert_service_role();
  for transitioned in update app_private.campaigns set status='published',updated_at=now()
    where status='scheduled' and starts_at is not null and starts_at<=now() returning id loop
    select coalesce(max(aggregate_version),0)+1 into next_version from app_private.domain_events
      where aggregate_type='campaign' and aggregate_id=transitioned.id;
    insert into app_private.domain_events(event_type,aggregate_type,aggregate_id,aggregate_version,payload)
      values('campaign.lifecycle_started','campaign',transitioned.id,next_version,jsonb_build_object('status','published'));
    insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
      values('system','campaign-lifecycle','campaign.lifecycle_started','campaign',transitioned.id,
        'scheduled_campaign_start',jsonb_build_object('status','published'),jsonb_build_object('automated',true));
    started:=started+1;
  end loop;
  for transitioned in update app_private.campaigns set status='ended',updated_at=now()
    where status='published' and ends_at is not null and ends_at<=now() returning id loop
    select coalesce(max(aggregate_version),0)+1 into next_version from app_private.domain_events
      where aggregate_type='campaign' and aggregate_id=transitioned.id;
    insert into app_private.domain_events(event_type,aggregate_type,aggregate_id,aggregate_version,payload)
      values('campaign.lifecycle_ended','campaign',transitioned.id,next_version,jsonb_build_object('status','ended'));
    insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
      values('system','campaign-lifecycle','campaign.lifecycle_ended','campaign',transitioned.id,
        'scheduled_campaign_end',jsonb_build_object('status','ended'),jsonb_build_object('automated',true));
    ended:=ended+1;
  end loop;
  return jsonb_build_object('started',started,'ended',ended);
end $$;

revoke execute on function app_private.partner_workspace_unfiltered(uuid) from public,anon,authenticated;
revoke execute on function api.partner_workspace(uuid),api.get_public_campaigns(),api.get_public_nonprofit(text),
  api.get_public_campaign_asset(uuid),api.get_public_nonprofit_asset(uuid),api.advance_campaign_lifecycles()
from public,anon,authenticated;
grant execute on function api.partner_workspace(uuid),api.get_public_campaigns(),api.get_public_nonprofit(text),
  api.get_public_campaign_asset(uuid),api.get_public_nonprofit_asset(uuid),api.advance_campaign_lifecycles()
to service_role;
