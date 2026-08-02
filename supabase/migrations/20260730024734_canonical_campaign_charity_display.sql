-- Staff review must use the verified canonical charity row, not the legacy
-- denormalized campaign snapshot. This keeps staff, partner, and public
-- campaign views consistent after a Pledge verification refresh.
create or replace function api.staff_campaign_overview(actor_user_id uuid)
returns jsonb language plpgsql security definer stable
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_active_staff(actor_user_id);
  select jsonb_build_object('campaigns',coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'name',c.name,'slug',c.slug,'status',c.status,
    'organizationName',o.name,'charityName',ch.canonical_name,
    'activeRevisionId',c.active_revision_id,
    'revisions',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,'version',r.version,'status',r.status,'headline',r.headline,
      'summary',r.summary,'contentHash',r.content_hash,'createdAt',r.created_at
    ) order by r.version desc),'[]'::jsonb)
      from app_private.campaign_revisions r where r.campaign_id=c.id)
  ) order by c.updated_at desc),'[]'::jsonb)) into result
  from app_private.campaigns c
  join app_private.organizations o on o.id=c.organization_id
  join app_private.charities ch on ch.id=c.charity_id;
  return result;
end; $$;

alter function api.staff_campaign_overview(uuid) volatile;
