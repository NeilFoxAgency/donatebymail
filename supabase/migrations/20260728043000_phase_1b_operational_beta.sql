-- Phase 1B: persistent donation intake, donor-safe tracking, and the minimum
-- human-operated staff workflow. All operational tables remain private; the
-- exposed schema contains only narrowly scoped, service-only RPCs.

create type app_private.donation_status as enum (
  'submitted', 'in_transit', 'received', 'inspecting', 'processing',
  'completed', 'exception', 'cancelled'
);
create type app_private.device_source as enum ('expected', 'unexpected');
create type app_private.device_receipt_status as enum (
  'expected', 'received', 'missing', 'unexpected'
);
create type app_private.device_inspection_status as enum (
  'pending', 'inspecting', 'inspected', 'blocked'
);
create type app_private.device_processing_status as enum (
  'pending', 'reuse', 'resale', 'parts', 'recycle', 'returned', 'complete'
);
create type app_private.data_wipe_status as enum (
  'not_started', 'pending', 'completed', 'not_required', 'blocked'
);

create table app_private.donor_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  first_name text not null check (char_length(first_name) between 1 and 120),
  middle_name text check (middle_name is null or char_length(middle_name) <= 120),
  last_name text not null check (char_length(last_name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 320),
  email_search text not null check (email_search = lower(email_search)),
  address_line_1 text not null check (char_length(address_line_1) between 1 and 240),
  address_line_2 text check (address_line_2 is null or char_length(address_line_2) <= 240),
  city text not null check (char_length(city) between 1 and 160),
  region text check (region is null or char_length(region) <= 160),
  postal_code text check (postal_code is null or char_length(postal_code) <= 32),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  marketing_email_consent boolean not null default false,
  marketing_consent_at timestamptz,
  storage_format_version integer not null default 1 check (storage_format_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (marketing_email_consent or marketing_consent_at is null)
);

create index donor_contacts_user_id_idx
  on app_private.donor_contacts (user_id) where user_id is not null;
create index donor_contacts_email_search_idx
  on app_private.donor_contacts (email_search);

create table app_private.donations (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique
    check (public_id ~ '^DBM-[0-9]{8}-[A-F0-9]{8}$'),
  client_submission_key text not null unique
    check (char_length(client_submission_key) between 8 and 120),
  donor_contact_id uuid not null
    references app_private.donor_contacts(id) on delete restrict,
  status app_private.donation_status not null default 'submitted',
  shipping_method text not null check (shipping_method = 'label'),
  selected_charity_pledge_id uuid not null,
  selected_charity_name text not null
    check (char_length(selected_charity_name) between 1 and 240),
  selected_charity_ein text check (
    selected_charity_ein is null or char_length(selected_charity_ein) <= 32
  ),
  selected_charity_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(selected_charity_metadata) = 'object'),
  tracking_nonce uuid not null unique,
  policy_version_snapshot_id uuid
    references app_private.proceeds_policy_versions(id) on delete restrict,
  policy_resolution_status text not null default 'policy_hold'
    check (policy_resolution_status in ('resolved', 'policy_hold')),
  package_condition text check (
    package_condition is null or char_length(package_condition) <= 500
  ),
  received_at timestamptz,
  received_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('received', 'inspecting', 'processing', 'completed') or received_at is not null),
  check (status <> 'completed' or completed_at is not null)
);

create index donations_donor_contact_idx
  on app_private.donations (donor_contact_id, created_at desc);
create index donations_status_created_idx
  on app_private.donations (status, created_at desc);
create index donations_received_by_idx
  on app_private.donations (received_by) where received_by is not null;
create index donations_recent_idx on app_private.donations (created_at desc);

