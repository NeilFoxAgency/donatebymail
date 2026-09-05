-- Production-readiness schema for the beta nonprofit partner platform.
-- All operational data remains in app_private and is reachable only through
-- narrow service-role RPCs defined in the following migration.

alter type app_private.organization_role add value if not exists 'partner_editor';
alter type app_private.organization_role add value if not exists 'partner_viewer';
alter type app_private.campaign_status add value if not exists 'partner_review';
alter type app_private.campaign_status add value if not exists 'staff_review';
alter type app_private.campaign_status add value if not exists 'scheduled';
alter type app_private.campaign_status add value if not exists 'ended';
alter type app_private.campaign_revision_status add value if not exists 'partner_review';
alter type app_private.campaign_revision_status add value if not exists 'staff_review';

insert into app_private.reserved_route_slugs(slug,reason) values
  ('account','reserved authenticated donor route'),
  ('articles','published article namespace'),
  ('help','planned help namespace'),
  ('nonprofits','published nonprofit namespace'),
  ('partner','authenticated partner route'),
  ('privacy','existing policy route'),
  ('resources','existing public route'),
  ('staff','authenticated staff route'),
  ('team','existing public route'),
  ('terms','existing policy route'),
  ('tracking','donor tracking route'),
  ('transparency','existing public route')
on conflict(slug) do nothing;

create type app_private.partner_application_status as enum (
  'new', 'under_review', 'needs_information', 'verified', 'declined', 'converted'
);
create type app_private.profile_revision_status as enum (
  'draft', 'staff_review', 'approved', 'published', 'superseded', 'rejected'
);
create type app_private.review_outcome as enum (
  'requested', 'approved', 'changes_requested', 'published', 'scheduled', 'withdrawn'
);

create or replace function app_private.validate_campaign_blocks_v2(blocks jsonb)
returns boolean language sql immutable
set search_path = pg_catalog, app_private as $$
  select jsonb_typeof(blocks) = 'array'
    and jsonb_array_length(blocks) <= 12
    and not exists (
      select 1 from jsonb_array_elements(blocks) block
      where jsonb_typeof(block) <> 'object'
        or block->>'type' not in ('text','callout','statistic','quote')
        or jsonb_typeof(block->'content') <> 'object'
        or case block->>'type'
          when 'text' then not (
            char_length(trim(coalesce(block->'content'->>'heading',''))) between 1 and 120
            and char_length(trim(coalesce(block->'content'->>'body',''))) between 1 and 2000
            and ((block->'content') - array['heading','body']::text[]) = '{}'::jsonb
          )
          when 'callout' then not (
            char_length(trim(coalesce(block->'content'->>'heading',''))) between 1 and 120
            and char_length(trim(coalesce(block->'content'->>'body',''))) between 1 and 1200
            and ((block->'content') - array['heading','body']::text[]) = '{}'::jsonb
          )
          when 'statistic' then not (
            char_length(trim(coalesce(block->'content'->>'value',''))) between 1 and 40
            and char_length(trim(coalesce(block->'content'->>'label',''))) between 1 and 160
            and ((block->'content') - array['value','label']::text[]) = '{}'::jsonb
          )
          when 'quote' then not (
            char_length(trim(coalesce(block->'content'->>'body',''))) between 1 and 1200
            and char_length(trim(coalesce(block->'content'->>'attribution',''))) between 1 and 160
            and ((block->'content') - array['body','attribution']::text[]) = '{}'::jsonb
          )
          else true
        end
    )
$$;

create or replace function app_private.validate_campaign_toolkit(toolkit jsonb)
returns boolean language sql immutable
set search_path = pg_catalog, app_private as $$
  select jsonb_typeof(toolkit) = 'object'
    and (toolkit - array['emailSubject','emailBody','socialShort','socialLong','flyerHeadline','flyerBody']::text[]) = '{}'::jsonb
    and char_length(coalesce(toolkit->>'emailSubject','')) <= 160
    and char_length(coalesce(toolkit->>'emailBody','')) <= 4000
    and char_length(coalesce(toolkit->>'socialShort','')) <= 600
    and char_length(coalesce(toolkit->>'socialLong','')) <= 2000
    and char_length(coalesce(toolkit->>'flyerHeadline','')) <= 160
    and char_length(coalesce(toolkit->>'flyerBody','')) <= 1600
