-- Gen2 beta capabilities after the Phase 1B operational spine.
-- This remains beta-only. Tables are private and all browser access is mediated
-- by narrow service RPCs in the api schema.

create type app_private.shipment_direction as enum ('inbound', 'return');
create type app_private.shipment_status as enum (
  'not_mailed', 'mailed', 'in_transit', 'delivered', 'exception', 'returned'
);
create type app_private.financial_entry_status as enum (
  'draft', 'recorded', 'reversed'
);
create type app_private.allocation_status as enum (
  'policy_hold', 'calculated', 'approved', 'disbursed', 'reversed'
);
create type app_private.disbursement_status as enum (
  'prepared', 'approved', 'completed', 'cancelled', 'reversed'
);
create type app_private.campaign_status as enum (
  'draft', 'review', 'published', 'paused', 'completed', 'archived'
);
create type app_private.campaign_revision_status as enum (
  'draft', 'approved', 'published', 'superseded', 'rejected'
);

create table app_private.donation_shipments (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null references app_private.donations(id) on delete cascade,
  direction app_private.shipment_direction not null default 'inbound',
  status app_private.shipment_status not null default 'not_mailed',
  carrier text check (carrier is null or char_length(carrier) <= 80),
  tracking_number text check (tracking_number is null or char_length(tracking_number) between 4 and 120),
  mailed_at timestamptz,
  delivered_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'not_mailed' or mailed_at is not null),
  check (status <> 'delivered' or delivered_at is not null)
);
create unique index donation_shipments_one_inbound_idx
  on app_private.donation_shipments (donation_id) where direction = 'inbound';
create index donation_shipments_status_idx
  on app_private.donation_shipments (status, updated_at desc);