create table app_private.donation_devices (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null references app_private.donations(id) on delete cascade,
  source app_private.device_source not null default 'expected',
  donor_device_key text check (
    donor_device_key is null or char_length(donor_device_key) between 1 and 120
  ),
  donor_brand text check (donor_brand is null or char_length(donor_brand) <= 80),
  donor_model text check (donor_model is null or char_length(donor_model) <= 160),
  donor_age text check (donor_age is null or char_length(donor_age) <= 40),
  donor_condition text check (donor_condition is null or char_length(donor_condition) <= 40),
  donor_storage text check (donor_storage is null or char_length(donor_storage) <= 40),
  donor_powers_on boolean,
  donor_unlocked boolean,
  receipt_status app_private.device_receipt_status not null default 'expected',
  actual_brand text check (actual_brand is null or char_length(actual_brand) <= 80),
  actual_model text check (actual_model is null or char_length(actual_model) <= 160),
  serial_last_four text check (
    serial_last_four is null or serial_last_four ~ '^[A-Za-z0-9]{4}$'
  ),
  inspection_status app_private.device_inspection_status not null default 'pending',
  processing_status app_private.device_processing_status not null default 'pending',
  data_wipe_status app_private.data_wipe_status not null default 'not_started',
  assessed_value_cents bigint check (
    assessed_value_cents is null or assessed_value_cents between 0 and 100000000
  ),
  received_at timestamptz,
  inspected_at timestamptz,
  inspected_by uuid references auth.users(id) on delete set null,
  valued_at timestamptz,
  valued_by uuid references auth.users(id) on delete set null,
  wipe_verified_at timestamptz,
  wipe_verified_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (source = 'expected' and donor_device_key is not null)
    or (source = 'unexpected' and donor_device_key is null)
  ),
  check (receipt_status <> 'received' or received_at is not null),
  check (inspection_status <> 'inspected' or inspected_at is not null),
  check (assessed_value_cents is null or (valued_at is not null and valued_by is not null)),
  check (data_wipe_status <> 'completed' or (wipe_verified_at is not null and wipe_verified_by is not null))
);

create index donation_devices_donation_idx
  on app_private.donation_devices (donation_id, created_at);
create unique index donation_devices_expected_key_idx
  on app_private.donation_devices (donation_id, donor_device_key)
  where donor_device_key is not null;
create index donation_devices_inspected_by_idx
  on app_private.donation_devices (inspected_by) where inspected_by is not null;
create index donation_devices_valued_by_idx
  on app_private.donation_devices (valued_by) where valued_by is not null;
create index donation_devices_wipe_verified_by_idx
  on app_private.donation_devices (wipe_verified_by) where wipe_verified_by is not null;

create table app_private.donation_status_events (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null references app_private.donations(id) on delete cascade,
  status app_private.donation_status not null,
  donor_visible boolean not null default true,
  public_message text check (
    public_message is null or char_length(public_message) between 1 and 500
  ),
  actor app_private.actor_kind not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now()
);

create index donation_status_events_donation_idx
  on app_private.donation_status_events (donation_id, occurred_at desc);
create index donation_status_events_actor_user_idx
  on app_private.donation_status_events (actor_user_id) where actor_user_id is not null;

