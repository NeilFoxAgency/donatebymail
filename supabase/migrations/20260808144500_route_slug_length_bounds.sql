-- Keep every public route slug within the bound enforced by the Worker and
-- agent contracts. Pattern-only checks otherwise allow oversized values that
-- cannot be safely represented by all route consumers.

alter table app_private.organizations
  add constraint organizations_slug_length check (char_length(slug) between 1 and 120);

alter table app_private.campaigns
  add constraint campaigns_slug_length check (char_length(slug) between 1 and 120);

alter table app_private.reserved_route_slugs
  add constraint reserved_route_slugs_length check (char_length(slug) between 1 and 120);

alter table app_private.campaign_route_aliases
  add constraint campaign_route_aliases_root_slug_length check (char_length(root_slug) between 1 and 120),
  add constraint campaign_route_aliases_canonical_slug_length check (char_length(canonical_slug) between 1 and 120);

create or replace function api.partner_campaign_slug_available(
  actor_user_id uuid, candidate_organization_id uuid, candidate_slug text
)
returns boolean language plpgsql security definer
set search_path = pg_catalog, app_private
as $$
declare normalized text := lower(trim(candidate_slug));
begin
  perform app_private.assert_service_role();
  perform app_private.assert_org_viewer(actor_user_id, candidate_organization_id);
  return normalized is not null
    and char_length(normalized) between 1 and 120
    and normalized ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    and not exists(select 1 from app_private.reserved_route_slugs where slug = normalized)
    and not exists(select 1 from app_private.campaigns where slug = normalized)
    and not exists(select 1 from app_private.campaign_route_aliases where root_slug = normalized and status = 'active');
end;
$$;

create or replace function api.staff_set_campaign_alias(
  actor_user_id uuid, candidate_campaign_id uuid, alias_slug_value text,
  behavior_value app_private.campaign_alias_behavior default 'redirect'
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private
as $$
declare
  normalized text := lower(trim(both '/' from alias_slug_value));
  alias_id_value uuid;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_active_admin(actor_user_id);
  if normalized is null
    or char_length(normalized) not between 1 and 120
    or normalized !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'campaign vanity alias must be a lowercase route slug under 120 characters'
      using errcode = '22023';
  end if;
  if normalized in (select slug from app_private.reserved_route_slugs)
    or exists(select 1 from app_private.campaigns where slug = normalized)
    or exists(select 1 from app_private.campaign_route_aliases where root_slug = normalized and status = 'active') then
    raise exception 'vanity alias unavailable' using errcode = '23505';
  end if;
  insert into app_private.campaign_route_aliases(root_slug, campaign_id, canonical_slug, behavior, status, created_by)
  select normalized, c.id, c.slug, behavior_value, 'active', actor_user_id
    from app_private.campaigns c where c.id = candidate_campaign_id
  returning id into alias_id_value;
  if alias_id_value is null then raise exception 'campaign not found' using errcode = '22023'; end if;
  insert into app_private.audit_events(actor, actor_ref, action_name, entity_type, entity_id, reason_code, redacted_changes, metadata)
  values('staff', actor_user_id::text, 'campaign.set_vanity_alias', 'campaign_route_alias', alias_id_value,
    'staff_approved_marketing_route', jsonb_build_object('root_slug', normalized, 'behavior', behavior_value),
    jsonb_build_object('campaign_id', candidate_campaign_id));
  return jsonb_build_object('aliasId', alias_id_value, 'path', '/' || normalized, 'behavior', behavior_value);
end;
$$;

revoke execute on function api.partner_campaign_slug_available(uuid, uuid, text),
  api.staff_set_campaign_alias(uuid, uuid, text, app_private.campaign_alias_behavior)
  from public, anon, authenticated;
grant execute on function api.partner_campaign_slug_available(uuid, uuid, text),
  api.staff_set_campaign_alias(uuid, uuid, text, app_private.campaign_alias_behavior)
  to service_role;