create table app_private.device_sale_results (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references app_private.donation_devices(id) on delete restrict,
  gross_amount_cents bigint not null check (gross_amount_cents >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  channel text not null check (char_length(channel) between 1 and 120),
  external_reference text check (external_reference is null or char_length(external_reference) <= 240),
  sold_at timestamptz not null,
  status app_private.financial_entry_status not null default 'recorded',
  reversal_of uuid references app_private.device_sale_results(id) on delete restrict,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((status = 'reversed') = (reversal_of is not null))
);
create index device_sale_results_device_idx on app_private.device_sale_results (device_id, created_at);

create table app_private.donation_costs (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null references app_private.donations(id) on delete restrict,
  device_id uuid references app_private.donation_devices(id) on delete restrict,
  category text not null check (category ~ '^[a-z][a-z0-9_]{2,79}$'),
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  evidence_reference text check (evidence_reference is null or char_length(evidence_reference) <= 500),
  incurred_at timestamptz not null,
  status app_private.financial_entry_status not null default 'recorded',
  reversal_of uuid references app_private.donation_costs(id) on delete restrict,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((status = 'reversed') = (reversal_of is not null))
);
create index donation_costs_donation_idx on app_private.donation_costs (donation_id, created_at);

create table app_private.proceeds_allocations (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null references app_private.donations(id) on delete restrict,
  policy_version_id uuid references app_private.proceeds_policy_versions(id) on delete restrict,
  beneficiary_pledge_id uuid not null,
  gross_cents bigint not null check (gross_cents >= 0),
  eligible_cost_cents bigint not null default 0 check (eligible_cost_cents >= 0),
  allocable_base_cents bigint not null check (allocable_base_cents >= 0),
  share_basis_points integer check (share_basis_points between 0 and 10000),
  allocated_cents bigint check (allocated_cents is null or allocated_cents >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  status app_private.allocation_status not null default 'policy_hold',
  calculation_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(calculation_snapshot) = 'object'),
  calculated_by uuid references auth.users(id) on delete set null,
  calculated_at timestamptz,
  reversal_of uuid references app_private.proceeds_allocations(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (status = 'policy_hold' or policy_version_id is not null),
  check (status <> 'reversed' or reversal_of is not null)
);
create index proceeds_allocations_donation_idx on app_private.proceeds_allocations (donation_id, created_at);
create index proceeds_allocations_status_idx on app_private.proceeds_allocations (status, created_at);

create table app_private.disbursement_preparations (
  id uuid primary key default gen_random_uuid(),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  beneficiary_reference text not null check (char_length(beneficiary_reference) between 1 and 240),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  prepared_by uuid not null references auth.users(id) on delete restrict,
  prepared_at timestamptz not null default now()
);
create table app_private.disbursement_preparation_allocations (
  preparation_id uuid not null references app_private.disbursement_preparations(id) on delete restrict,
  allocation_id uuid not null references app_private.proceeds_allocations(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  primary key (preparation_id, allocation_id)
);
create table app_private.disbursement_approvals (
  id uuid primary key default gen_random_uuid(),
  preparation_id uuid not null references app_private.disbursement_preparations(id) on delete restrict,
  approval_policy_id uuid not null references app_private.financial_approval_policies(id) on delete restrict,
  approver_user_id uuid not null references auth.users(id) on delete restrict,
  outcome app_private.approval_outcome not null,
  reason text check (reason is null or char_length(reason) <= 1000),
  created_at timestamptz not null default now(),
  unique (preparation_id, approver_user_id)
);
create table app_private.disbursements (
  id uuid primary key default gen_random_uuid(),
  preparation_id uuid not null unique references app_private.disbursement_preparations(id) on delete restrict,
  status app_private.disbursement_status not null default 'prepared',
  external_payment_reference text check (external_payment_reference is null or char_length(external_payment_reference) <= 240),
  completed_by uuid references auth.users(id) on delete restrict,
  completed_at timestamptz,
  reversal_of uuid references app_private.disbursements(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (status <> 'completed' or (completed_by is not null and completed_at is not null and external_payment_reference is not null)),
  check (status <> 'reversed' or reversal_of is not null)
);

create table app_private.campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_private.organizations(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 200),
  selected_charity_pledge_id uuid not null,
  selected_charity_name text not null check (char_length(selected_charity_name) between 1 and 240),
  status app_private.campaign_status not null default 'draft',
  active_revision_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaigns_organization_idx on app_private.campaigns (organization_id, status, updated_at desc);
create table app_private.campaign_revisions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references app_private.campaigns(id) on delete cascade,
  version integer not null check (version > 0),
  status app_private.campaign_revision_status not null default 'draft',
  headline text not null check (char_length(headline) between 1 and 160),
  summary text not null check (char_length(summary) between 1 and 600),
  story text not null check (char_length(story) between 1 and 12000),
  cta_label text not null default 'Donate a Phone' check (char_length(cta_label) between 1 and 80),
  hero_image_url text check (hero_image_url is null or (char_length(hero_image_url) <= 1000 and hero_image_url ~ '^https://')),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  requested_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (campaign_id, version),
  check (status <> 'published' or (published_by is not null and published_at is not null))
);
alter table app_private.campaigns
  add constraint campaigns_active_revision_fk foreign key (active_revision_id)
  references app_private.campaign_revisions(id) on delete restrict;
alter table app_private.campaign_route_aliases
  add constraint campaign_route_aliases_campaign_fk foreign key (campaign_id)
  references app_private.campaigns(id) on delete cascade;

create table app_private.campaign_assets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references app_private.campaigns(id) on delete cascade,
  asset_kind text not null check (asset_kind in ('hero_image','logo','supporting_image')),
  storage_path text not null check (char_length(storage_path) between 1 and 500),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  byte_size integer not null check (byte_size between 1 and 5242880),
  alt_text text not null check (char_length(alt_text) between 1 and 300),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (campaign_id, storage_path)
);
create table app_private.campaign_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references app_private.campaigns(id) on delete cascade,
  event_type text not null check (event_type in ('view','donation_started','donation_submitted')),
  anonymous_session_hash text check (anonymous_session_hash is null or anonymous_session_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz not null default now()
);
create index campaign_events_rollup_idx on app_private.campaign_events (campaign_id, event_type, occurred_at);

create table app_private.communication_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references app_private.organizations(id) on delete restrict,
  campaign_id uuid references app_private.campaigns(id) on delete restrict,
  external_provider text not null check (external_provider in ('gmail','brevo','manual')),
  external_thread_ref text check (external_thread_ref is null or char_length(external_thread_ref) <= 300),
  subject text check (subject is null or char_length(subject) <= 500),
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);
create table app_private.communication_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references app_private.communication_threads(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound')),
  external_message_ref text check (external_message_ref is null or char_length(external_message_ref) <= 300),
  sender_identity_ref text check (sender_identity_ref is null or char_length(sender_identity_ref) <= 300),
  recipient_identity_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(recipient_identity_refs) = 'array'),
  body_summary text check (body_summary is null or char_length(body_summary) <= 2000),
  body_storage_ref text check (body_storage_ref is null or char_length(body_storage_ref) <= 500),
  agent_action_id uuid references app_private.agent_actions(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table app_private.donations
  add column campaign_id uuid references app_private.campaigns(id) on delete restrict;
create index donations_campaign_idx on app_private.donations (campaign_id, created_at desc)
  where campaign_id is not null;

create trigger device_sale_results_append_only before update or delete on app_private.device_sale_results
for each row execute function app_private.prevent_update_or_delete();
create trigger donation_costs_append_only before update or delete on app_private.donation_costs
for each row execute function app_private.prevent_update_or_delete();
create trigger proceeds_allocations_append_only before update or delete on app_private.proceeds_allocations
for each row execute function app_private.prevent_update_or_delete();
create trigger disbursement_preparations_append_only before update or delete on app_private.disbursement_preparations
for each row execute function app_private.prevent_update_or_delete();
create trigger disbursement_approvals_append_only before update or delete on app_private.disbursement_approvals
for each row execute function app_private.prevent_update_or_delete();
create trigger campaign_events_append_only before update or delete on app_private.campaign_events
for each row execute function app_private.prevent_update_or_delete();

create function app_private.assert_org_member(actor_user_id uuid, candidate_organization_id uuid)
returns void language plpgsql set search_path = pg_catalog, app_private as $$
begin
  if actor_user_id is null or not exists (
    select 1 from app_private.organization_memberships
    where user_id = actor_user_id and organization_id = candidate_organization_id
      and status = 'active'
  ) then raise exception 'active organization membership required' using errcode = '42501'; end if;
end; $$;

create function app_private.assert_org_admin(actor_user_id uuid, candidate_organization_id uuid)
returns void language plpgsql set search_path = pg_catalog, app_private as $$
begin
  if actor_user_id is null or not exists (
    select 1 from app_private.organization_memberships
    where user_id = actor_user_id and organization_id = candidate_organization_id
      and status = 'active' and role = 'partner_admin'
  ) then raise exception 'organization admin membership required' using errcode = '42501'; end if;
end; $$;

create function api.donor_account_overview(actor_user_id uuid, verified_email text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private, auth as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  if actor_user_id is null or not exists (
    select 1 from auth.users where id = actor_user_id
      and lower(email) = lower(trim(verified_email)) and email_confirmed_at is not null
  ) then raise exception 'verified donor identity required' using errcode = '42501'; end if;
  insert into app_private.profiles (user_id) values (actor_user_id) on conflict do nothing;
  insert into app_private.donor_account_links (donor_contact_id, user_id)
    select id, actor_user_id from app_private.donor_contacts
    where email_search = lower(trim(verified_email)) on conflict do nothing;
  select jsonb_build_object(
    'donations', coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'publicId', d.public_id, 'status', d.status,
      'charityName', d.selected_charity_name, 'createdAt', d.created_at,
      'receivedAt', d.received_at, 'completedAt', d.completed_at,
      'deviceCount', (select count(*) from app_private.donation_devices x where x.donation_id = d.id),
      'shipment', (select jsonb_build_object('status', s.status, 'carrier', s.carrier,
        'trackingLastFour', case when s.tracking_number is null then null else right(s.tracking_number,4) end,
        'mailedAt', s.mailed_at, 'deliveredAt', s.delivered_at)
        from app_private.donation_shipments s where s.donation_id = d.id and s.direction = 'inbound')
    ) order by d.created_at desc), '[]'::jsonb)
  ) into result
  from app_private.donations d join app_private.donor_account_links l
    on l.donor_contact_id = d.donor_contact_id where l.user_id = actor_user_id;
  return result;