create table app_private.donation_internal_notes (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null references app_private.donations(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index donation_internal_notes_donation_idx
  on app_private.donation_internal_notes (donation_id, created_at desc);
create index donation_internal_notes_created_by_idx
  on app_private.donation_internal_notes (created_by);

create table app_private.donor_account_links (
  donor_contact_id uuid not null
    references app_private.donor_contacts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (donor_contact_id, user_id)
);

create index donor_account_links_user_idx
  on app_private.donor_account_links (user_id, linked_at desc);

create trigger donation_status_events_append_only
before update or delete on app_private.donation_status_events
for each row execute function app_private.prevent_update_or_delete();

create trigger donation_internal_notes_append_only
before update or delete on app_private.donation_internal_notes
for each row execute function app_private.prevent_update_or_delete();

create function app_private.assert_service_role()
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  if coalesce(
    current_setting('request.jwt.claim.role', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    ''
  ) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
end;
$$;

create function app_private.assert_active_staff(actor_user_id uuid)
returns void
language plpgsql
set search_path = pg_catalog, app_private
as $$
begin
  if actor_user_id is null or not exists (
    select 1 from app_private.staff_memberships
    where user_id = actor_user_id and status = 'active'
  ) then
    raise exception 'active staff membership required' using errcode = '42501';
  end if;
end;
$$;

create function app_private.new_donation_public_id(created_time timestamptz)
returns text
language plpgsql
set search_path = pg_catalog, extensions, app_private
as $$
declare
  candidate text;
begin
  loop
    candidate := 'DBM-' || to_char(created_time at time zone 'UTC', 'YYYYMMDD')
      || '-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 8));
    exit when not exists (
      select 1 from app_private.donations where public_id = candidate
    );
  end loop;
  return candidate;
end;
$$;

create function app_private.valid_donation_transition(
  old_status app_private.donation_status,
  new_status app_private.donation_status
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select old_status = new_status or (old_status, new_status) in (
    ('submitted', 'in_transit'), ('submitted', 'received'),
    ('submitted', 'cancelled'), ('submitted', 'exception'),
    ('in_transit', 'received'), ('in_transit', 'exception'),
    ('in_transit', 'cancelled'), ('received', 'inspecting'),
    ('received', 'processing'), ('received', 'exception'),
    ('inspecting', 'processing'), ('inspecting', 'exception'),
    ('processing', 'completed'), ('processing', 'exception'),
    ('exception', 'received'), ('exception', 'inspecting'),
    ('exception', 'processing'), ('exception', 'cancelled')
  );
$$;

create function api.create_donation(payload jsonb, tracking_nonce uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions, app_private
as $$
declare
  existing app_private.donations%rowtype;
  contact_id uuid;
  donation_row app_private.donations%rowtype;
  domain_event_id uuid;
  outbox_id uuid;
  submitted_device jsonb;
  created_time timestamptz := now();
  donor jsonb := payload -> 'donor';
  charity jsonb := payload -> 'charity';
  client_key text := trim(payload ->> 'id');
begin
  perform app_private.assert_service_role();
  if jsonb_typeof(payload) <> 'object'
     or char_length(client_key) not between 8 and 120 then
    raise exception 'invalid donation payload' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(client_key, 741));
  select * into existing from app_private.donations
  where client_submission_key = client_key;
  if found then
    return jsonb_build_object(
      'created', false, 'donationId', existing.id,
      'publicId', existing.public_id, 'createdAt', existing.created_at,
      'outboxEventId', null
    );
  end if;

  if jsonb_typeof(donor) <> 'object'
     or jsonb_typeof(charity) <> 'object'
     or jsonb_typeof(payload -> 'devices') <> 'array'
     or jsonb_array_length(payload -> 'devices') not between 1 and 20 then
    raise exception 'invalid donation payload' using errcode = '22023';
  end if;

  insert into app_private.donor_contacts (
    first_name, middle_name, last_name, email, email_search,
    address_line_1, address_line_2, city, region, postal_code, country_code,
    marketing_email_consent, marketing_consent_at
  ) values (
    trim(donor ->> 'firstName'), nullif(trim(donor ->> 'middleName'), ''),
    trim(donor ->> 'lastName'), trim(donor ->> 'email'),
    lower(trim(donor ->> 'email')), trim(donor ->> 'address1'),
    nullif(trim(donor ->> 'address2'), ''), trim(donor ->> 'city'),
    nullif(trim(donor ->> 'state'), ''), nullif(trim(donor ->> 'zip'), ''),
    upper(trim(donor ->> 'country')),
    coalesce((donor ->> 'marketingEmailConsent')::boolean, false),
    case when coalesce((donor ->> 'marketingEmailConsent')::boolean, false)
      then coalesce((donor ->> 'marketingConsentAt')::timestamptz, created_time)
      else null end
  ) returning id into contact_id;

  insert into app_private.donations (
    public_id, client_submission_key, donor_contact_id, shipping_method,
    selected_charity_pledge_id, selected_charity_name, selected_charity_ein,
    selected_charity_metadata, tracking_nonce, created_at, updated_at
  ) values (
    app_private.new_donation_public_id(created_time), client_key, contact_id,
    trim(payload ->> 'shippingMethod'), (charity ->> 'pledgeId')::uuid,
    trim(charity ->> 'name'), nullif(trim(charity ->> 'ein'), ''),
    jsonb_strip_nulls(jsonb_build_object(
      'city', charity ->> 'city', 'state', charity ->> 'state',
      'country', charity ->> 'country', 'websiteUrl', charity ->> 'websiteUrl',
      'logoUrl', charity ->> 'logoUrl'
    )), tracking_nonce, created_time, created_time
  ) returning * into donation_row;

  for submitted_device in select value from jsonb_array_elements(payload -> 'devices')
  loop
    insert into app_private.donation_devices (
      donation_id, source, donor_device_key, donor_brand, donor_model,
      donor_age, donor_condition, donor_storage, donor_powers_on, donor_unlocked
    ) values (
      donation_row.id, 'expected', trim(submitted_device ->> 'id'),
      trim(submitted_device ->> 'brand'), nullif(trim(submitted_device ->> 'model'), ''),
      trim(submitted_device ->> 'age'), trim(submitted_device ->> 'condition'),
      trim(submitted_device ->> 'storage'),
      (submitted_device ->> 'powersOn')::boolean,
      (submitted_device ->> 'unlocked')::boolean
    );
  end loop;

  insert into app_private.donation_status_events (
    donation_id, status, donor_visible, public_message, actor
  ) values (
    donation_row.id, 'submitted', true,
    'Donation packet created. Mail the prepared package when ready.', 'donor'
  );

  insert into app_private.audit_events (
    actor, actor_ref, action_name, entity_type, entity_id,
    reason_code, redacted_changes, metadata
  ) values (
    'donor', donation_row.id::text, 'donation.submit', 'donation', donation_row.id,
    'donor_submission',
    jsonb_build_object(
      'device_count', jsonb_array_length(payload -> 'devices'),
      'marketing_email_consent', coalesce((donor ->> 'marketingEmailConsent')::boolean, false)
    ), jsonb_build_object('pii_redacted', true)
  );

  insert into app_private.domain_events (
    event_type, aggregate_type, aggregate_id, aggregate_version, payload
  ) values (
    'donation.created', 'donation', donation_row.id, 1,
    jsonb_build_object('donationId', donation_row.id, 'publicId', donation_row.public_id)
  ) returning id into domain_event_id;

  insert into app_private.outbox_events (
    domain_event_id, handler_key, event_type, payload
  ) values (
    domain_event_id, 'donation_notifications', 'donation.created',
    jsonb_build_object('donationId', donation_row.id)
  ) returning id into outbox_id;

  return jsonb_build_object(
    'created', true, 'donationId', donation_row.id,
    'publicId', donation_row.public_id, 'createdAt', donation_row.created_at,
    'outboxEventId', outbox_id
  );
end;
$$;

create function api.get_donation_tracking_material(candidate_public_id text)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object('donationId', id, 'trackingNonce', tracking_nonce)
    into result
  from app_private.donations where public_id = upper(trim(candidate_public_id));
  return result;
end;
$$;

create function api.get_donation_status(candidate_public_id text)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object(
    'donationId', d.id, 'publicId', d.public_id, 'status', d.status,
    'charityName', d.selected_charity_name, 'createdAt', d.created_at,
    'receivedAt', d.received_at, 'completedAt', d.completed_at,
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', device.id, 'source', device.source,
        'label', trim(concat_ws(' ', coalesce(device.actual_brand, device.donor_brand),
          coalesce(device.actual_model, device.donor_model))),
        'receiptStatus', device.receipt_status,
        'inspectionStatus', device.inspection_status,
        'processingStatus', device.processing_status,
        'dataWipeStatus', device.data_wipe_status
      ) order by device.created_at)
      from app_private.donation_devices device where device.donation_id = d.id
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'status', event.status, 'message', event.public_message,
        'occurredAt', event.occurred_at
      ) order by event.occurred_at)
      from app_private.donation_status_events event
      where event.donation_id = d.id and event.donor_visible
    ), '[]'::jsonb)
  ) into result
  from app_private.donations d where d.public_id = upper(trim(candidate_public_id));
  return result;