$$;

-- PII is isolated from business records and may later be migrated to encrypted
-- storage without changing application, lead, or organization identifiers.
create table app_private.partner_application_contacts (
  id uuid primary key default gen_random_uuid(),
  contact_name text not null check (char_length(trim(contact_name)) between 1 and 160),
  role_title text not null check (char_length(trim(role_title)) between 1 and 160),
  email_search text not null check (
    email_search = lower(trim(email_search))
    and char_length(email_search) between 3 and 320
    and email_search like '%@%'
  ),
  storage_format_version smallint not null default 1 check (storage_format_version > 0),
  created_at timestamptz not null default now()
);
create index partner_application_contacts_email_idx
  on app_private.partner_application_contacts (email_search);

create table app_private.partner_applications (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references app_private.partner_application_contacts(id) on delete restrict,
  organization_name text not null check (char_length(trim(organization_name)) between 1 and 200),
  website_url text not null check (char_length(website_url) <= 1000 and website_url ~ '^https://'),
  audience_summary text not null check (char_length(trim(audience_summary)) between 1 and 2000),
  goal_summary text not null check (char_length(trim(goal_summary)) between 1 and 2000),
  desired_timing text not null check (char_length(trim(desired_timing)) between 1 and 500),
  consented_at timestamptz not null,
  status app_private.partner_application_status not null default 'new',
  organization_id uuid references app_private.organizations(id) on delete restrict,
  partner_lead_id uuid references app_private.partner_leads(id) on delete restrict,
  idempotency_key text not null unique check (char_length(idempotency_key) between 16 and 200),
  submitted_session_hash text not null check (submitted_session_hash ~ '^[a-f0-9]{64}$'),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((reviewed_by is null) = (reviewed_at is null))
);
create index partner_applications_status_created_idx
  on app_private.partner_applications (status, created_at desc);
create index partner_applications_contact_idx
  on app_private.partner_applications (contact_id, created_at desc);
alter table app_private.partner_leads
  add column if not exists contact_id uuid references app_private.partner_application_contacts(id) on delete restrict,
  add column if not exists application_id uuid references app_private.partner_applications(id) on delete restrict;
create index partner_leads_contact_id_idx on app_private.partner_leads (contact_id) where contact_id is not null;
create index partner_leads_application_id_idx on app_private.partner_leads (application_id) where application_id is not null;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('partner-assets','partner-assets',false,5242880,array['image/jpeg','image/png','image/webp']::text[])
on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create table app_private.organization_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_private.organizations(id) on delete cascade,
  asset_kind text not null check (asset_kind in ('logo','hero_image')),
  storage_path text not null check (char_length(storage_path) between 1 and 500),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  byte_size integer not null check (byte_size between 1 and 5242880),
  width_pixels integer not null check (width_pixels between 16 and 8192),
  height_pixels integer not null check (height_pixels between 16 and 8192),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  alt_text text not null default '' check (char_length(alt_text) <= 300),
  is_decorative boolean not null default false,
  metadata_scrubbed boolean not null default true check (metadata_scrubbed),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, storage_path),
  check (is_decorative or char_length(trim(alt_text)) between 1 and 300),
  check ((width_pixels::bigint * height_pixels::bigint) <= 30000000)
);
create index organization_assets_org_kind_idx
  on app_private.organization_assets (organization_id, asset_kind, created_at desc);