end; $$;

create function api.donor_mark_donation_mailed(actor_user_id uuid, verified_email text,
  candidate_donation_id uuid, carrier_name text, tracking_value text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private, auth as $$
declare old_status app_private.donation_status;
begin
  perform app_private.assert_service_role();
  perform api.donor_account_overview(actor_user_id, verified_email);
  select d.status into old_status from app_private.donations d
    join app_private.donor_account_links l on l.donor_contact_id = d.donor_contact_id
    where d.id = candidate_donation_id and l.user_id = actor_user_id for update;
  if not found or old_status not in ('submitted','in_transit') then
    raise exception 'donation cannot be marked mailed' using errcode = '22023'; end if;
  insert into app_private.donation_shipments
    (donation_id, status, carrier, tracking_number, mailed_at, created_by)
  values (candidate_donation_id, 'mailed', nullif(trim(carrier_name),''),
    nullif(trim(tracking_value),''), now(), actor_user_id)
  on conflict (donation_id) where direction = 'inbound' do update set
    status='mailed', carrier=excluded.carrier, tracking_number=excluded.tracking_number,
    mailed_at=excluded.mailed_at, updated_at=now();
  if old_status = 'submitted' then
    update app_private.donations set status='in_transit', updated_at=now() where id=candidate_donation_id;
    insert into app_private.donation_status_events
      (donation_id,status,donor_visible,public_message,actor,actor_user_id)
    values (candidate_donation_id,'in_transit',true,
      'You marked this donation as mailed. Carrier delivery is not physical receipt verification.',
      'donor',actor_user_id);
  end if;
  insert into app_private.audit_events
    (actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values ('donor',actor_user_id::text,'donation.mark_mailed','donation',candidate_donation_id,
    'donor_shipping_update',jsonb_build_object('carrier_supplied',carrier_name is not null,
      'tracking_supplied',tracking_value is not null),jsonb_build_object('pii_redacted',true));
  return jsonb_build_object('ok',true);
end; $$;

create function api.partner_overview(actor_user_id uuid)
returns jsonb language plpgsql security definer stable
set search_path = pg_catalog, app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object('organizations',coalesce(jsonb_agg(jsonb_build_object(
    'id',o.id,'name',o.name,'slug',o.slug,'role',m.role,
    'campaigns',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',c.id,'slug',c.slug,'name',c.name,'status',c.status,
      'charityName',c.selected_charity_name,'updatedAt',c.updated_at)
      order by c.updated_at desc),'[]'::jsonb) from app_private.campaigns c where c.organization_id=o.id)
  ) order by o.name),'[]'::jsonb)) into result
  from app_private.organizations o join app_private.organization_memberships m
    on m.organization_id=o.id where m.user_id=actor_user_id and m.status='active';
  return result;
