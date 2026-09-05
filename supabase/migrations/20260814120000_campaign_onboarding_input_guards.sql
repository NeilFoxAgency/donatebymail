-- Keep the guided onboarding contract fail-closed when callers bypass the UI.
-- The table checks still enforce the hard bounds; these explicit guards return
-- a useful validation error before a draft can be created with blank content.
create or replace function api.partner_create_campaign_v2(
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
  if coalesce(char_length(trim(campaign_name)),0) < 1 then
    raise exception 'campaign name required' using errcode='22023'; end if;
  if coalesce(char_length(trim(headline_value)),0) < 1 then
    raise exception 'campaign headline required' using errcode='22023'; end if;
  if coalesce(char_length(trim(summary_value)),0) < 1 then
    raise exception 'campaign summary required' using errcode='22023'; end if;
  if coalesce(char_length(trim(story_value)),0) < 1 then
    raise exception 'campaign story required' using errcode='22023'; end if;
  if phone_goal_value is not null and (phone_goal_value < 1 or phone_goal_value > 1000000) then
    raise exception 'phone goal out of range' using errcode='22023'; end if;
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
