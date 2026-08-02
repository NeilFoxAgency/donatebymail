-- Follow-up for the already-applied beta remediation migration. These fixes
-- keep the repository's canonical SQL and the hosted beta schema aligned.
alter table app_private.campaign_revision_blocks enable row level security;

create or replace function api.partner_create_campaign_asset(
  actor_user_id uuid, candidate_campaign_id uuid, asset_kind_value text,
  storage_path_value text, mime_type_value text, byte_size_value integer,
  alt_text_value text, decorative_value boolean, content_sha256_value text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare org_id uuid; asset_id uuid; normalized_alt text := nullif(trim(alt_text_value),'');
begin
  perform app_private.assert_service_role();
  select organization_id into org_id from app_private.campaigns where id=candidate_campaign_id and status in ('draft','published') for update;
  perform app_private.assert_org_member(actor_user_id,org_id);
  if asset_kind_value not in ('hero_image','supporting_image') then raise exception 'unsupported campaign asset kind' using errcode='22023'; end if;
  if storage_path_value !~ ('^campaigns/'||candidate_campaign_id::text||'/[0-9a-f-]{36}[.](jpg|png|webp)$') then raise exception 'invalid campaign asset path' using errcode='22023'; end if;
  if mime_type_value not in ('image/jpeg','image/png','image/webp') or byte_size_value not between 1 and 5242880 or content_sha256_value is null or content_sha256_value !~ '^[a-f0-9]{64}$' or (not coalesce(decorative_value,false) and char_length(coalesce(normalized_alt,'')) not between 1 and 300) then raise exception 'invalid campaign asset metadata' using errcode='22023'; end if;
  insert into app_private.campaign_assets(campaign_id,asset_kind,storage_path,mime_type,byte_size,alt_text,is_decorative,content_sha256,uploaded_by) values(candidate_campaign_id,asset_kind_value,storage_path_value,mime_type_value,byte_size_value,normalized_alt,coalesce(decorative_value,false),lower(content_sha256_value),actor_user_id) returning id into asset_id;
  return jsonb_build_object('id',asset_id,'contentSha256',lower(content_sha256_value));
end $$;

create or replace function api.get_public_campaign_asset(candidate_asset_id uuid) returns jsonb language plpgsql security definer stable set search_path=pg_catalog,app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object('id',a.id,'storagePath',a.storage_path,'mimeType',a.mime_type,'altText',a.alt_text,'isDecorative',a.is_decorative,'contentSha256',a.content_sha256) into result from app_private.campaign_assets a join app_private.campaigns c on c.id=a.campaign_id join app_private.campaign_revisions r on r.id=c.active_revision_id and (r.hero_asset_id=a.id or r.supporting_asset_id=a.id) join app_private.organizations o on o.id=c.organization_id join app_private.charities ch on ch.id=c.charity_id join app_private.organization_charities oc on oc.organization_id=c.organization_id and oc.charity_id=c.charity_id where a.id=candidate_asset_id and c.status='published' and r.status='published' and o.status='active' and ch.status='verified' and oc.status='verified';
  return result;
end $$;

create or replace function api.partner_campaign_detail(actor_user_id uuid,candidate_campaign_id uuid) returns jsonb language plpgsql security definer stable set search_path=pg_catalog,app_private as $$
declare result jsonb; org_id uuid;
begin
  perform app_private.assert_service_role(); select organization_id into org_id from app_private.campaigns where id=candidate_campaign_id; perform app_private.assert_org_member(actor_user_id,org_id);
  select jsonb_build_object('id',c.id,'organizationId',c.organization_id,'slug',c.slug,'name',c.name,'status',c.status,'charityName',ch.canonical_name,'activeRevisionId',c.active_revision_id,'revisions',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'version',r.version,'status',r.status,'headline',r.headline,'summary',r.summary,'story',r.story,'ctaLabel',r.cta_label,'heroAssetId',r.hero_asset_id,'heroAltText',ha.alt_text,'heroDecorative',coalesce(ha.is_decorative,false),'supportingAssetId',r.supporting_asset_id,'supportingAltText',sa.alt_text,'supportingDecorative',coalesce(sa.is_decorative,false),'blocks',r.content_blocks,'contentHash',r.content_hash,'createdAt',r.created_at,'publishedAt',r.published_at) order by r.version desc) from app_private.campaign_revisions r left join app_private.campaign_assets ha on ha.id=r.hero_asset_id left join app_private.campaign_assets sa on sa.id=r.supporting_asset_id where r.campaign_id=c.id),'[]'::jsonb)) into result from app_private.campaigns c join app_private.charities ch on ch.id=c.charity_id where c.id=candidate_campaign_id;
  return result;
end $$;
alter function api.partner_campaign_detail(uuid,uuid) volatile;
alter function api.account_context(uuid) volatile;
alter function api.get_public_campaign(text) volatile;
alter function api.get_public_campaign_asset(uuid) volatile;
alter function api.staff_financial_overview(uuid) volatile;
