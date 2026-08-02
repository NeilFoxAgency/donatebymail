-- The staff preview/asset reads call authorization routines that inspect
-- current session state, so they must not be marked STABLE.
alter function api.staff_campaign_revision_preview(uuid,uuid,uuid) volatile;
alter function api.staff_campaign_revision_asset(uuid,uuid) volatile;
