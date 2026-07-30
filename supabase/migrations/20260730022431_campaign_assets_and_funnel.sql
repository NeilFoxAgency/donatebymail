-- Controlled campaign image support. Assets remain private in Supabase Storage
-- and are served through the beta Worker only after publication checks.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'campaign-assets',
  'campaign-assets',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- The asset table and the immutable revision link already existed in the
-- foundational campaign migration. The deferred check is removed now that
-- uploads have a server-only storage path, MIME/size validation, and a
-- publication-gated serving endpoint.
alter table app_private.campaign_revisions
  drop constraint if exists campaign_assets_deferred;

create or replace function api.partner_create_campaign_asset(
  actor_user_id uuid,
  candidate_campaign_id uuid,
  asset_kind_value text,
  storage_path_value text,
  mime_type_value text,
  byte_size_value integer,
  alt_text_value text
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, app_private
as $$
declare asset_id uuid;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_org_member(actor_user_id, (select organization_id from app_private.campaigns where id=candidate_campaign_id));
  if asset_kind_value not in ('hero_image','supporting_image') then
    raise exception 'unsupported campaign asset kind' using errcode='22023';
  end if;
  if storage_path_value !~ ('^campaigns/'||candidate_campaign_id::text||'/[0-9a-f-]{36}[.](jpg|jpeg|png|webp)$') then
    raise exception 'invalid campaign asset path' using errcode='22023';
  end if;
  if mime_type_value not in ('image/jpeg','image/png','image/webp')
    or byte_size_value is null or byte_size_value < 1 or byte_size_value > 5242880
    or char_length(trim(alt_text_value)) not between 1 and 300 then
    raise exception 'invalid campaign asset metadata' using errcode='22023';
  end if;
  insert into app_private.campaign_assets(campaign_id,asset_kind,storage_path,mime_type,byte_size,alt_text,uploaded_by)
  values(candidate_campaign_id,asset_kind_value,storage_path_value,mime_type_value,byte_size_value,trim(alt_text_value),actor_user_id)
  returning id into asset_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('partner',actor_user_id::text,'campaign.asset_upload','campaign_asset',asset_id,'partner_controlled_asset',
    jsonb_build_object('campaign_id',candidate_campaign_id,'asset_kind',asset_kind_value,'mime_type',mime_type_value,'byte_size',byte_size_value),
    jsonb_build_object('storage_path_hash',encode(extensions.digest(storage_path_value,'sha256'),'hex')));
  return jsonb_build_object('id',asset_id,'assetKind',asset_kind_value,'altText',trim(alt_text_value));
end $$;

create or replace function api.get_public_campaign_asset(candidate_asset_id uuid)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object('id',a.id,'storagePath',a.storage_path,'mimeType',a.mime_type,'altText',a.alt_text)
    into result
  from app_private.campaign_assets a
  join app_private.campaigns c on c.id=a.campaign_id
  join app_private.campaign_revisions r on r.id=c.active_revision_id and r.hero_asset_id=a.id
  join app_private.organizations o on o.id=c.organization_id
  join app_private.charities ch on ch.id=c.charity_id
  join app_private.organization_charities oc on oc.organization_id=c.organization_id and oc.charity_id=c.charity_id
  where a.id=candidate_asset_id and c.status='published' and r.status='published'
    and o.status='active' and ch.status='verified' and oc.status='verified';
  return result;
end $$;

create or replace function api.partner_delete_campaign_asset(actor_user_id uuid, candidate_asset_id uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, app_private
as $$
declare campaign_id_value uuid; asset_path text;
begin
  perform app_private.assert_service_role();
  select campaign_id,storage_path into campaign_id_value,asset_path from app_private.campaign_assets where id=candidate_asset_id for update;
  if campaign_id_value is null then return; end if;
  perform app_private.assert_org_member(actor_user_id,(select organization_id from app_private.campaigns where id=campaign_id_value));
  if exists(select 1 from app_private.campaign_revisions where hero_asset_id=candidate_asset_id) then
    raise exception 'campaign asset is already referenced by a revision' using errcode='23503';
  end if;
  delete from app_private.campaign_assets where id=candidate_asset_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('partner',actor_user_id::text,'campaign.asset_delete','campaign_asset',candidate_asset_id,'upload_cleanup',
    jsonb_build_object('campaign_id',campaign_id_value),jsonb_build_object('storage_path_hash',encode(extensions.digest(asset_path,'sha256'),'hex')));
end $$;

grant execute on function api.partner_create_campaign_asset(uuid,uuid,text,text,text,integer,text) to service_role;
grant execute on function api.get_public_campaign_asset(uuid) to service_role;
grant execute on function api.partner_delete_campaign_asset(uuid,uuid) to service_role;

-- Keep these policy and storage records server-only; public visitors use the
-- Worker proxy and never receive a Supabase Storage credential or path.
revoke all on function api.partner_create_campaign_asset(uuid,uuid,text,text,text,integer,text) from public,anon,authenticated;
revoke all on function api.get_public_campaign_asset(uuid) from public,anon,authenticated;
revoke all on function api.partner_delete_campaign_asset(uuid,uuid) from public,anon,authenticated;