create table app_private.organization_profile_drafts (
  organization_id uuid primary key references app_private.organizations(id) on delete cascade,
  mission text not null default '' check (char_length(mission) <= 2000),
  summary text not null default '' check (char_length(summary) <= 600),
  website_url text check (website_url is null or (char_length(website_url) <= 1000 and website_url ~ '^https://')),
  locality text check (locality is null or char_length(locality) <= 120),
  region text check (region is null or char_length(region) <= 120),
  country_code text not null default 'US' check (country_code ~ '^[A-Z]{2}$'),
  logo_asset_id uuid references app_private.organization_assets(id) on delete restrict,
  hero_asset_id uuid references app_private.organization_assets(id) on delete restrict,
  review_state text not null default 'editing' check (review_state in ('editing','staff_review','changes_requested')),
  review_feedback text check (review_feedback is null or char_length(review_feedback) <= 4000),
  lock_version integer not null default 1 check (lock_version > 0),
  updated_by uuid references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table app_private.organization_profile_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_private.organizations(id) on delete cascade,
  version integer not null check (version > 0),
  status app_private.profile_revision_status not null default 'draft',
  mission text not null check (char_length(trim(mission)) between 1 and 2000),
  summary text not null check (char_length(trim(summary)) between 1 and 600),
  website_url text not null check (char_length(website_url) <= 1000 and website_url ~ '^https://'),
  locality text,
  region text,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  logo_asset_id uuid references app_private.organization_assets(id) on delete restrict,
  logo_asset_sha256 text check (logo_asset_sha256 is null or logo_asset_sha256 ~ '^[a-f0-9]{64}$'),
  hero_asset_id uuid references app_private.organization_assets(id) on delete restrict,
  hero_asset_sha256 text check (hero_asset_sha256 is null or hero_asset_sha256 ~ '^[a-f0-9]{64}$'),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  requested_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (organization_id,version),
  check (status <> 'published' or (published_by is not null and published_at is not null))
);
alter table app_private.organizations
  add column if not exists active_profile_revision_id uuid
    references app_private.organization_profile_revisions(id) on delete restrict;
create index organizations_active_profile_revision_idx
  on app_private.organizations (active_profile_revision_id) where active_profile_revision_id is not null;

create table app_private.organization_profile_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_private.organizations(id) on delete cascade,
  revision_id uuid not null references app_private.organization_profile_revisions(id) on delete cascade,
  outcome app_private.review_outcome not null,
  feedback text check (feedback is null or char_length(feedback) <= 4000),
  actor_kind app_private.actor_kind not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index organization_profile_reviews_revision_idx
  on app_private.organization_profile_reviews (revision_id,created_at desc);