end; $$;

create function api.partner_campaign_detail(actor_user_id uuid, candidate_campaign_id uuid)
returns jsonb language plpgsql security definer stable
set search_path = pg_catalog, app_private as $$
declare result jsonb; org_id uuid;
begin
  perform app_private.assert_service_role();
  select organization_id into org_id from app_private.campaigns where id=candidate_campaign_id;
  perform app_private.assert_org_member(actor_user_id,org_id);
  select jsonb_build_object('id',c.id,'organizationId',c.organization_id,'slug',c.slug,
    'name',c.name,'status',c.status,'charityName',c.selected_charity_name,
    'activeRevisionId',c.active_revision_id,
    'revisions',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'version',r.version,
      'status',r.status,'headline',r.headline,'summary',r.summary,'story',r.story,
      'ctaLabel',r.cta_label,'heroImageUrl',r.hero_image_url,'contentHash',r.content_hash,
      'createdAt',r.created_at,'publishedAt',r.published_at) order by r.version desc)
      from app_private.campaign_revisions r where r.campaign_id=c.id),'[]'::jsonb)) into result
  from app_private.campaigns c where c.id=candidate_campaign_id;
  return result;
end; $$;

create function api.partner_create_campaign(actor_user_id uuid, candidate_organization_id uuid,
  campaign_slug text, campaign_name text, charity_pledge_id uuid, charity_name text,
  headline_value text, summary_value text, story_value text, cta_value text,
  content_hash_value text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private as $$
declare campaign_row app_private.campaigns%rowtype; revision_id uuid;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_org_admin(actor_user_id,candidate_organization_id);
  if campaign_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or exists(select 1 from app_private.reserved_route_slugs where slug=campaign_slug)
  then raise exception 'campaign slug is reserved or invalid' using errcode='23514'; end if;
  insert into app_private.campaigns
    (organization_id,slug,name,selected_charity_pledge_id,selected_charity_name,created_by)
  values (candidate_organization_id,campaign_slug,trim(campaign_name),charity_pledge_id,
    trim(charity_name),actor_user_id) returning * into campaign_row;
  insert into app_private.campaign_revisions
    (campaign_id,version,headline,summary,story,cta_label,content_hash,requested_by)
  values (campaign_row.id,1,trim(headline_value),trim(summary_value),trim(story_value),
    coalesce(nullif(trim(cta_value),''),'Donate a Phone'),content_hash_value,actor_user_id)
  returning id into revision_id;
  insert into app_private.audit_events
    (actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values ('partner',actor_user_id::text,'campaign.create','campaign',campaign_row.id,
    'partner_campaign_draft',jsonb_build_object('revision_id',revision_id),
    jsonb_build_object('organization_id',candidate_organization_id));
  return jsonb_build_object('id',campaign_row.id,'revisionId',revision_id);
end; $$;

create function api.partner_create_campaign_revision(actor_user_id uuid, candidate_campaign_id uuid,
  headline_value text, summary_value text, story_value text, cta_value text,
  hero_image_value text, content_hash_value text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private as $$
declare org_id uuid; next_version integer; revision_id uuid;
begin
  perform app_private.assert_service_role();
  select organization_id into org_id from app_private.campaigns where id=candidate_campaign_id for update;
  perform app_private.assert_org_member(actor_user_id,org_id);
  select coalesce(max(version),0)+1 into next_version from app_private.campaign_revisions
    where campaign_id=candidate_campaign_id;
  insert into app_private.campaign_revisions
    (campaign_id,version,headline,summary,story,cta_label,hero_image_url,content_hash,requested_by)
  values (candidate_campaign_id,next_version,trim(headline_value),trim(summary_value),trim(story_value),
    coalesce(nullif(trim(cta_value),''),'Donate a Phone'),nullif(trim(hero_image_value),''),
    content_hash_value,actor_user_id) returning id into revision_id;
  insert into app_private.audit_events
    (actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values ('partner',actor_user_id::text,'campaign.update_content','campaign_revision',revision_id,
    'partner_revision',jsonb_build_object('version',next_version,'content_hash',content_hash_value),
    jsonb_build_object('campaign_id',candidate_campaign_id));
  return jsonb_build_object('revisionId',revision_id,'version',next_version);
end; $$;

create function api.staff_publish_campaign_revision(actor_user_id uuid, candidate_campaign_id uuid,
  candidate_revision_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private as $$
declare old_revision uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select active_revision_id into old_revision from app_private.campaigns where id=candidate_campaign_id for update;
  if not exists(select 1 from app_private.campaign_revisions where id=candidate_revision_id
    and campaign_id=candidate_campaign_id and status='draft') then
    raise exception 'publishable revision required' using errcode='22023'; end if;
  update app_private.campaign_revisions set status='superseded'
    where id=old_revision and status='published';
  update app_private.campaign_revisions set status='published',approved_by=actor_user_id,
    published_by=actor_user_id,published_at=now() where id=candidate_revision_id;
  update app_private.campaigns set active_revision_id=candidate_revision_id,status='published',updated_at=now()
    where id=candidate_campaign_id;
  insert into app_private.audit_events
    (actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values ('staff',actor_user_id::text,'campaign.publish_revision','campaign',candidate_campaign_id,
    'staff_publication',jsonb_build_object('from_revision',old_revision,'to_revision',candidate_revision_id),
    jsonb_build_object('verified_after_publish',false));
  return jsonb_build_object('ok',true,'slug',(select slug from app_private.campaigns where id=candidate_campaign_id));
end; $$;

create function api.get_public_campaign(campaign_slug text)
returns jsonb language plpgsql security definer stable
set search_path = pg_catalog, app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object('id',c.id,'slug',c.slug,'name',c.name,
    'charityPledgeId',c.selected_charity_pledge_id,'charityName',c.selected_charity_name,
    'headline',r.headline,'summary',r.summary,'story',r.story,'ctaLabel',r.cta_label,
    'heroImageUrl',r.hero_image_url,'revision',r.version,'contentHash',r.content_hash)
    into result from app_private.campaigns c join app_private.campaign_revisions r
      on r.id=c.active_revision_id where c.slug=lower(trim(campaign_slug)) and c.status='published'
      and r.status='published';
  return result;
end; $$;

create function api.resolve_campaign_alias(candidate_slug text)
returns jsonb language plpgsql security definer stable
set search_path = pg_catalog, app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object('campaignId',campaign_id,'canonicalSlug',canonical_slug,'behavior',behavior)
    into result from app_private.campaign_route_aliases
    where root_slug=lower(trim(candidate_slug)) and status='active';
  return result;
end; $$;

create function api.attach_campaign_to_donation(candidate_donation_id uuid, campaign_slug text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private as $$
declare campaign_row app_private.campaigns%rowtype; donation_charity uuid;
begin
  perform app_private.assert_service_role();
  select * into campaign_row from app_private.campaigns
    where slug=lower(trim(campaign_slug)) and status='published';
  select selected_charity_pledge_id into donation_charity from app_private.donations
    where id=candidate_donation_id for update;
  if campaign_row.id is null or donation_charity is distinct from campaign_row.selected_charity_pledge_id then
    raise exception 'campaign does not match selected charity' using errcode='22023'; end if;
  update app_private.donations set campaign_id=campaign_row.id,updated_at=now()
    where id=candidate_donation_id and campaign_id is null;
  insert into app_private.campaign_events(campaign_id,event_type)
    values(campaign_row.id,'donation_submitted');
  insert into app_private.audit_events
    (actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('system','campaign-attribution','campaign.attribute_donation','donation',candidate_donation_id,
    'validated_campaign_charity_match',jsonb_build_object('campaign_id',campaign_row.id),
    jsonb_build_object('pii_redacted',true));
  return jsonb_build_object('campaignId',campaign_row.id,'campaignSlug',campaign_row.slug);
end; $$;

create function api.staff_financial_overview(actor_user_id uuid)
returns jsonb language plpgsql security definer stable
set search_path = pg_catalog, app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select jsonb_build_object(
    'policyHolds',(select count(*) from app_private.donations where policy_resolution_status='policy_hold'),
    'failedOutbox',(select count(*) from app_private.outbox_events where status='failed'),
    'openEscalations',(select count(*) from app_private.agent_escalations where status='open'),
    'allocations',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'donationId',a.donation_id,
      'status',a.status,'grossCents',a.gross_cents,'eligibleCostCents',a.eligible_cost_cents,
      'allocatedCents',a.allocated_cents,'createdAt',a.created_at) order by a.created_at desc)
      from app_private.proceeds_allocations a),'[]'::jsonb),
    'disbursements',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'status',d.status,
      'preparationId',d.preparation_id,'completedAt',d.completed_at) order by d.created_at desc)
      from app_private.disbursements d),'[]'::jsonb)
  ) into result; return result;
