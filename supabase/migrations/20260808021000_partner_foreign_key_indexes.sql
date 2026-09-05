-- Cover every foreign key introduced by the partner platform. These indexes
-- support parent-row integrity checks and the staff/partner review read paths.
create index campaign_reviews_actor_user_id_idx
  on app_private.campaign_reviews(actor_user_id);
create index campaign_working_drafts_hero_asset_id_idx
  on app_private.campaign_working_drafts(hero_asset_id);
create index campaign_working_drafts_supporting_asset_id_idx
  on app_private.campaign_working_drafts(supporting_asset_id);
create index campaign_working_drafts_updated_by_idx
  on app_private.campaign_working_drafts(updated_by);
create index organization_assets_uploaded_by_idx
  on app_private.organization_assets(uploaded_by);
create index organization_profile_drafts_hero_asset_id_idx
  on app_private.organization_profile_drafts(hero_asset_id);
create index organization_profile_drafts_logo_asset_id_idx
  on app_private.organization_profile_drafts(logo_asset_id);
create index organization_profile_drafts_updated_by_idx
  on app_private.organization_profile_drafts(updated_by);
create index organization_profile_reviews_actor_user_id_idx
  on app_private.organization_profile_reviews(actor_user_id);
create index organization_profile_reviews_organization_id_idx
  on app_private.organization_profile_reviews(organization_id);
create index organization_profile_revisions_approved_by_idx
  on app_private.organization_profile_revisions(approved_by);
create index organization_profile_revisions_hero_asset_id_idx
  on app_private.organization_profile_revisions(hero_asset_id);
create index organization_profile_revisions_logo_asset_id_idx
  on app_private.organization_profile_revisions(logo_asset_id);
create index organization_profile_revisions_published_by_idx
  on app_private.organization_profile_revisions(published_by);
create index organization_profile_revisions_requested_by_idx
  on app_private.organization_profile_revisions(requested_by);
create index partner_applications_organization_id_idx
  on app_private.partner_applications(organization_id);
create index partner_applications_partner_lead_id_idx
  on app_private.partner_applications(partner_lead_id);
create index partner_applications_reviewed_by_idx
  on app_private.partner_applications(reviewed_by);
create index partner_invitations_revoked_by_idx
  on app_private.partner_invitations(revoked_by);