end;
$$;

create function api.get_donation_notification_payload(candidate_donation_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object(
    'donationId', d.id, 'publicId', d.public_id, 'status', d.status,
    'createdAt', d.created_at, 'trackingNonce', d.tracking_nonce,
    'charityName', d.selected_charity_name,
    'charityPledgeId', d.selected_charity_pledge_id,
    'donor', jsonb_build_object(
      'firstName', c.first_name, 'middleName', coalesce(c.middle_name, ''),
      'lastName', c.last_name, 'email', c.email,
      'address1', c.address_line_1, 'address2', coalesce(c.address_line_2, ''),
      'city', c.city, 'state', coalesce(c.region, ''),
      'zip', coalesce(c.postal_code, ''), 'country', c.country_code,
      'marketingEmailConsent', c.marketing_email_consent,
      'marketingConsentAt', c.marketing_consent_at
    ),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', device.donor_device_key, 'brand', device.donor_brand,
        'model', coalesce(device.donor_model, ''), 'age', device.donor_age,
        'condition', device.donor_condition, 'storage', device.donor_storage,
        'powersOn', device.donor_powers_on, 'unlocked', device.donor_unlocked
      ) order by device.created_at)
      from app_private.donation_devices device
      where device.donation_id = d.id and device.source = 'expected'
    ), '[]'::jsonb)
  ) into result
  from app_private.donations d
  join app_private.donor_contacts c on c.id = d.donor_contact_id
  where d.id = candidate_donation_id;
  return result;
end;
$$;

create function api.is_active_staff_email(candidate_email text)
returns boolean
language plpgsql
security definer
stable
set search_path = pg_catalog, app_private, auth
as $$
begin
  perform app_private.assert_service_role();
  return exists (
    select 1 from auth.users u
    join app_private.staff_memberships sm on sm.user_id = u.id
    where lower(u.email) = lower(trim(candidate_email)) and sm.status = 'active'
  );