create table app_private.campaign_working_drafts (
  campaign_id uuid primary key references app_private.campaigns(id) on delete cascade,
  stage smallint not null default 1 check (stage between 1 and 7),
  headline text not null default '' check (char_length(headline) <= 160),
  summary text not null default '' check (char_length(summary) <= 600),
  story text not null default '' check (char_length(story) <= 12000),
  cta_label text not null default 'Donate a Phone' check (char_length(cta_label) between 1 and 80),
  content_blocks jsonb not null default '[]'::jsonb check (app_private.validate_campaign_blocks_v2(content_blocks)),
  toolkit jsonb not null default '{}'::jsonb check (app_private.validate_campaign_toolkit(toolkit)),
  hero_asset_id uuid references app_private.campaign_assets(id) on delete restrict,
  supporting_asset_id uuid references app_private.campaign_assets(id) on delete restrict,
  phone_goal integer check (phone_goal is null or phone_goal between 1 and 1000000),
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'America/New_York' check (char_length(timezone) between 1 and 100),
  partner_ready boolean not null default false,
  review_state text not null default 'editing' check (review_state in ('editing','partner_review','staff_review','changes_requested')),
  review_feedback text check (review_feedback is null or char_length(review_feedback) <= 4000),
  lock_version integer not null default 1 check (lock_version > 0),
  updated_by uuid references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

alter table app_private.campaigns
  add column if not exists phone_goal integer check (phone_goal is null or phone_goal between 1 and 1000000),
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists timezone text not null default 'America/New_York' check (char_length(timezone) between 1 and 100),
  add column if not exists review_feedback text check (review_feedback is null or char_length(review_feedback) <= 4000),
  add constraint campaigns_date_order_check check (ends_at is null or starts_at is null or ends_at > starts_at);
create index campaigns_public_lifecycle_idx
  on app_private.campaigns (status,starts_at,ends_at);

alter table app_private.campaign_revisions
  add column if not exists phone_goal integer check (phone_goal is null or phone_goal between 1 and 1000000),
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists timezone text not null default 'America/New_York' check (char_length(timezone) between 1 and 100),
  add column if not exists toolkit jsonb not null default '{}'::jsonb check (app_private.validate_campaign_toolkit(toolkit)),
  add constraint campaign_revisions_date_order_check check (ends_at is null or starts_at is null or ends_at > starts_at);

create table app_private.campaign_reviews (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references app_private.campaigns(id) on delete cascade,
  revision_id uuid not null references app_private.campaign_revisions(id) on delete cascade,
  outcome app_private.review_outcome not null,
  feedback text check (feedback is null or char_length(feedback) <= 4000),
  actor_kind app_private.actor_kind not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index campaign_reviews_revision_idx on app_private.campaign_reviews (revision_id,created_at desc);
create index campaign_reviews_campaign_idx on app_private.campaign_reviews (campaign_id,created_at desc);

alter table app_private.partner_invitations
  add column if not exists expires_at timestamptz not null default (now() + interval '7 days'),
  add column if not exists revoked_by uuid references auth.users(id) on delete restrict,
  add column if not exists revoked_at timestamptz,
  add column if not exists accepted_once boolean not null default false,
  add constraint partner_invitations_expiry_check check (expires_at > invited_at),
  add constraint partner_invitations_revocation_check check ((revoked_by is null) = (revoked_at is null));
create index partner_invitations_expiry_idx on app_private.partner_invitations (expires_at) where status='invited';

alter table app_private.campaign_assets
  add column if not exists width_pixels integer,
  add column if not exists height_pixels integer,
  add column if not exists metadata_scrubbed boolean not null default false,
  add constraint campaign_assets_dimensions_check check (
    (width_pixels is null and height_pixels is null)
    or (width_pixels between 16 and 8192 and height_pixels between 16 and 8192
      and width_pixels::bigint * height_pixels::bigint <= 30000000)
  );

alter table app_private.campaign_events
  add column if not exists event_key text,
  add column if not exists source_category text,
  add constraint campaign_events_key_check check (event_key is null or event_key ~ '^[a-f0-9]{64}$'),
  add constraint campaign_events_source_check check (
    source_category is null or source_category in ('email','social','web','event','print','qr','direct')
  );
create unique index campaign_events_dedupe_idx on app_private.campaign_events (campaign_id,event_type,event_key)
  where event_key is not null;

-- Immutable reviewed content and assets cannot be silently changed or deleted.
create or replace function app_private.prevent_organization_asset_mutation()
returns trigger language plpgsql set search_path=pg_catalog,app_private as $$
begin
  if tg_op='UPDATE' then raise exception 'organization asset metadata is immutable' using errcode='23514'; end if;
  if exists(select 1 from app_private.organization_profile_revisions r
    where r.logo_asset_id=old.id or r.hero_asset_id=old.id) then
    raise exception 'organization asset is referenced by a revision' using errcode='23503';
  end if;
  return old;
end $$;
create trigger organization_assets_immutable_guard before update or delete on app_private.organization_assets
for each row execute function app_private.prevent_organization_asset_mutation();

create or replace function app_private.prevent_partner_revision_content_mutation()
returns trigger language plpgsql set search_path=pg_catalog,app_private as $$
begin
  if tg_op='DELETE' then raise exception 'reviewed revisions are append-only' using errcode='23514'; end if;
  if tg_table_name='organization_profile_revisions' then
    if row(
      new.organization_id,new.version,new.mission,new.summary,new.website_url,new.locality,new.region,
      new.country_code,new.logo_asset_id,new.logo_asset_sha256,new.hero_asset_id,new.hero_asset_sha256,
      new.content_hash,new.requested_by,new.created_at
    ) is distinct from row(
      old.organization_id,old.version,old.mission,old.summary,old.website_url,old.locality,old.region,
      old.country_code,old.logo_asset_id,old.logo_asset_sha256,old.hero_asset_id,old.hero_asset_sha256,
      old.content_hash,old.requested_by,old.created_at
    ) then raise exception 'profile revision content is immutable' using errcode='23514'; end if;
  elsif tg_table_name='campaign_revisions' then
    if row(
      new.campaign_id,new.version,new.headline,new.summary,new.story,new.cta_label,new.hero_asset_id,
      new.supporting_asset_id,new.hero_asset_sha256,new.supporting_asset_sha256,new.content_blocks,
      new.phone_goal,new.starts_at,new.ends_at,new.timezone,new.toolkit,new.content_hash,new.requested_by,
      new.requested_by_agent,new.created_at
    ) is distinct from row(
      old.campaign_id,old.version,old.headline,old.summary,old.story,old.cta_label,old.hero_asset_id,
      old.supporting_asset_id,old.hero_asset_sha256,old.supporting_asset_sha256,old.content_blocks,
      old.phone_goal,old.starts_at,old.ends_at,old.timezone,old.toolkit,old.content_hash,old.requested_by,
      old.requested_by_agent,old.created_at
    ) then raise exception 'campaign revision content is immutable' using errcode='23514'; end if;
  end if;
  return new;
end $$;
create trigger organization_profile_revision_content_guard before update or delete on app_private.organization_profile_revisions
for each row execute function app_private.prevent_partner_revision_content_mutation();
create trigger campaign_revision_content_guard before update or delete on app_private.campaign_revisions
for each row execute function app_private.prevent_partner_revision_content_mutation();
create trigger organization_profile_reviews_append_only before update or delete on app_private.organization_profile_reviews
for each row execute function app_private.prevent_update_or_delete();
create trigger campaign_reviews_append_only before update or delete on app_private.campaign_reviews
for each row execute function app_private.prevent_update_or_delete();

create function app_private.enforce_active_campaign_attribution()
returns trigger language plpgsql
set search_path=pg_catalog,app_private as $$
begin
  if new.campaign_id is not null and not exists(
    select 1 from app_private.campaigns c where c.id=new.campaign_id and c.status='published'
      and c.active_revision_id is not null and (c.starts_at is null or c.starts_at<=now())
      and (c.ends_at is null or c.ends_at>now())
  ) then raise exception 'active campaign attribution required' using errcode='22023'; end if;
  return new;
end $$;
create trigger donations_active_campaign_attribution before insert or update of campaign_id on app_private.donations
for each row execute function app_private.enforce_active_campaign_attribution();

create function app_private.record_campaign_submission_event()
returns trigger language plpgsql
set search_path=pg_catalog,extensions,app_private as $$
begin
  if new.campaign_id is not null then
    insert into app_private.campaign_events(campaign_id,event_type,event_key,source_category)
    values(new.campaign_id,'donation_submitted',encode(digest(convert_to('donation:'||new.id::text,'utf8'),'sha256'),'hex'),'direct')
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger donations_campaign_submission_event after insert on app_private.donations
for each row execute function app_private.record_campaign_submission_event();

do $$ declare table_name text; begin
  foreach table_name in array array[
    'partner_application_contacts','partner_applications','organization_assets',
    'organization_profile_drafts','organization_profile_revisions','organization_profile_reviews',
    'campaign_working_drafts','campaign_reviews'
  ] loop execute format('alter table app_private.%I enable row level security',table_name); end loop;
end $$;

revoke all on app_private.partner_application_contacts,app_private.partner_applications,
  app_private.organization_assets,app_private.organization_profile_drafts,
  app_private.organization_profile_revisions,app_private.organization_profile_reviews,
  app_private.campaign_working_drafts,app_private.campaign_reviews
from public,anon,authenticated;
grant select,insert,update,delete on app_private.partner_application_contacts,app_private.partner_applications,
  app_private.organization_assets,app_private.organization_profile_drafts,
  app_private.organization_profile_revisions,app_private.organization_profile_reviews,
  app_private.campaign_working_drafts,app_private.campaign_reviews
to service_role;

revoke all on function app_private.validate_campaign_blocks_v2(jsonb),
  app_private.validate_campaign_toolkit(jsonb),app_private.prevent_organization_asset_mutation(),
  app_private.prevent_partner_revision_content_mutation(),app_private.enforce_active_campaign_attribution(),
  app_private.record_campaign_submission_event()
from public,anon,authenticated;
