-- Cover foreign-key lookups reported by the hosted Supabase performance advisor.
create index campaign_revisions_hero_asset_id_idx
  on app_private.campaign_revisions (hero_asset_id);
create index charities_verified_by_idx
  on app_private.charities (verified_by);
create index cost_allocation_applications_device_id_idx
  on app_private.cost_allocation_applications (device_id);
create index cost_allocation_applications_policy_rule_id_idx
  on app_private.cost_allocation_applications (policy_rule_id);
create index cost_allocation_applications_sale_result_id_idx
  on app_private.cost_allocation_applications (sale_result_id);
create index donation_claim_capabilities_claimed_by_idx
  on app_private.donation_claim_capabilities (claimed_by);
create index organization_charities_charity_id_idx
  on app_private.organization_charities (charity_id);
create index organization_charities_verified_by_idx
  on app_private.organization_charities (verified_by);