end;
$$;

create function api.is_active_staff_user(candidate_user_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.assert_service_role();
  return exists (
    select 1 from app_private.staff_memberships
    where user_id = candidate_user_id and status = 'active'
  );
end;
$$;

create function api.staff_search_donations(
  actor_user_id uuid,
  search_term text default '',
  result_limit integer default 25
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
declare normalized text := lower(trim(coalesce(search_term, '')));
begin
  perform app_private.assert_service_role();
  perform app_private.assert_active_staff(actor_user_id);
  if char_length(normalized) > 160 or result_limit not between 1 and 50 then
    raise exception 'invalid search bounds' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(item order by item_created_at desc), '[]'::jsonb)
    into result
  from (
    select jsonb_build_object(
      'id', d.id, 'publicId', d.public_id, 'status', d.status,
      'donorName', trim(concat_ws(' ', c.first_name, c.middle_name, c.last_name)),
      'donorEmail', c.email, 'charityName', d.selected_charity_name,
      'deviceCount', (select count(*) from app_private.donation_devices dv where dv.donation_id = d.id),
      'createdAt', d.created_at, 'receivedAt', d.received_at
    ) item, d.created_at item_created_at
    from app_private.donations d
    join app_private.donor_contacts c on c.id = d.donor_contact_id
    where normalized = ''
       or lower(d.public_id) like '%' || normalized || '%'
       or c.email_search like '%' || normalized || '%'
       or lower(trim(concat_ws(' ', c.first_name, c.middle_name, c.last_name))) like '%' || normalized || '%'
       or lower(d.selected_charity_name) like '%' || normalized || '%'
    order by d.created_at desc
    limit result_limit
  ) matches;
  return result;
end;
$$;

create function api.staff_get_donation(actor_user_id uuid, candidate_donation_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_active_staff(actor_user_id);
  select jsonb_build_object(
    'id', d.id, 'publicId', d.public_id, 'status', d.status,
    'createdAt', d.created_at, 'receivedAt', d.received_at,
    'completedAt', d.completed_at, 'packageCondition', d.package_condition,
    'charity', jsonb_build_object('name', d.selected_charity_name,
      'pledgeId', d.selected_charity_pledge_id, 'ein', d.selected_charity_ein),
    'donor', jsonb_build_object(
      'name', trim(concat_ws(' ', c.first_name, c.middle_name, c.last_name)),
      'email', c.email, 'address1', c.address_line_1,
      'address2', coalesce(c.address_line_2, ''), 'city', c.city,
      'state', coalesce(c.region, ''), 'zip', coalesce(c.postal_code, ''),
      'country', c.country_code
    ),
    'devices', coalesce((select jsonb_agg(to_jsonb(device) - 'donation_id' order by device.created_at)
      from app_private.donation_devices device where device.donation_id = d.id), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object(
      'id', note.id, 'body', note.body, 'createdBy', note.created_by,
      'createdAt', note.created_at) order by note.created_at desc)
      from app_private.donation_internal_notes note where note.donation_id = d.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
      'status', event.status, 'message', event.public_message,
      'donorVisible', event.donor_visible, 'occurredAt', event.occurred_at)
      order by event.occurred_at desc)
      from app_private.donation_status_events event where event.donation_id = d.id), '[]'::jsonb)
  ) into result
  from app_private.donations d
  join app_private.donor_contacts c on c.id = d.donor_contact_id
  where d.id = candidate_donation_id;
  return result;
end;
$$;

