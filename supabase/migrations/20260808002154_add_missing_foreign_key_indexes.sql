-- Foreign-key support indexes reported by the hosted beta performance advisor.
-- Existing workload indexes are intentionally retained; an empty beta dataset
-- is not evidence that they are safe to remove.

create index if not exists agent_message_authorizations_campaign_id_idx
  on app_private.agent_message_authorizations (campaign_id)
  where campaign_id is not null;
create index if not exists agent_message_authorizations_donation_id_idx
  on app_private.agent_message_authorizations (donation_id)
  where donation_id is not null;
create index if not exists agent_message_authorizations_organization_id_idx
  on app_private.agent_message_authorizations (organization_id)
  where organization_id is not null;

create index if not exists article_revisions_created_by_idx
  on app_private.article_revisions (created_by)
  where created_by is not null;
create index if not exists articles_created_by_idx
  on app_private.articles (created_by)
  where created_by is not null;
create index if not exists articles_current_revision_id_idx
  on app_private.articles (current_revision_id)
  where current_revision_id is not null;
create index if not exists articles_published_revision_id_idx
  on app_private.articles (published_revision_id)
  where published_revision_id is not null;
create index if not exists articles_scheduled_revision_id_idx
  on app_private.articles (scheduled_revision_id)
  where scheduled_revision_id is not null;
create index if not exists articles_updated_by_idx
  on app_private.articles (updated_by)
  where updated_by is not null;

create index if not exists partner_leads_organization_id_idx
  on app_private.partner_leads (organization_id)
  where organization_id is not null;
