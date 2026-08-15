-- Security and integrity remediation for the Gen2 beta review. This migration
-- deliberately changes only beta resources and preserves the private-schema,
-- narrow-RPC boundary.

create table app_private.auth_login_attempts (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  destination text not null check (destination in ('/staff','/account','/partner')),
  pkce_storage jsonb not null check (jsonb_typeof(pkce_storage) = 'object'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table app_private.auth_login_attempts enable row level security;

create table app_private.anonymous_rate_limits (
  bucket_hash text not null check (bucket_hash ~ '^[a-f0-9]{64}$'),
  action_name text not null check (action_name ~ '^[a-z][a-z0-9_]{2,79}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (bucket_hash, action_name, window_started_at)
);
alter table app_private.anonymous_rate_limits enable row level security;

create type app_private.charity_verification_status as enum ('pending','verified','suspended','retired');
create table app_private.charities (
  id uuid primary key default gen_random_uuid(),
  pledge_id uuid not null unique,
  canonical_name text not null check (char_length(canonical_name) between 1 and 240),
  ein text check (ein is null or char_length(ein) <= 32),
  status app_private.charity_verification_status not null default 'pending',
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'verified' or (verified_by is not null and verified_at is not null))
);
create table app_private.organization_charities (
  organization_id uuid not null references app_private.organizations(id) on delete cascade,
  charity_id uuid not null references app_private.charities(id) on delete restrict,
  status app_private.charity_verification_status not null default 'pending',
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (organization_id,charity_id),
  check (status <> 'verified' or (verified_by is not null and verified_at is not null))
);
alter table app_private.charities enable row level security;
alter table app_private.organization_charities enable row level security;

insert into app_private.charities(pledge_id,canonical_name,status,verified_by,verified_at)
select distinct c.selected_charity_pledge_id,c.selected_charity_name,'verified'::app_private.charity_verification_status,c.created_by,c.created_at
from app_private.campaigns c
on conflict (pledge_id) do nothing;
insert into app_private.organization_charities(organization_id,charity_id,status,verified_by,verified_at)
select distinct c.organization_id,ch.id,'verified'::app_private.charity_verification_status,c.created_by,c.created_at
from app_private.campaigns c join app_private.charities ch on ch.pledge_id=c.selected_charity_pledge_id
on conflict do nothing;
alter table app_private.campaigns add column charity_id uuid references app_private.charities(id) on delete restrict;
update app_private.campaigns c set charity_id=ch.id from app_private.charities ch
where ch.pledge_id=c.selected_charity_pledge_id;
alter table app_private.campaigns alter column charity_id set not null;
create index campaigns_charity_idx on app_private.campaigns(charity_id);

alter table app_private.donations add column request_hash text check (request_hash ~ '^[a-f0-9]{64}$');
update app_private.donations set request_hash=encode(extensions.digest(client_submission_key,'sha256'),'hex') where request_hash is null;
alter table app_private.donations alter column request_hash set not null;
alter table app_private.donations add column claim_nonce uuid unique;
update app_private.donations set claim_nonce=gen_random_uuid() where claim_nonce is null;
alter table app_private.donations alter column claim_nonce set not null;

create table app_private.donation_claim_capabilities (
  donation_id uuid primary key references app_private.donations(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  claimed_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((consumed_at is null) = (claimed_by is null))
);
insert into app_private.donation_claim_capabilities(donation_id,expires_at)
select id,created_at+interval '90 days' from app_private.donations on conflict do nothing;
alter table app_private.donation_claim_capabilities enable row level security;

alter table app_private.campaign_revisions add column hero_asset_id uuid references app_private.campaign_assets(id) on delete restrict;
update app_private.campaign_revisions set hero_image_url=null where hero_image_url is not null;
alter table app_private.campaign_revisions add constraint campaign_revision_no_remote_asset check (hero_image_url is null);

create unique index device_sale_results_one_active_sale_idx
on app_private.device_sale_results(device_id) where status in ('draft','recorded');
alter table app_private.proceeds_allocations add column sale_result_id uuid references app_private.device_sale_results(id) on delete restrict;
create unique index proceeds_allocations_sale_result_idx on app_private.proceeds_allocations(sale_result_id) where sale_result_id is not null;
create table app_private.cost_allocation_applications (
  id uuid primary key default gen_random_uuid(),
  cost_id uuid not null references app_private.donation_costs(id) on delete restrict,
  device_id uuid not null references app_private.donation_devices(id) on delete restrict,
  sale_result_id uuid not null references app_private.device_sale_results(id) on delete restrict,
  policy_rule_id uuid not null references app_private.proceeds_policy_cost_rules(id) on delete restrict,
  applied_cents bigint not null check (applied_cents >= 0),
  calculation_snapshot jsonb not null check (jsonb_typeof(calculation_snapshot)='object'),
  created_at timestamptz not null default now(),
  unique(cost_id,device_id)
);
alter table app_private.cost_allocation_applications enable row level security;

create table app_private.semantic_command_registry (
  command_name text primary key,
  human_only boolean not null,
  description text not null
);
-- Canonical risk contract shared with the Worker: 'low', 'moderate', 'high', 'critical'.
insert into app_private.semantic_command_registry(command_name,human_only,description) values
('send_message',false,'Send a bounded external message'),
('update_campaign_content',false,'Create a bounded campaign revision'),
('publish_campaign_revision',false,'Publish an exact reviewed revision subject to policy'),
('change_donation_status',false,'Request a bounded status change subject to policy'),
('create_partner_lead',false,'Create a partner lead'),
('create_internal_note',false,'Create a redacted internal note'),
('record_physical_receipt',true,'Human physical receipt authority'),
('record_device_inspection',true,'Human inspection authority'),
('verify_device_wipe',true,'Human wipe verification authority'),
('record_device_valuation',true,'Human valuation authority'),
('approve_final_financials',true,'Human final financial approval'),
('execute_disbursement',true,'Human external payment execution'),
('manage_credentials',true,'Credential administration'),
('arbitrary_database_query',true,'Arbitrary database access'),
('grant_role',true,'Role and permission administration'),
('export_unrestricted_pii',true,'Unrestricted personal-data export'),
('deploy_production',true,'Production deployment');
alter table app_private.semantic_command_registry enable row level security;

revoke all on app_private.auth_login_attempts,app_private.anonymous_rate_limits,
  app_private.charities,app_private.organization_charities,
  app_private.donation_claim_capabilities,app_private.cost_allocation_applications,
  app_private.semantic_command_registry from public,anon,authenticated;
grant select,insert,update,delete on app_private.auth_login_attempts,app_private.anonymous_rate_limits to service_role;
grant select,insert,update on app_private.charities,app_private.organization_charities,
  app_private.donation_claim_capabilities,app_private.cost_allocation_applications to service_role;
grant select on app_private.semantic_command_registry to service_role;

-- These callers perform service-role assertions, so PostgreSQL must not be told
-- they are STABLE when their authorization helpers are VOLATILE.
alter function api.get_donation_tracking_material(text) volatile;
alter function api.get_donation_status(text) volatile;
alter function api.get_donation_notification_payload(uuid) volatile;
alter function api.is_active_staff_email(text) volatile;
alter function api.is_active_staff_user(uuid) volatile;
alter function api.resolve_campaign_alias(text) volatile;
alter function api.staff_search_donations(uuid,text,integer) volatile;
alter function api.staff_get_donation(uuid,uuid) volatile;
alter function api.staff_financial_overview(uuid) volatile;
alter function api.staff_campaign_overview(uuid) volatile;

create function api.create_auth_login_attempt(state_hash_value text,destination_value text,
  storage_value jsonb,expires_at_value timestamptz) returns void
language plpgsql security definer set search_path=pg_catalog,app_private as $$
begin
  perform app_private.assert_service_role();
  if state_hash_value !~ '^[a-f0-9]{64}$' or destination_value not in ('/staff','/account','/partner')
    or jsonb_typeof(storage_value)<>'object' or expires_at_value<=now()
    or expires_at_value>now()+interval '20 minutes' then
    raise exception 'invalid login attempt' using errcode='22023'; end if;
  delete from app_private.auth_login_attempts where expires_at<now()-interval '1 day';
  insert into app_private.auth_login_attempts(state_hash,destination,pkce_storage,expires_at)
  values(state_hash_value,destination_value,storage_value,expires_at_value);
end $$;

create function api.consume_auth_login_attempt(state_hash_value text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare attempt app_private.auth_login_attempts%rowtype;
begin
  perform app_private.assert_service_role();
  update app_private.auth_login_attempts set consumed_at=now()
  where state_hash=state_hash_value and consumed_at is null and expires_at>now()
  returning * into attempt;
  if attempt.state_hash is null then return null; end if;
  return jsonb_build_object('destination',attempt.destination,'storage',attempt.pkce_storage);
end $$;

create function api.consume_anonymous_rate_limit(bucket_hash_value text,action_value text,
  maximum_requests integer,window_seconds integer) returns boolean
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare window_value timestamptz; count_value integer;
begin
  perform app_private.assert_service_role();
  if bucket_hash_value !~ '^[a-f0-9]{64}$' or maximum_requests not between 1 and 1000
    or window_seconds not between 60 and 86400 then raise exception 'invalid rate limit' using errcode='22023'; end if;
  window_value:=to_timestamp(floor(extract(epoch from now())/window_seconds)*window_seconds);
  insert into app_private.anonymous_rate_limits(bucket_hash,action_name,window_started_at,request_count)
  values(bucket_hash_value,action_value,window_value,1)
  on conflict(bucket_hash,action_name,window_started_at) do update
  set request_count=app_private.anonymous_rate_limits.request_count+1
  returning request_count into count_value;
  return count_value<=maximum_requests;
end $$;

drop function api.donor_account_overview(uuid,text);
create function api.donor_account_overview(actor_user_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  if not exists(select 1 from auth.users where id=actor_user_id and email_confirmed_at is not null)
    then raise exception 'verified donor identity required' using errcode='42501'; end if;
  select jsonb_build_object('donations',coalesce(jsonb_agg(jsonb_build_object(
    'id',d.id,'publicId',d.public_id,'status',d.status,'charityName',d.selected_charity_name,
    'createdAt',d.created_at,'deviceCount',(select count(*) from app_private.donation_devices x where x.donation_id=d.id),
    'shipment',(select jsonb_build_object('status',s.status,'carrier',s.carrier,
      'trackingLastFour',case when s.tracking_number is null then null else right(s.tracking_number,4) end,
      'mailedAt',s.mailed_at) from app_private.donation_shipments s where s.donation_id=d.id and s.direction='inbound')
  ) order by d.created_at desc),'[]'::jsonb)) into result
  from app_private.donor_account_links l join app_private.donations d on d.donor_contact_id=l.donor_contact_id
  where l.user_id=actor_user_id;
  return result;
end $$;

drop function api.donor_mark_donation_mailed(uuid,text,uuid,text,text);
create function api.donor_mark_donation_mailed(actor_user_id uuid,candidate_donation_id uuid,
  carrier_name text,tracking_value text) returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
begin
  perform app_private.assert_service_role();
  if not exists(select 1 from app_private.donations d join app_private.donor_account_links l
    on l.donor_contact_id=d.donor_contact_id where d.id=candidate_donation_id and l.user_id=actor_user_id)
  then raise exception 'linked donation required' using errcode='42501'; end if;
  insert into app_private.donation_shipments(donation_id,direction,status,carrier,tracking_number,mailed_at)
  values(candidate_donation_id,'inbound','mailed',nullif(trim(carrier_name),''),nullif(trim(tracking_value),''),now())
  on conflict(donation_id) where direction='inbound' do update set status='mailed',carrier=excluded.carrier,
    tracking_number=excluded.tracking_number,mailed_at=excluded.mailed_at,updated_at=now();
  update app_private.donations set status='in_transit',updated_at=now()
  where id=candidate_donation_id and status='submitted';
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('donor',actor_user_id::text,'donation.mark_mailed','donation',candidate_donation_id,
    'donor_shipping_update',jsonb_build_object('carrier_supplied',carrier_name is not null,'tracking_supplied',tracking_value is not null),
    jsonb_build_object('pii_redacted',true));
  return jsonb_build_object('ok',true);
end $$;

create function api.get_donation_claim_material(candidate_public_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object('donationId',d.id,'claimNonce',d.claim_nonce) into result
  from app_private.donations d join app_private.donation_claim_capabilities c on c.donation_id=d.id
  where d.public_id=upper(trim(candidate_public_id)) and c.expires_at>now()
    and (c.consumed_at is null or c.claimed_by is not null);
  return result;
end $$;

create function api.claim_donation(actor_user_id uuid,candidate_donation_id uuid,verified_email text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app_private,auth as $$
declare capability app_private.donation_claim_capabilities%rowtype; contact_id uuid; auth_email text;
begin
  perform app_private.assert_service_role();
  select lower(email) into auth_email from auth.users where id=actor_user_id and email_confirmed_at is not null;
  select d.donor_contact_id into contact_id from app_private.donations d join app_private.donor_contacts c
    on c.id=d.donor_contact_id where d.id=candidate_donation_id and c.email_search=auth_email;
  if auth_email is null or auth_email<>lower(trim(verified_email)) or contact_id is null
    then raise exception 'verified donation identity required' using errcode='42501'; end if;
  select * into capability from app_private.donation_claim_capabilities where donation_id=candidate_donation_id for update;
  if capability.claimed_by=actor_user_id then return jsonb_build_object('claimed',false,'alreadyClaimed',true); end if;
  if capability.consumed_at is not null or capability.expires_at<=now() then
    raise exception 'claim capability expired or consumed' using errcode='22023'; end if;
  if exists(select 1 from app_private.donor_account_links where donor_contact_id=contact_id and user_id<>actor_user_id)
    then raise exception 'donation ownership requires staff review' using errcode='42501'; end if;
  insert into app_private.donor_account_links(donor_contact_id,user_id) values(contact_id,actor_user_id)
  on conflict do nothing;
  update app_private.donation_claim_capabilities set consumed_at=now(),claimed_by=actor_user_id
    where donation_id=candidate_donation_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('donor',actor_user_id::text,'donation.claim','donation',candidate_donation_id,'one_time_verified_claim',
    jsonb_build_object('claimed',true),jsonb_build_object('pii_redacted',true));
  return jsonb_build_object('claimed',true,'alreadyClaimed',false);
end $$;

drop function api.attach_campaign_to_donation(uuid,text);
drop function api.create_donation(jsonb,uuid);
create function api.create_donation(payload jsonb,tracking_nonce uuid,claim_nonce uuid,
  request_hash_value text,campaign_slug text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,extensions,app_private as $$
declare existing app_private.donations%rowtype; contact_id uuid; donation_row app_private.donations%rowtype;
  domain_event_id uuid; outbox_id uuid; submitted_device jsonb; created_time timestamptz:=now();
  donor jsonb:=payload->'donor'; charity jsonb:=payload->'charity';
  client_key text:=trim(payload->>'clientSubmissionKey'); campaign_row app_private.campaigns%rowtype;
  charity_id_value uuid; policy_id_value uuid;
begin
  perform app_private.assert_service_role();
  if jsonb_typeof(payload)<>'object' or client_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or request_hash_value !~ '^[a-f0-9]{64}$' then raise exception 'invalid donation payload' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(client_key,741));
  select * into existing from app_private.donations where client_submission_key=client_key;
  if found then
    if existing.request_hash<>request_hash_value then raise exception 'idempotency key payload mismatch' using errcode='23505'; end if;
    return jsonb_build_object('created',false,'donationId',existing.id,'publicId',existing.public_id,
      'createdAt',existing.created_at,'outboxEventId',null);
  end if;
  if jsonb_typeof(donor)<>'object' or jsonb_typeof(charity)<>'object'
    or jsonb_typeof(payload->'devices')<>'array' or jsonb_array_length(payload->'devices') not between 1 and 20
    then raise exception 'invalid donation payload' using errcode='22023'; end if;

  if campaign_slug is not null then
    select c.* into campaign_row from app_private.campaigns c join app_private.organizations o on o.id=c.organization_id
      join app_private.organization_charities oc on oc.organization_id=c.organization_id and oc.charity_id=c.charity_id
      where c.slug=lower(trim(campaign_slug)) and c.status='published' and c.active_revision_id is not null
        and o.status='active' and oc.status='verified';
    if campaign_row.id is null then raise exception 'published eligible campaign required' using errcode='22023'; end if;
    select id into charity_id_value from app_private.charities where id=campaign_row.charity_id
      and status='verified' and pledge_id=(charity->>'pledgeId')::uuid;
    if charity_id_value is null then raise exception 'campaign beneficiary mismatch' using errcode='22023'; end if;
  else
    select id into charity_id_value from app_private.charities where pledge_id=(charity->>'pledgeId')::uuid and status='verified';
  end if;

  select a.policy_version_id into policy_id_value
  from app_private.proceeds_policy_assignments a join app_private.proceeds_policy_versions v on v.id=a.policy_version_id
  where a.enabled and v.lifecycle in ('approved','active') and created_time>=a.effective_from
    and (a.effective_to is null or created_time<a.effective_to) and created_time>=v.effective_from
    and (v.effective_to is null or created_time<v.effective_to)
    and ((a.scope='campaign' and a.scope_id=campaign_row.id)
      or (a.scope='partnership' and a.scope_id=campaign_row.organization_id)
      or (a.scope='charity' and a.scope_id=charity_id_value)
      or (a.scope='general' and a.scope_id is null))
  order by case a.scope when 'campaign' then 4 when 'partnership' then 3 when 'charity' then 2 else 1 end desc,
    a.precedence desc,a.effective_from desc limit 1;

  insert into app_private.donor_contacts(first_name,middle_name,last_name,email,email_search,address_line_1,
    address_line_2,city,region,postal_code,country_code,marketing_email_consent,marketing_consent_at)
  values(trim(donor->>'firstName'),nullif(trim(donor->>'middleName'),''),trim(donor->>'lastName'),trim(donor->>'email'),
    lower(trim(donor->>'email')),trim(donor->>'address1'),nullif(trim(donor->>'address2'),''),trim(donor->>'city'),
    nullif(trim(donor->>'state'),''),nullif(trim(donor->>'zip'),''),upper(trim(donor->>'country')),
    coalesce((donor->>'marketingEmailConsent')::boolean,false),case when coalesce((donor->>'marketingEmailConsent')::boolean,false)
      then coalesce((donor->>'marketingConsentAt')::timestamptz,created_time) else null end)
  returning id into contact_id;

  insert into app_private.donations(public_id,client_submission_key,request_hash,donor_contact_id,shipping_method,
    selected_charity_pledge_id,selected_charity_name,selected_charity_ein,selected_charity_metadata,
    tracking_nonce,claim_nonce,campaign_id,policy_version_snapshot_id,policy_resolution_status,created_at,updated_at)
  values(app_private.new_donation_public_id(created_time),client_key,request_hash_value,contact_id,trim(payload->>'shippingMethod'),
    (charity->>'pledgeId')::uuid,trim(charity->>'name'),nullif(trim(charity->>'ein'),''),
    jsonb_strip_nulls(jsonb_build_object('city',charity->>'city','state',charity->>'state','country',charity->>'country',
      'websiteUrl',charity->>'websiteUrl','logoUrl',charity->>'logoUrl')),tracking_nonce,claim_nonce,campaign_row.id,
    policy_id_value,case when policy_id_value is null then 'policy_hold' else 'resolved' end,created_time,created_time)
  returning * into donation_row;
  insert into app_private.donation_claim_capabilities(donation_id,expires_at) values(donation_row.id,created_time+interval '90 days');
  for submitted_device in select value from jsonb_array_elements(payload->'devices') loop
    insert into app_private.donation_devices(donation_id,source,donor_device_key,donor_brand,donor_model,donor_age,
      donor_condition,donor_storage,donor_powers_on,donor_unlocked)
    values(donation_row.id,'expected',trim(submitted_device->>'id'),trim(submitted_device->>'brand'),
      nullif(trim(submitted_device->>'model'),''),trim(submitted_device->>'age'),trim(submitted_device->>'condition'),
      trim(submitted_device->>'storage'),(submitted_device->>'powersOn')::boolean,(submitted_device->>'unlocked')::boolean);
  end loop;
  insert into app_private.donation_status_events(donation_id,status,donor_visible,public_message,actor)
  values(donation_row.id,'submitted',true,'Donation packet created. Mail the prepared package when ready.','donor');
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('donor',donation_row.id::text,'donation.submit','donation',donation_row.id,'donor_submission',
    jsonb_build_object('device_count',jsonb_array_length(payload->'devices'),'campaign_id',campaign_row.id,
      'policy_version_id',policy_id_value),jsonb_build_object('pii_redacted',true));
  insert into app_private.domain_events(event_type,aggregate_type,aggregate_id,aggregate_version,payload)
  values('donation.created','donation',donation_row.id,1,jsonb_build_object('donationId',donation_row.id,
    'publicId',donation_row.public_id,'campaignId',campaign_row.id)) returning id into domain_event_id;
  insert into app_private.outbox_events(domain_event_id,handler_key,event_type,payload)
  values(domain_event_id,'donation_notifications','donation.created',jsonb_build_object('donationId',donation_row.id))
  returning id into outbox_id;
  if campaign_row.id is not null then
    insert into app_private.campaign_events(campaign_id,event_type,occurred_at)
    values(campaign_row.id,'donation_submitted',created_time);
  end if;
  return jsonb_build_object('created',true,'donationId',donation_row.id,'publicId',donation_row.public_id,
    'createdAt',donation_row.created_at,'outboxEventId',outbox_id);
end $$;

create or replace function api.get_donation_tracking_material(candidate_public_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare result jsonb; begin perform app_private.assert_service_role();
  select jsonb_build_object('donationId',id,'trackingNonce',tracking_nonce,'claimNonce',claim_nonce) into result
  from app_private.donations where public_id=upper(trim(candidate_public_id)); return result; end $$;

create or replace function api.get_donation_notification_payload(candidate_donation_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare result jsonb; begin perform app_private.assert_service_role();
  select jsonb_build_object('donationId',d.id,'publicId',d.public_id,'status',d.status,'createdAt',d.created_at,
    'trackingNonce',d.tracking_nonce,'claimNonce',d.claim_nonce,'charityName',d.selected_charity_name,
    'charityPledgeId',d.selected_charity_pledge_id,'donor',jsonb_build_object('firstName',c.first_name,
      'middleName',coalesce(c.middle_name,''),'lastName',c.last_name,'email',c.email,'address1',c.address_line_1,
      'address2',coalesce(c.address_line_2,''),'city',c.city,'state',coalesce(c.region,''),'zip',coalesce(c.postal_code,''),
      'country',c.country_code,'marketingEmailConsent',c.marketing_email_consent,'marketingConsentAt',c.marketing_consent_at),
    'devices',coalesce((select jsonb_agg(jsonb_build_object('id',x.donor_device_key,'brand',x.donor_brand,
      'model',coalesce(x.donor_model,''),'age',x.donor_age,'condition',x.donor_condition,'storage',x.donor_storage,
      'powersOn',x.donor_powers_on,'unlocked',x.donor_unlocked) order by x.created_at)
      from app_private.donation_devices x where x.donation_id=d.id and x.source='expected'),'[]'::jsonb)) into result
  from app_private.donations d join app_private.donor_contacts c on c.id=d.donor_contact_id where d.id=candidate_donation_id;
  return result; end $$;

drop function api.partner_create_campaign(uuid,uuid,text,text,uuid,text,text,text,text,text,text);
create function api.partner_create_campaign(actor_user_id uuid,candidate_organization_id uuid,campaign_slug text,
  campaign_name text,candidate_charity_id uuid,headline_value text,summary_value text,story_value text,
  cta_value text,content_hash_value text) returns jsonb language plpgsql security definer
set search_path=pg_catalog,app_private as $$
declare campaign_row app_private.campaigns%rowtype; revision_id uuid; charity_row app_private.charities%rowtype;
begin
  perform app_private.assert_service_role(); perform app_private.assert_org_admin(actor_user_id,candidate_organization_id);
  if not exists(select 1 from app_private.organizations where id=candidate_organization_id and status='active')
    then raise exception 'active organization required' using errcode='42501'; end if;
  select ch.* into charity_row from app_private.charities ch join app_private.organization_charities oc on oc.charity_id=ch.id
    where oc.organization_id=candidate_organization_id and ch.id=candidate_charity_id
      and ch.status='verified' and oc.status='verified';
  if charity_row.id is null then raise exception 'verified organization charity required' using errcode='42501'; end if;
  if campaign_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or exists(select 1 from app_private.reserved_route_slugs where slug=campaign_slug)
    then raise exception 'campaign slug is reserved or invalid' using errcode='23514'; end if;
  insert into app_private.campaigns(organization_id,slug,name,selected_charity_pledge_id,selected_charity_name,charity_id,created_by)
  values(candidate_organization_id,campaign_slug,trim(campaign_name),charity_row.pledge_id,charity_row.canonical_name,charity_row.id,actor_user_id)
  returning * into campaign_row;
  insert into app_private.campaign_revisions(campaign_id,version,headline,summary,story,cta_label,content_hash,requested_by)
  values(campaign_row.id,1,trim(headline_value),trim(summary_value),trim(story_value),
    coalesce(nullif(trim(cta_value),''),'Donate a Phone'),content_hash_value,actor_user_id) returning id into revision_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('partner',actor_user_id::text,'campaign.create','campaign',campaign_row.id,'verified_partner_campaign',
    jsonb_build_object('revision_id',revision_id,'charity_id',charity_row.id),jsonb_build_object('organization_id',candidate_organization_id));
  return jsonb_build_object('id',campaign_row.id,'revisionId',revision_id);
end $$;

drop function api.partner_create_campaign_revision(uuid,uuid,text,text,text,text,text,text);
create function api.partner_create_campaign_revision(actor_user_id uuid,candidate_campaign_id uuid,
  headline_value text,summary_value text,story_value text,cta_value text,hero_asset_value uuid,
  content_hash_value text) returns jsonb language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare org_id uuid; next_version integer; revision_id uuid;
begin
  perform app_private.assert_service_role();
  select c.organization_id into org_id from app_private.campaigns c join app_private.organizations o on o.id=c.organization_id
    where c.id=candidate_campaign_id and o.status='active' for update of c;
  perform app_private.assert_org_member(actor_user_id,org_id);
  if hero_asset_value is not null and not exists(select 1 from app_private.campaign_assets
    where id=hero_asset_value and campaign_id=candidate_campaign_id) then
    raise exception 'controlled campaign asset required' using errcode='22023'; end if;
  select coalesce(max(version),0)+1 into next_version from app_private.campaign_revisions where campaign_id=candidate_campaign_id;
  insert into app_private.campaign_revisions(campaign_id,version,headline,summary,story,cta_label,hero_asset_id,content_hash,requested_by)
  values(candidate_campaign_id,next_version,trim(headline_value),trim(summary_value),trim(story_value),
    coalesce(nullif(trim(cta_value),''),'Donate a Phone'),hero_asset_value,content_hash_value,actor_user_id) returning id into revision_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('partner',actor_user_id::text,'campaign.update_content','campaign_revision',revision_id,'partner_revision',
    jsonb_build_object('version',next_version,'content_hash',content_hash_value,'hero_asset_id',hero_asset_value),
    jsonb_build_object('campaign_id',candidate_campaign_id));
  return jsonb_build_object('revisionId',revision_id,'version',next_version);
end $$;

create or replace function api.staff_publish_campaign_revision(actor_user_id uuid,candidate_campaign_id uuid,
  candidate_revision_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare old_revision uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select c.active_revision_id into old_revision from app_private.campaigns c join app_private.organizations o on o.id=c.organization_id
    join app_private.charities ch on ch.id=c.charity_id
    join app_private.organization_charities oc on oc.organization_id=c.organization_id and oc.charity_id=c.charity_id
    where c.id=candidate_campaign_id and o.status='active' and ch.status='verified' and oc.status='verified' for update of c;
  if not found then raise exception 'active verified campaign relationship required' using errcode='42501'; end if;
  if not exists(select 1 from app_private.campaign_revisions r where r.id=candidate_revision_id
    and r.campaign_id=candidate_campaign_id and r.status='draft'
    and (r.hero_asset_id is null or exists(select 1 from app_private.campaign_assets a
      where a.id=r.hero_asset_id and a.campaign_id=candidate_campaign_id))) then
    raise exception 'publishable controlled revision required' using errcode='22023'; end if;
  update app_private.campaign_revisions set status='superseded' where id=old_revision and status='published';
  update app_private.campaign_revisions set status='published',approved_by=actor_user_id,published_by=actor_user_id,
    published_at=now() where id=candidate_revision_id;
  update app_private.campaigns set active_revision_id=candidate_revision_id,status='published',updated_at=now() where id=candidate_campaign_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'campaign.publish_revision','campaign',candidate_campaign_id,'staff_publication',
    jsonb_build_object('from_revision',old_revision,'to_revision',candidate_revision_id),
    jsonb_build_object('verified_relationship',true,'controlled_asset',true));
  return jsonb_build_object('ok',true,'slug',(select slug from app_private.campaigns where id=candidate_campaign_id));
end $$;

create or replace function api.get_public_campaign(campaign_slug text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare result jsonb; begin perform app_private.assert_service_role();
  select jsonb_build_object('id',c.id,'slug',c.slug,'name',c.name,'charityPledgeId',ch.pledge_id,
    'charityName',ch.canonical_name,'headline',r.headline,'summary',r.summary,'story',r.story,
    'ctaLabel',r.cta_label,'heroAssetId',r.hero_asset_id,
    'heroImageUrl',case when r.hero_asset_id is null then null else '/api/campaign-assets/'||r.hero_asset_id::text end,
    'revision',r.version,'contentHash',r.content_hash) into result
  from app_private.campaigns c join app_private.organizations o on o.id=c.organization_id
    join app_private.charities ch on ch.id=c.charity_id
    join app_private.organization_charities oc on oc.organization_id=c.organization_id and oc.charity_id=c.charity_id
    join app_private.campaign_revisions r on r.id=c.active_revision_id
  where c.slug=lower(trim(campaign_slug)) and c.status='published' and r.status='published'
    and o.status='active' and ch.status='verified' and oc.status='verified'; return result; end $$;

create or replace function api.partner_overview(actor_user_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare result jsonb; begin perform app_private.assert_service_role();
  select jsonb_build_object('organizations',coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'slug',o.slug,'role',m.role,
    'verifiedCharities',(select coalesce(jsonb_agg(jsonb_build_object('id',ch.id,'name',ch.canonical_name,'pledgeId',ch.pledge_id) order by ch.canonical_name),'[]'::jsonb)
      from app_private.organization_charities oc join app_private.charities ch on ch.id=oc.charity_id
      where oc.organization_id=o.id and oc.status='verified' and ch.status='verified'),
    'campaigns',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'slug',c.slug,'name',c.name,'status',c.status,
      'charityName',ch.canonical_name,'updatedAt',c.updated_at) order by c.updated_at desc),'[]'::jsonb)
      from app_private.campaigns c join app_private.charities ch on ch.id=c.charity_id where c.organization_id=o.id)) order by o.name),'[]'::jsonb)) into result
  from app_private.organizations o join app_private.organization_memberships m on m.organization_id=o.id
  where m.user_id=actor_user_id and m.status='active' and o.status='active'; return result; end $$;

create or replace function api.partner_campaign_detail(actor_user_id uuid,candidate_campaign_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare result jsonb; org_id uuid; begin perform app_private.assert_service_role();
  select organization_id into org_id from app_private.campaigns where id=candidate_campaign_id;
  perform app_private.assert_org_member(actor_user_id,org_id);
  select jsonb_build_object('id',c.id,'organizationId',c.organization_id,'slug',c.slug,'name',c.name,'status',c.status,
    'charityName',ch.canonical_name,'activeRevisionId',c.active_revision_id,
    'revisions',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'version',r.version,'status',r.status,
      'headline',r.headline,'summary',r.summary,'story',r.story,'ctaLabel',r.cta_label,'heroAssetId',r.hero_asset_id,
      'contentHash',r.content_hash,'createdAt',r.created_at,'publishedAt',r.published_at) order by r.version desc)
      from app_private.campaign_revisions r where r.campaign_id=c.id),'[]'::jsonb)) into result
  from app_private.campaigns c join app_private.charities ch on ch.id=c.charity_id where c.id=candidate_campaign_id;
  return result; end $$;

create or replace function api.evaluate_agent_command(agent_identity text,command_value text,target_kind text,
  target_value uuid,risk_value app_private.risk_level,facts jsonb,input_hash_value text,correlation_value uuid,
  idempotency_value text) returns jsonb language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare policy_id uuid; rule_id uuid; decision_outcome app_private.action_policy_outcome; rationale text;
  decision_id uuid; action_id uuid; existing app_private.action_decisions%rowtype; registry app_private.semantic_command_registry%rowtype;
begin
  perform app_private.assert_service_role();
  select * into registry from app_private.semantic_command_registry where command_name=command_value;
  if registry.command_name is null then raise exception 'unknown semantic command' using errcode='22023'; end if;
  select * into existing from app_private.action_decisions where actor='agent' and actor_ref=agent_identity
    and idempotency_key=idempotency_value;
  if existing.id is not null then
    if existing.input_hash<>input_hash_value or existing.command_name<>command_value
      then raise exception 'agent idempotency payload mismatch' using errcode='23505'; end if;
    return jsonb_build_object('decisionId',existing.id,'outcome',existing.outcome,'rationaleCode',existing.rationale_code,'replayed',true);
  end if;
  if registry.human_only then decision_outcome:='DENY'; rationale:='human_or_prohibited_action';
  else
    select v.id,r.id,r.outcome,r.rationale_code into policy_id,rule_id,decision_outcome,rationale
    from app_private.action_policy_versions v join app_private.action_policy_rules r on r.policy_version_id=v.id
    where v.lifecycle='active' and now()>=v.effective_from and (v.effective_to is null or now()<v.effective_to)
      and r.actor='agent' and (r.command_name=command_value or r.command_name='*')
      and risk_value=any(r.risk_levels) and (r.target_type is null or r.target_type=target_kind)
    order by (r.command_name=command_value) desc,r.priority desc limit 1;
    if decision_outcome is null then decision_outcome:='ESCALATE'; rationale:='no_matching_policy'; end if;
  end if;
  insert into app_private.action_decisions(policy_version_id,policy_rule_id,command_name,actor,actor_ref,target_type,
    target_id,risk,context,outcome,rationale_code,input_hash,correlation_id,idempotency_key)
  values(policy_id,rule_id,command_value,'agent',agent_identity,target_kind,target_value,risk_value,coalesce(facts,'{}'::jsonb),
    decision_outcome,rationale,input_hash_value,correlation_value,idempotency_value)
  returning id into decision_id;
  insert into app_private.agent_actions(action_decision_id,agent_ref,status,invocation_metadata)
  values(decision_id,agent_identity,(case decision_outcome when 'ALLOW_AUTOMATICALLY' then 'approved' when 'DENY' then 'cancelled'
    else 'proposed' end)::app_private.agent_action_status,jsonb_build_object('target_type',target_kind,'pii_redacted',true))
  returning id into action_id;
  if decision_outcome='ESCALATE' then insert into app_private.agent_escalations(agent_action_id,severity,reason_code,summary)
    values(action_id,risk_value,rationale,'Command requires staff review.'); end if;
  return jsonb_build_object('decisionId',decision_id,'agentActionId',action_id,'outcome',decision_outcome,'rationaleCode',rationale,'replayed',false);
end $$;

create or replace function api.staff_record_sale_and_allocation(actor_user_id uuid,candidate_device_id uuid,
  gross_value_cents bigint,sale_channel text,external_ref text,sold_time timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare donation_row app_private.donations%rowtype; sale_id uuid; allocation_id uuid; share integer;
  cost_row record; applied bigint; eligible_costs bigint:=0; device_count integer; device_rank integer;
  minimum_device uuid; snapshot jsonb;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select d.* into donation_row from app_private.donations d join app_private.donation_devices x on x.donation_id=d.id
    where x.id=candidate_device_id for update of d;
  if donation_row.id is null then raise exception 'donation device required' using errcode='22023'; end if;
  insert into app_private.device_sale_results(device_id,gross_amount_cents,channel,external_reference,sold_at,recorded_by)
  values(candidate_device_id,gross_value_cents,trim(sale_channel),nullif(trim(external_ref),''),sold_time,actor_user_id)
  returning id into sale_id;
  if donation_row.policy_version_snapshot_id is not null then
    select share_basis_points into share from app_private.proceeds_policy_versions
    where id=donation_row.policy_version_snapshot_id and lifecycle in ('approved','active');
  end if;
  if share is not null then
    select count(*),1+(select count(*) from app_private.donation_devices y where y.donation_id=donation_row.id and y.id<candidate_device_id)
      into device_count,device_rank from app_private.donation_devices x where x.donation_id=donation_row.id;
    select id into minimum_device from app_private.donation_devices where donation_id=donation_row.id order by id limit 1;
    for cost_row in
      select c.*,r.id rule_id,r.allocation_method,r.cap_basis_points,r.metadata,r.priority
      from app_private.donation_costs c join app_private.proceeds_policy_cost_rules r
        on r.policy_version_id=donation_row.policy_version_snapshot_id and r.cost_category=c.category and r.deductible
      where c.donation_id=donation_row.id and c.status='recorded' and (c.device_id is null or c.device_id=candidate_device_id)
      order by r.priority desc,c.incurred_at,c.id
    loop
      applied:=0;
      if cost_row.device_id=candidate_device_id then applied:=cost_row.amount_cents;
      elsif cost_row.device_id is null and cost_row.allocation_method='pro_rata' then
        applied:=cost_row.amount_cents/device_count + case when device_rank<=cost_row.amount_cents%device_count then 1 else 0 end;
      elsif cost_row.device_id is null and candidate_device_id=minimum_device then
        applied:=case cost_row.allocation_method
          when 'fixed' then least(cost_row.amount_cents,coalesce((cost_row.metadata->>'fixed_cents')::bigint,cost_row.amount_cents))
          when 'capped' then least(cost_row.amount_cents,(gross_value_cents*coalesce(cost_row.cap_basis_points,0))/10000)
          else cost_row.amount_cents end;
      end if;
      if applied>0 then
        applied:=least(applied,greatest(gross_value_cents-eligible_costs,0));
        insert into app_private.cost_allocation_applications(cost_id,device_id,sale_result_id,policy_rule_id,applied_cents,calculation_snapshot)
        values(cost_row.id,candidate_device_id,sale_id,cost_row.rule_id,applied,
          jsonb_build_object('method',cost_row.allocation_method,'priority',cost_row.priority,
            'capBasisPoints',cost_row.cap_basis_points,'deviceCount',device_count,'deviceRank',device_rank));
        eligible_costs:=eligible_costs+applied;
      end if;
    end loop;
  end if;
  snapshot:=jsonb_build_object('saleResultId',sale_id,'policyVersionId',donation_row.policy_version_snapshot_id,
    'grossCents',gross_value_cents,'eligibleCostCents',eligible_costs,
    'costApplications',coalesce((select jsonb_agg(jsonb_build_object('costId',a.cost_id,'ruleId',a.policy_rule_id,
      'appliedCents',a.applied_cents,'method',a.calculation_snapshot->>'method') order by a.created_at)
      from app_private.cost_allocation_applications a where a.sale_result_id=sale_id),'[]'::jsonb));
  insert into app_private.proceeds_allocations(donation_id,policy_version_id,beneficiary_pledge_id,gross_cents,
    eligible_cost_cents,allocable_base_cents,share_basis_points,allocated_cents,status,calculation_snapshot,
    calculated_by,calculated_at,sale_result_id)
  values(donation_row.id,donation_row.policy_version_snapshot_id,donation_row.selected_charity_pledge_id,gross_value_cents,
    eligible_costs,greatest(gross_value_cents-eligible_costs,0),share,
    case when share is null then null else (greatest(gross_value_cents-eligible_costs,0)*share)/10000 end,
    (case when share is null then 'policy_hold' else 'calculated' end)::app_private.allocation_status,
    snapshot,actor_user_id,now(),sale_id)
  returning id into allocation_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'finance.record_sale','sale_result',sale_id,'staff_financial_entry',
    jsonb_build_object('gross_cents',gross_value_cents,'eligible_cost_cents',eligible_costs,
      'allocation_status',case when share is null then 'policy_hold' else 'calculated' end),
    jsonb_build_object('allocation_id',allocation_id,'donation_id',donation_row.id,'rule_snapshot',true));
  return jsonb_build_object('saleId',sale_id,'allocationId',allocation_id,
    'allocationStatus',case when share is null then 'policy_hold' else 'calculated' end);
end $$;

drop trigger proceeds_allocations_append_only on app_private.proceeds_allocations;
create function app_private.protect_proceeds_allocation() returns trigger language plpgsql
set search_path=pg_catalog as $$ begin
  if tg_op='DELETE' then raise exception 'proceeds_allocations is append-only' using errcode='55000'; end if;
  if (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') then
    raise exception 'proceeds allocation calculation is immutable' using errcode='55000'; end if;
  return new;
end $$;
create trigger proceeds_allocations_protect before update or delete on app_private.proceeds_allocations
for each row execute function app_private.protect_proceeds_allocation();

create or replace function api.staff_prepare_disbursement(actor_user_id uuid,candidate_allocation_id uuid,
  amount_value_cents bigint,beneficiary_ref text,evidence_value jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare allocation_row app_private.proceeds_allocations%rowtype; preparation_id uuid; disbursement_id uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select * into allocation_row from app_private.proceeds_allocations where id=candidate_allocation_id for update;
  if allocation_row.id is null or allocation_row.status<>'calculated' or allocation_row.allocated_cents is null
    or amount_value_cents<>allocation_row.allocated_cents then
    raise exception 'full calculated allocation required' using errcode='22023'; end if;
  if exists(select 1 from app_private.disbursement_preparation_allocations x join app_private.disbursements d
    on d.preparation_id=x.preparation_id where x.allocation_id=candidate_allocation_id and d.status not in ('cancelled','reversed'))
    then raise exception 'allocation already has an active disbursement' using errcode='23505'; end if;
  insert into app_private.disbursement_preparations(amount_cents,beneficiary_reference,evidence,prepared_by)
  values(amount_value_cents,trim(beneficiary_ref),coalesce(evidence_value,'{}'::jsonb),actor_user_id) returning id into preparation_id;
  insert into app_private.disbursement_preparation_allocations(preparation_id,allocation_id,amount_cents)
  values(preparation_id,candidate_allocation_id,amount_value_cents);
  insert into app_private.disbursements(preparation_id) values(preparation_id) returning id into disbursement_id;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'finance.prepare_disbursement','disbursement',disbursement_id,
    'manual_disbursement_preparation',jsonb_build_object('amount_cents',amount_value_cents),
    jsonb_build_object('allocation_id',candidate_allocation_id,'preparation_id',preparation_id));
  return jsonb_build_object('preparationId',preparation_id,'disbursementId',disbursement_id);
end $$;

create or replace function api.staff_decide_disbursement(actor_user_id uuid,candidate_preparation_id uuid,
  decision_value app_private.approval_outcome,reason_value text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare preparation_row app_private.disbursement_preparations%rowtype; policy_row app_private.financial_approval_policies%rowtype;
  approval_count integer; next_status app_private.disbursement_status; current_status app_private.disbursement_status; allocation_value uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  select * into preparation_row from app_private.disbursement_preparations where id=candidate_preparation_id;
  select status into current_status from app_private.disbursements where preparation_id=candidate_preparation_id for update;
  if current_status<>'prepared' then raise exception 'prepared disbursement required' using errcode='22023'; end if;
  select * into policy_row from app_private.financial_approval_policies where action_type='record_disbursement'
    and lifecycle='active' and now()>=effective_from and (effective_to is null or now()<effective_to)
    order by version desc limit 1;
  if policy_row.id is null then raise exception 'active approval policy required' using errcode='22023'; end if;
  if actor_user_id=preparation_row.prepared_by and not policy_row.preparer_may_approve
    then raise exception 'preparer cannot approve under active policy' using errcode='42501'; end if;
  insert into app_private.disbursement_approvals(preparation_id,approval_policy_id,approver_user_id,outcome,reason)
  values(candidate_preparation_id,policy_row.id,actor_user_id,decision_value,nullif(trim(reason_value),''));
  select count(*) into approval_count from app_private.disbursement_approvals
    where preparation_id=candidate_preparation_id and outcome='approved';
  next_status:=case when decision_value='rejected' then 'cancelled'::app_private.disbursement_status
    when approval_count>=policy_row.required_approvals then 'approved'::app_private.disbursement_status
    else 'prepared'::app_private.disbursement_status end;
  update app_private.disbursements set status=next_status where preparation_id=candidate_preparation_id;
  if next_status='approved' then for allocation_value in select allocation_id from app_private.disbursement_preparation_allocations
    where preparation_id=candidate_preparation_id loop
      update app_private.proceeds_allocations set status='approved' where id=allocation_value and status='calculated';
      insert into app_private.allocation_state_events(allocation_id,status,actor_user_id,reason_code)
      values(allocation_value,'approved',actor_user_id,'configured_approvals_complete');
    end loop; end if;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'finance.decide_disbursement','disbursement',
    (select id from app_private.disbursements where preparation_id=candidate_preparation_id),'configured_approval_policy',
    jsonb_build_object('outcome',decision_value,'resulting_status',next_status),
    jsonb_build_object('policy_id',policy_row.id,'approval_count',approval_count));
  return jsonb_build_object('status',next_status,'approvalCount',approval_count,'requiredApprovals',policy_row.required_approvals);
end $$;

create or replace function api.staff_record_disbursement_completion(actor_user_id uuid,candidate_preparation_id uuid,
  external_ref text) returns jsonb language plpgsql security definer set search_path=pg_catalog,app_private as $$
declare disbursement_id uuid; allocation_value uuid;
begin
  perform app_private.assert_service_role(); perform app_private.assert_active_staff(actor_user_id);
  update app_private.disbursements set status='completed',external_payment_reference=trim(external_ref),
    completed_by=actor_user_id,completed_at=now() where preparation_id=candidate_preparation_id and status='approved'
    returning id into disbursement_id;
  if disbursement_id is null then raise exception 'approved disbursement required' using errcode='22023'; end if;
  for allocation_value in select allocation_id from app_private.disbursement_preparation_allocations
    where preparation_id=candidate_preparation_id loop
    update app_private.proceeds_allocations set status='disbursed' where id=allocation_value and status='approved';
    insert into app_private.allocation_state_events(allocation_id,status,actor_user_id,reason_code)
    values(allocation_value,'disbursed',actor_user_id,'external_payment_recorded');
  end loop;
  insert into app_private.audit_events(actor,actor_ref,action_name,entity_type,entity_id,reason_code,redacted_changes,metadata)
  values('staff',actor_user_id::text,'finance.record_disbursement_completion','disbursement',disbursement_id,
    'externally_executed_payment',jsonb_build_object('completed',true,'external_reference_present',true),
    jsonb_build_object('automated_money_movement',false));
  return jsonb_build_object('disbursementId',disbursement_id,'status','completed');
end $$;

revoke execute on function api.create_auth_login_attempt(text,text,jsonb,timestamptz),
  api.consume_auth_login_attempt(text),api.consume_anonymous_rate_limit(text,text,integer,integer),
  api.donor_account_overview(uuid),api.donor_mark_donation_mailed(uuid,uuid,text,text),
  api.get_donation_claim_material(text),api.claim_donation(uuid,uuid,text),
  api.create_donation(jsonb,uuid,uuid,text,text),
  api.partner_create_campaign(uuid,uuid,text,text,uuid,text,text,text,text,text),
  api.partner_create_campaign_revision(uuid,uuid,text,text,text,text,uuid,text)
from public,anon,authenticated;
grant execute on function api.create_auth_login_attempt(text,text,jsonb,timestamptz),
  api.consume_auth_login_attempt(text),api.consume_anonymous_rate_limit(text,text,integer,integer),
  api.donor_account_overview(uuid),api.donor_mark_donation_mailed(uuid,uuid,text,text),
  api.get_donation_claim_material(text),api.claim_donation(uuid,uuid,text),
  api.create_donation(jsonb,uuid,uuid,text,text),
  api.partner_create_campaign(uuid,uuid,text,text,uuid,text,text,text,text,text),
  api.partner_create_campaign_revision(uuid,uuid,text,text,text,text,uuid,text)
to service_role;