create function api.staff_record_receipt(
  actor_user_id uuid,
  candidate_donation_id uuid,
  receipt_time timestamptz,
  package_condition text,
  device_receipts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
declare current_status app_private.donation_status;
declare receipt jsonb;
declare changed_count integer := 0;
declare domain_event_id uuid;
declare outbox_id uuid;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_active_staff(actor_user_id);
  if receipt_time is null or receipt_time > now() + interval '5 minutes'
     or jsonb_typeof(device_receipts) <> 'array'
     or $4 is null or char_length(trim($4)) not between 1 and 500 then
    raise exception 'invalid receipt payload' using errcode = '22023';
  end if;
  select status into current_status from app_private.donations
    where id = candidate_donation_id for update;
  if not found or current_status not in ('submitted', 'in_transit', 'exception') then
    raise exception 'donation cannot be received from current status' using errcode = '22023';
  end if;

  for receipt in select value from jsonb_array_elements(device_receipts)
  loop
    update app_private.donation_devices
      set receipt_status = case when coalesce((receipt ->> 'received')::boolean, false)
          then 'received'::app_private.device_receipt_status
          else 'missing'::app_private.device_receipt_status end,
          received_at = case when coalesce((receipt ->> 'received')::boolean, false)
            then receipt_time else null end,
          updated_at = now()
      where id = (receipt ->> 'deviceId')::uuid and donation_id = candidate_donation_id;
    if found then changed_count := changed_count + 1; end if;
  end loop;
  if changed_count <> jsonb_array_length(device_receipts) then
    raise exception 'receipt includes an unknown device' using errcode = '22023';
  end if;

  update app_private.donations set status = 'received', received_at = receipt_time,
    received_by = actor_user_id, package_condition = trim($4), updated_at = now()
  where id = candidate_donation_id;
  insert into app_private.donation_status_events (
    donation_id, status, donor_visible, public_message, actor, actor_user_id, occurred_at
  ) values (
    candidate_donation_id, 'received', true,
    'Your package has arrived at Donate by Mail and is awaiting inspection.',
    'staff', actor_user_id, receipt_time
  );
  insert into app_private.audit_events (
    actor, actor_ref, action_name, entity_type, entity_id,
    reason_code, redacted_changes, metadata
  ) values (
    'staff', actor_user_id::text, 'donation.record_physical_receipt',
    'donation', candidate_donation_id, 'physical_package_received',
    jsonb_build_object('status', jsonb_build_object('from', current_status, 'to', 'received'),
      'device_receipts_recorded', changed_count),
    jsonb_build_object('package_condition_redacted', true)
  );
  insert into app_private.domain_events (
    event_type, aggregate_type, aggregate_id, aggregate_version, payload
  ) values (
    'donation.received', 'donation', candidate_donation_id, 2,
    jsonb_build_object('donationId', candidate_donation_id)
  ) returning id into domain_event_id;
  insert into app_private.outbox_events (domain_event_id, handler_key, event_type, payload)
  values (domain_event_id, 'donation_notifications', 'donation.received',
    jsonb_build_object('donationId', candidate_donation_id)) returning id into outbox_id;
  return jsonb_build_object('ok', true, 'outboxEventId', outbox_id);
end;
$$;

create function api.staff_update_device(
  actor_user_id uuid,
  candidate_donation_id uuid,
  candidate_device_id uuid,
  patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
declare existing app_private.donation_devices%rowtype;
declare next_inspection app_private.device_inspection_status;
declare next_processing app_private.device_processing_status;
declare next_wipe app_private.data_wipe_status;
declare next_value bigint;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_active_staff(actor_user_id);
  if jsonb_typeof(patch) <> 'object' then
    raise exception 'invalid device patch' using errcode = '22023';
  end if;
  select * into existing from app_private.donation_devices
    where id = candidate_device_id and donation_id = candidate_donation_id for update;
  if not found then raise exception 'device not found' using errcode = '22023'; end if;

  next_inspection := coalesce((patch ->> 'inspectionStatus')::app_private.device_inspection_status, existing.inspection_status);
  next_processing := coalesce((patch ->> 'processingStatus')::app_private.device_processing_status, existing.processing_status);
  next_wipe := coalesce((patch ->> 'dataWipeStatus')::app_private.data_wipe_status, existing.data_wipe_status);
  next_value := case when patch ? 'assessedValueCents'
    then nullif(patch ->> 'assessedValueCents', '')::bigint else existing.assessed_value_cents end;

  update app_private.donation_devices set
    actual_brand = case when patch ? 'actualBrand' then nullif(trim(patch ->> 'actualBrand'), '') else actual_brand end,
    actual_model = case when patch ? 'actualModel' then nullif(trim(patch ->> 'actualModel'), '') else actual_model end,
    serial_last_four = case when patch ? 'serialLastFour' then nullif(trim(patch ->> 'serialLastFour'), '') else serial_last_four end,
    inspection_status = next_inspection,
    processing_status = next_processing,
    data_wipe_status = next_wipe,
    assessed_value_cents = next_value,
    inspected_at = case when next_inspection = 'inspected' then coalesce(inspected_at, now()) else inspected_at end,
    inspected_by = case when next_inspection = 'inspected' then actor_user_id else inspected_by end,
    valued_at = case when next_value is not null then coalesce(valued_at, now()) else null end,
    valued_by = case when next_value is not null then actor_user_id else null end,
    wipe_verified_at = case when next_wipe = 'completed' then coalesce(wipe_verified_at, now()) else null end,
    wipe_verified_by = case when next_wipe = 'completed' then actor_user_id else null end,
    updated_at = now()
  where id = candidate_device_id;

  insert into app_private.audit_events (
    actor, actor_ref, action_name, entity_type, entity_id,
    reason_code, redacted_changes, metadata
  ) values (
    'staff', actor_user_id::text, 'donation.update_device', 'donation_device',
    candidate_device_id, 'staff_inspection_update',
    jsonb_build_object('inspection_status', next_inspection,
      'processing_status', next_processing, 'data_wipe_status', next_wipe,
      'assessed_value_recorded', next_value is not null),
    jsonb_build_object('sensitive_identifiers_redacted', true)
  );
  return jsonb_build_object('ok', true);
end;
$$;

create function api.staff_add_unexpected_device(
  actor_user_id uuid,
  candidate_donation_id uuid,
  actual_brand text,
  actual_model text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
declare device_id uuid;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_active_staff(actor_user_id);
  if char_length(trim(actual_brand)) not between 1 and 80
     or char_length(trim(actual_model)) not between 1 and 160 then
    raise exception 'invalid unexpected device' using errcode = '22023';
  end if;
  if not exists (select 1 from app_private.donations where id = candidate_donation_id) then
    raise exception 'donation not found' using errcode = '22023';
  end if;
  insert into app_private.donation_devices (
    donation_id, source, receipt_status, actual_brand, actual_model, received_at
  ) values (
    candidate_donation_id, 'unexpected', 'unexpected', trim(actual_brand),
    trim(actual_model), now()
  ) returning id into device_id;
  insert into app_private.audit_events (
    actor, actor_ref, action_name, entity_type, entity_id,
    reason_code, redacted_changes, metadata
  ) values (
    'staff', actor_user_id::text, 'donation.add_unexpected_device',
    'donation_device', device_id, 'physical_device_found',
    jsonb_build_object('source', 'unexpected'), '{}'::jsonb
  );
  return jsonb_build_object('ok', true, 'deviceId', device_id);
end;
$$;

create function api.staff_change_donation_status(
  actor_user_id uuid,
  candidate_donation_id uuid,
  new_status app_private.donation_status,
  public_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
declare old_status app_private.donation_status;
declare domain_event_id uuid;
declare outbox_id uuid;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_active_staff(actor_user_id);
  select status into old_status from app_private.donations
    where id = candidate_donation_id for update;
  if not found or not app_private.valid_donation_transition(old_status, new_status) then
    raise exception 'invalid donation status transition' using errcode = '22023';
  end if;
  if public_message is not null and char_length(trim(public_message)) not between 1 and 500 then
    raise exception 'invalid public message' using errcode = '22023';
  end if;
  update app_private.donations set status = new_status,
    completed_at = case when new_status = 'completed' then coalesce(completed_at, now()) else completed_at end,
    updated_at = now() where id = candidate_donation_id;
  insert into app_private.donation_status_events (
    donation_id, status, donor_visible, public_message, actor, actor_user_id
  ) values (
    candidate_donation_id, new_status, public_message is not null,
    nullif(trim(public_message), ''), 'staff', actor_user_id
  );
  insert into app_private.audit_events (
    actor, actor_ref, action_name, entity_type, entity_id,
    reason_code, redacted_changes, metadata
  ) values (
    'staff', actor_user_id::text, 'donation.change_status', 'donation',
    candidate_donation_id, 'staff_status_update',
    jsonb_build_object('status', jsonb_build_object('from', old_status, 'to', new_status),
      'donor_visible_message', public_message is not null),
    jsonb_build_object('message_redacted', true)
  );
  insert into app_private.domain_events (
    event_type, aggregate_type, aggregate_id, aggregate_version, payload
  ) values (
    'donation.status_changed', 'donation', candidate_donation_id,
    (select count(*)::integer from app_private.donation_status_events where donation_id = candidate_donation_id),
    jsonb_build_object('donationId', candidate_donation_id, 'status', new_status)
  ) returning id into domain_event_id;
  if public_message is not null then
    insert into app_private.outbox_events (domain_event_id, handler_key, event_type, payload)
    values (domain_event_id, 'donation_notifications', 'donation.status_changed',
      jsonb_build_object('donationId', candidate_donation_id)) returning id into outbox_id;
  end if;
  return jsonb_build_object('ok', true, 'outboxEventId', outbox_id);
end;
$$;

create function api.staff_add_internal_note(
  actor_user_id uuid,
  candidate_donation_id uuid,
  note_body text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
declare note_id uuid;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_active_staff(actor_user_id);
  if char_length(trim(note_body)) not between 1 and 4000 then
    raise exception 'invalid note' using errcode = '22023';
  end if;
  insert into app_private.donation_internal_notes (donation_id, body, created_by)
  values (candidate_donation_id, trim(note_body), actor_user_id)
  returning id into note_id;
  insert into app_private.audit_events (
    actor, actor_ref, action_name, entity_type, entity_id,
    reason_code, redacted_changes, metadata
  ) values (
    'staff', actor_user_id::text, 'donation.add_internal_note', 'donation_note',
    note_id, 'staff_operational_note', jsonb_build_object('note_added', true),
    jsonb_build_object('content_redacted', true,
      'donation_id', candidate_donation_id)
  );
  return jsonb_build_object('ok', true, 'noteId', note_id);
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'donor_contacts', 'donations', 'donation_devices', 'donation_status_events',
    'donation_internal_notes', 'donor_account_links'
  ] loop
    execute format('alter table app_private.%I enable row level security', table_name);
  end loop;
end;
$$;

revoke all on table app_private.donor_contacts from public, anon, authenticated;
revoke all on table app_private.donations from public, anon, authenticated;
revoke all on table app_private.donation_devices from public, anon, authenticated;
revoke all on table app_private.donation_status_events from public, anon, authenticated;
revoke all on table app_private.donation_internal_notes from public, anon, authenticated;
revoke all on table app_private.donor_account_links from public, anon, authenticated;
revoke execute on all functions in schema api from public, anon, authenticated;
revoke execute on function app_private.assert_service_role() from public, anon, authenticated;
revoke execute on function app_private.assert_active_staff(uuid) from public, anon, authenticated;

grant select, insert, update, delete on table app_private.donor_contacts to service_role;
grant select, insert, update, delete on table app_private.donations to service_role;
grant select, insert, update, delete on table app_private.donation_devices to service_role;
grant select, insert on table app_private.donation_status_events to service_role;
grant select, insert on table app_private.donation_internal_notes to service_role;
grant select, insert, update, delete on table app_private.donor_account_links to service_role;

grant execute on function api.create_donation(jsonb, uuid) to service_role;
grant execute on function api.get_donation_tracking_material(text) to service_role;
grant execute on function api.get_donation_status(text) to service_role;
grant execute on function api.get_donation_notification_payload(uuid) to service_role;
grant execute on function api.is_active_staff_email(text) to service_role;
grant execute on function api.is_active_staff_user(uuid) to service_role;
grant execute on function api.staff_search_donations(uuid, text, integer) to service_role;
grant execute on function api.staff_get_donation(uuid, uuid) to service_role;
grant execute on function api.staff_record_receipt(uuid, uuid, timestamptz, text, jsonb) to service_role;
grant execute on function api.staff_update_device(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function api.staff_add_unexpected_device(uuid, uuid, text, text) to service_role;
grant execute on function api.staff_change_donation_status(uuid, uuid, app_private.donation_status, text) to service_role;
grant execute on function api.staff_add_internal_note(uuid, uuid, text) to service_role;

create or replace function api.complete_outbox_event(event_id uuid, worker_id text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
declare changed integer;
declare handler text;
begin
  perform app_private.assert_service_role();
  select handler_key into handler from app_private.outbox_events
    where id = event_id and status = 'processing' and locked_by = worker_id
    for update;
  if not found then return false; end if;
  insert into app_private.outbox_handler_receipts (outbox_event_id, handler_name)
    values (event_id, handler) on conflict do nothing;
  update app_private.outbox_events
  set status = 'completed', completed_at = now(), locked_by = null,
      locked_until = null, last_error_code = null, updated_at = now()
  where id = event_id and status = 'processing' and locked_by = worker_id;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create function api.complete_inline_outbox_event(event_id uuid, handler_name text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
declare changed integer;
begin
  perform app_private.assert_service_role();
  if not exists (
    select 1 from app_private.outbox_events
    where id = event_id and handler_key = handler_name
      and status in ('pending', 'retry')
    for update
  ) then return false; end if;
  insert into app_private.outbox_handler_receipts (outbox_event_id, handler_name)
    values (event_id, handler_name) on conflict do nothing;
  update app_private.outbox_events set status = 'completed', completed_at = now(),
    locked_by = null, locked_until = null, last_error_code = null, updated_at = now()
  where id = event_id and handler_key = handler_name and status in ('pending', 'retry');
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke execute on function api.complete_inline_outbox_event(uuid, text)
  from public, anon, authenticated;
grant execute on function api.complete_inline_outbox_event(uuid, text) to service_role;
