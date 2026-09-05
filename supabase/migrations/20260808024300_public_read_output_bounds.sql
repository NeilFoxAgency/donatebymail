-- Keep public and donor-authenticated read models bounded as the site grows.
-- These functions retain their existing JSON shapes; only the maximum number
-- of repeated records returned by one call is constrained.

create or replace function api.get_donation_status(candidate_public_id text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object(
    'donationId', d.id, 'publicId', d.public_id, 'status', d.status,
    'charityName', d.selected_charity_name, 'createdAt', d.created_at,
    'receivedAt', d.received_at, 'completedAt', d.completed_at,
    'devices', coalesce((
      select jsonb_agg(item order by created_at)
      from (
        select jsonb_build_object(
          'id', device.id, 'source', device.source,
          'label', trim(concat_ws(' ', coalesce(device.actual_brand, device.donor_brand),
            coalesce(device.actual_model, device.donor_model))),
          'receiptStatus', device.receipt_status,
          'inspectionStatus', device.inspection_status,
          'processingStatus', device.processing_status,
          'dataWipeStatus', device.data_wipe_status
        ) item, device.created_at
        from app_private.donation_devices device
        where device.donation_id = d.id
        order by device.created_at
        limit 20
      ) bounded
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(item order by occurred_at)
      from (
        select jsonb_build_object(
          'status', event.status, 'message', event.public_message,
          'occurredAt', event.occurred_at
        ) item, event.occurred_at
        from app_private.donation_status_events event
        where event.donation_id = d.id and event.donor_visible
        order by event.occurred_at
        limit 100
      ) bounded
    ), '[]'::jsonb)
  ) into result
  from app_private.donations d
  where d.public_id = upper(trim(candidate_public_id));
  return result;
end;
$$;

create or replace function api.get_published_articles()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select coalesce((select jsonb_agg(item order by created_at desc) from (
    select jsonb_build_object(
      'id', a.id, 'slug', a.slug, 'title', r.title, 'excerpt', r.excerpt,
      'authorName', r.author_name, 'publishedAt', r.created_at,
      'seoTitle', r.seo_title, 'seoDescription', r.seo_description
    ) item, r.created_at
    from app_private.articles a
    join app_private.article_revisions r on r.id = a.published_revision_id
    where a.status = 'published'
    order by r.created_at desc
    limit 500
  ) bounded), '[]'::jsonb)
  into result;
  return result;
end;
$$;

create or replace function api.get_public_campaigns()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.assert_service_role();
  return coalesce((select jsonb_agg(item order by updated_at desc) from (
    select jsonb_build_object(
      'slug', c.slug, 'name', c.name, 'status', c.status,
      'publishedAt', r.published_at, 'updatedAt', c.updated_at
    ) item, c.updated_at
    from app_private.campaigns c
    join app_private.campaign_revisions r on r.id = c.active_revision_id and r.status = 'published'
    join app_private.organizations o on o.id = c.organization_id and o.status = 'active'
    join app_private.charities ch on ch.id = c.charity_id and ch.status = 'verified'
    join app_private.organization_charities oc on oc.organization_id = o.id
      and oc.charity_id = ch.id and oc.status = 'verified'
    where c.status in ('scheduled', 'published', 'ended')
    order by c.updated_at desc
    limit 500
  ) bounded), '[]'::jsonb);
end;
$$;

create or replace function api.get_public_nonprofit(profile_slug text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object(
    'id', o.id, 'slug', o.slug, 'name', o.name, 'mission', r.mission, 'summary', r.summary,
    'websiteUrl', r.website_url, 'locality', r.locality, 'region', r.region, 'countryCode', r.country_code,
    'logoImageUrl', case when r.logo_asset_id is null then null else '/api/nonprofit-assets/' || r.logo_asset_id::text end,
    'heroImageUrl', case when r.hero_asset_id is null then null else '/api/nonprofit-assets/' || r.hero_asset_id::text end,
    'logoAltText', (select alt_text from app_private.organization_assets where id = r.logo_asset_id),
    'heroAltText', (select alt_text from app_private.organization_assets where id = r.hero_asset_id),
    'contentHash', r.content_hash, 'publishedAt', r.published_at,
    'primaryCharity', (select jsonb_build_object('name', ch.canonical_name, 'pledgeId', ch.pledge_id, 'ein', ch.ein)
      from app_private.organization_charities oc
      join app_private.charities ch on ch.id = oc.charity_id
      where oc.organization_id = o.id and oc.status = 'verified' and ch.status = 'verified'
      order by oc.verified_at limit 1),
    'campaigns', (select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'slug', c.slug, 'name', c.name, 'status', c.status,
          'startsAt', c.starts_at, 'endsAt', c.ends_at, 'phoneGoal', c.phone_goal
        ) item, c.created_at
        from app_private.campaigns c
        join app_private.charities ch on ch.id = c.charity_id and ch.status = 'verified'
        join app_private.organization_charities oc on oc.organization_id = o.id
          and oc.charity_id = ch.id and oc.status = 'verified'
        join app_private.campaign_revisions cr on cr.id = c.active_revision_id and cr.status = 'published'
        where c.organization_id = o.id and c.status in ('scheduled', 'published', 'ended')
        order by c.created_at desc
        limit 100
      ) bounded)
  ) into result
  from app_private.organizations o
  join app_private.organization_profile_revisions r on r.id = o.active_profile_revision_id
  where o.slug = lower(trim(profile_slug)) and o.status = 'active' and r.status = 'published';
  return result;
end;
$$;

create or replace function api.get_public_nonprofits()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.assert_service_role();
  return coalesce((select jsonb_agg(item order by name) from (
    select jsonb_build_object(
      'slug', o.slug, 'name', o.name, 'summary', r.summary, 'publishedAt', r.published_at
    ) item, o.name
    from app_private.organizations o
    join app_private.organization_profile_revisions r on r.id = o.active_profile_revision_id
    where o.status = 'active' and r.status = 'published'
    order by o.name
    limit 500
  ) bounded), '[]'::jsonb);
end;
$$;

revoke execute on function api.get_donation_status(text), api.get_published_articles(),
  api.get_public_campaigns(), api.get_public_nonprofit(text), api.get_public_nonprofits()
  from public, anon, authenticated;
grant execute on function api.get_donation_status(text), api.get_published_articles(),
  api.get_public_campaigns(), api.get_public_nonprofit(text), api.get_public_nonprofits()
  to service_role;