end; $$;

create function api.staff_campaign_overview(actor_user_id uuid)
returns jsonb language plpgsql security definer stable
set search_path = pg_catalog, app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select jsonb_build_object('campaigns',coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'name',c.name,'slug',c.slug,'status',c.status,
    'organizationName',o.name,'charityName',c.selected_charity_name,
    'activeRevisionId',c.active_revision_id,
    'revisions',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,'version',r.version,'status',r.status,'headline',r.headline,
      'summary',r.summary,'contentHash',r.content_hash,'createdAt',r.created_at
    ) order by r.version desc),'[]'::jsonb) from app_private.campaign_revisions r where r.campaign_id=c.id)
  ) order by c.updated_at desc),'[]'::jsonb)) into result
  from app_private.campaigns c join app_private.organizations o on o.id=c.organization_id;
  return result;
end; $$;

create function api.staff_record_sale_and_allocation(actor_user_id uuid, candidate_device_id uuid,
  gross_value_cents bigint, sale_channel text, external_ref text, sold_time timestamptz)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private as $$
declare donation_row app_private.donations%rowtype; sale_id uuid; allocation_id uuid;
  eligible_costs bigint := 0; base bigint; share integer; allocated bigint;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select d.* into donation_row from app_private.donations d join app_private.donation_devices x
    on x.donation_id=d.id where x.id=candidate_device_id for update;
  if not found then raise exception 'device not found' using errcode='22023'; end if;
  insert into app_private.device_sale_results
    (device_id,gross_amount_cents,channel,external_reference,sold_at,recorded_by)
  values (candidate_device_id,gross_value_cents,trim(sale_channel),nullif(trim(external_ref),''),sold_time,actor_user_id)
  returning id into sale_id;
  select coalesce(sum(amount_cents),0) into eligible_costs from app_private.donation_costs
    where donation_id=donation_row.id and status='recorded';
  base := greatest(gross_value_cents-eligible_costs,0);
  if donation_row.policy_version_snapshot_id is not null then
    select share_basis_points into share from app_private.proceeds_policy_versions
      where id=donation_row.policy_version_snapshot_id and lifecycle in ('approved','active');
  end if;
  allocated := case when share is null then null else floor(base*share/10000.0)::bigint end;
  insert into app_private.proceeds_allocations
    (donation_id,policy_version_id,beneficiary_pledge_id,gross_cents,eligible_cost_cents,
     allocable_base_cents,share_basis_points,allocated_cents,status,calculation_snapshot,calculated_by,calculated_at)
  values (donation_row.id,donation_row.policy_version_snapshot_id,donation_row.selected_charity_pledge_id,
    gross_value_cents,eligible_costs,base,share,allocated,
    (case when share is null then 'policy_hold' else 'calculated' end)::app_private.allocation_status,
    jsonb_build_object('sale_id',sale_id,'calculation','gross_minus_recorded_costs_times_share'),actor_user_id,now())
  returning id into allocation_id;
  insert into app_private.audit_events
    (actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values ('staff',actor_user_id::text,'finance.record_sale','sale_result',sale_id,
    'staff_financial_entry',jsonb_build_object('gross_cents',gross_value_cents,
      'allocation_status',case when share is null then 'policy_hold' else 'calculated' end),
    jsonb_build_object('allocation_id',allocation_id,'donation_id',donation_row.id));
  return jsonb_build_object('saleId',sale_id,'allocationId',allocation_id,
    'allocationStatus',case when share is null then 'policy_hold' else 'calculated' end);
end; $$;

-- The policy evaluator records every decision. High-risk physical and financial
-- commands remain denied even when routine content work is later automated.
create function api.evaluate_agent_command(agent_identity text, command_value text,
  target_kind text, target_value uuid, risk_value app_private.risk_level,
  facts jsonb, input_hash_value text, correlation_value uuid, idempotency_value text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private as $$
declare policy_id uuid; rule_id uuid; decision_outcome app_private.action_policy_outcome;
  rationale text; decision_id uuid; action_id uuid;
begin
  perform app_private.assert_service_role();
  if command_value in ('record_physical_receipt','inspect_device','verify_data_wipe',
    'value_device','execute_disbursement','manage_credentials','execute_sql','deploy_production') then
    decision_outcome := 'DENY'; rationale := 'human_or_prohibited_action';
  else
    select v.id,r.id,r.outcome,r.rationale_code into policy_id,rule_id,decision_outcome,rationale
    from app_private.action_policy_versions v join app_private.action_policy_rules r
      on r.policy_version_id=v.id
    where v.lifecycle='active' and now() >= v.effective_from
      and (v.effective_to is null or now() < v.effective_to)
      and r.actor='agent' and (r.command_name=command_value or r.command_name='*')
      and risk_value=any(r.risk_levels) and (r.target_type is null or r.target_type=target_kind)
    order by (r.command_name=command_value) desc,r.priority desc limit 1;
    if decision_outcome is null then decision_outcome:='ESCALATE'; rationale:='no_matching_policy'; end if;
  end if;
  insert into app_private.action_decisions
    (policy_version_id,policy_rule_id,command_name,actor,actor_ref,target_type,target_id,risk,
     context,outcome,rationale_code,input_hash,correlation_id,idempotency_key)
  values (policy_id,rule_id,command_value,'agent',agent_identity,target_kind,target_value,risk_value,
    coalesce(facts,'{}'::jsonb),decision_outcome,rationale,input_hash_value,correlation_value,idempotency_value)
  on conflict (actor,actor_ref,idempotency_key) where idempotency_key is not null do update
    set idempotency_key=excluded.idempotency_key returning id,outcome,rationale_code into decision_id,decision_outcome,rationale;
  insert into app_private.agent_actions (action_decision_id,agent_ref,status,invocation_metadata)
  values (decision_id,agent_identity,
    (case decision_outcome when 'ALLOW_AUTOMATICALLY' then 'approved'
      when 'DENY' then 'cancelled' else 'proposed' end)::app_private.agent_action_status,
    jsonb_build_object('target_type',target_kind,'pii_redacted',true))
  on conflict (action_decision_id) do update set updated_at=now() returning id into action_id;
  if decision_outcome='ESCALATE' then
    insert into app_private.agent_escalations(agent_action_id,severity,reason_code,summary)
    values(action_id,risk_value,rationale,'Command requires staff review.') on conflict do nothing;
  end if;
  return jsonb_build_object('decisionId',decision_id,'agentActionId',action_id,
    'outcome',decision_outcome,'rationaleCode',rationale);
end; $$;

-- Extend donation intake with an optional validated campaign id without changing
-- existing callers. The campaign must match the selected nonprofit.
create or replace function app_private.assign_campaign_to_donation()
returns trigger language plpgsql set search_path=pg_catalog,app_private as $$ begin return new; end; $$;

do $$ declare table_name text; begin
  foreach table_name in array array[
    'donation_shipments','device_sale_results','donation_costs','proceeds_allocations',
    'disbursement_preparations','disbursement_preparation_allocations','disbursement_approvals',
    'disbursements','campaigns','campaign_revisions','campaign_assets','campaign_events',
    'communication_threads','communication_messages'
  ] loop execute format('alter table app_private.%I enable row level security',table_name); end loop;
end $$;

revoke all on all tables in schema app_private from public,anon,authenticated;
revoke all on all functions in schema api from public,anon,authenticated;
revoke all on function app_private.assert_org_member(uuid,uuid) from public,anon,authenticated;
revoke all on function app_private.assert_org_admin(uuid,uuid) from public,anon,authenticated;

grant select,insert,update,delete on table app_private.donation_shipments to service_role;
grant select,insert on table app_private.device_sale_results,app_private.donation_costs,
  app_private.proceeds_allocations,app_private.disbursement_preparations,
  app_private.disbursement_preparation_allocations,app_private.disbursement_approvals to service_role;
grant select,insert,update on table app_private.disbursements,app_private.campaigns,
  app_private.campaign_revisions,app_private.campaign_assets,
  app_private.communication_threads,app_private.communication_messages to service_role;
grant select,insert on table app_private.campaign_events to service_role;
grant execute on function api.donor_account_overview(uuid,text) to service_role;
grant execute on function api.donor_mark_donation_mailed(uuid,text,uuid,text,text) to service_role;
grant execute on function api.partner_overview(uuid) to service_role;
grant execute on function api.partner_campaign_detail(uuid,uuid) to service_role;
grant execute on function api.partner_create_campaign(uuid,uuid,text,text,uuid,text,text,text,text,text,text) to service_role;
grant execute on function api.partner_create_campaign_revision(uuid,uuid,text,text,text,text,text,text) to service_role;
grant execute on function api.staff_publish_campaign_revision(uuid,uuid,uuid) to service_role;
grant execute on function api.get_public_campaign(text) to service_role;
grant execute on function api.resolve_campaign_alias(text) to service_role;
grant execute on function api.attach_campaign_to_donation(uuid,text) to service_role;
grant execute on function api.staff_financial_overview(uuid) to service_role;
grant execute on function api.staff_campaign_overview(uuid) to service_role;
grant execute on function api.staff_record_sale_and_allocation(uuid,uuid,bigint,text,text,timestamptz) to service_role;
grant execute on function api.evaluate_agent_command(text,text,text,uuid,app_private.risk_level,jsonb,text,uuid,text) to service_role;
