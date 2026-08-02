-- Donate by Mail Gen2 beta: bounded agent coworker operations.
--
-- This migration does not grant an agent arbitrary SQL access, physical intake
-- authority, device inspection/valuation authority, payout authority, role
-- administration, credential access, or production deployment authority.
-- It adds narrow support read models, Gmail/Brevo communication journaling,
-- partner-lead intake, exact-message authorization, and explicit shipment state.

alter table app_private.communication_threads
  add column if not exists donation_id uuid references app_private.donations(id) on delete restrict,
  add column if not exists contact_email_search text,
  add column if not exists status text not null default 'open';

alter table app_private.communication_threads
  drop constraint if exists communication_threads_contact_email_search_check;
alter table app_private.communication_threads
  add constraint communication_threads_contact_email_search_check check (
    contact_email_search is null or (
      contact_email_search = lower(btrim(contact_email_search))
      and char_length(contact_email_search) between 3 and 320
    )
  );

alter table app_private.communication_threads
  drop constraint if exists communication_threads_status_check;
alter table app_private.communication_threads
  add constraint communication_threads_status_check check (
    status in ('open','waiting_on_contact','waiting_on_staff','resolved','closed')
  );

create index if not exists communication_threads_donation_id_idx
  on app_private.communication_threads(donation_id);
create index if not exists communication_threads_contact_email_idx
  on app_private.communication_threads(contact_email_search, last_message_at desc);
create unique index if not exists communication_threads_provider_ref_uidx
  on app_private.communication_threads(external_provider, external_thread_ref)
  where external_thread_ref is not null;
create unique index if not exists communication_messages_thread_external_ref_uidx
  on app_private.communication_messages(thread_id, external_message_ref)
  where external_message_ref is not null;
create unique index if not exists communication_messages_agent_action_uidx
  on app_private.communication_messages(agent_action_id)
  where agent_action_id is not null and direction = 'outbound';

drop trigger if exists communication_messages_append_only
  on app_private.communication_messages;
create trigger communication_messages_append_only
before update or delete on app_private.communication_messages
for each row execute function app_private.prevent_update_or_delete();

create table if not exists app_private.partner_leads (
  id uuid primary key default gen_random_uuid(),
  requester_email_search text not null,
  organization_name text not null,
  website_url text,
  audience_summary text,
  goal_summary text,
  timing_summary text,
  request_summary text not null,
  external_thread_ref text,
  status text not null default 'new',
  organization_id uuid references app_private.organizations(id) on delete restrict,
  agent_action_id uuid unique references app_private.agent_actions(id) on delete restrict,
  created_by_agent_ref text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_leads_email_check check (
    requester_email_search = lower(btrim(requester_email_search))
    and char_length(requester_email_search) between 3 and 320
  ),
  constraint partner_leads_organization_name_check check (
    char_length(btrim(organization_name)) between 1 and 200
  ),
  constraint partner_leads_website_url_check check (
    website_url is null or (
      char_length(website_url) <= 1000
      and website_url ~ '^https?://'
    )
  ),
  constraint partner_leads_summary_check check (
    char_length(btrim(request_summary)) between 1 and 4000
  ),
  constraint partner_leads_optional_summary_check check (
    (audience_summary is null or char_length(audience_summary) <= 2000)
    and (goal_summary is null or char_length(goal_summary) <= 2000)
    and (timing_summary is null or char_length(timing_summary) <= 2000)
  ),
  constraint partner_leads_thread_ref_check check (
    external_thread_ref is null or char_length(external_thread_ref) <= 300
  ),
  constraint partner_leads_status_check check (
    status in ('new','qualified','waiting_on_partner','ready_for_admin','invited','converted','closed')
  ),
  constraint partner_leads_agent_ref_check check (
    char_length(btrim(created_by_agent_ref)) between 3 and 200
  )
);

alter table app_private.partner_leads enable row level security;
revoke all on table app_private.partner_leads from public, anon, authenticated;
grant select, insert, update on table app_private.partner_leads to service_role;
create index if not exists partner_leads_status_updated_idx
  on app_private.partner_leads(status, updated_at desc);
create index if not exists partner_leads_email_idx
  on app_private.partner_leads(requester_email_search, updated_at desc);
create unique index if not exists partner_leads_open_identity_uidx
  on app_private.partner_leads(requester_email_search, lower(organization_name))
  where status in ('new','qualified','waiting_on_partner','ready_for_admin');

create table if not exists app_private.agent_message_authorizations (
  id uuid primary key default gen_random_uuid(),
  action_decision_id uuid not null unique references app_private.action_decisions(id) on delete restrict,
  agent_action_id uuid not null unique references app_private.agent_actions(id) on delete restrict,
  agent_ref text not null,
  message_category text not null,
  recipient_email_search text not null,
  donation_id uuid references app_private.donations(id) on delete restrict,
  organization_id uuid references app_private.organizations(id) on delete restrict,
  campaign_id uuid references app_private.campaigns(id) on delete restrict,
  subject text not null,
  body_summary text not null,
  content_hash text not null,
  risk app_private.risk_level not null,
  outcome app_private.action_policy_outcome not null,
  identity_verified boolean not null default false,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint agent_message_authorizations_agent_ref_check check (
    char_length(btrim(agent_ref)) between 3 and 200
  ),
  constraint agent_message_authorizations_category_check check (
    message_category ~ '^[a-z][a-z0-9_]{2,79}$'
  ),
  constraint agent_message_authorizations_email_check check (
    recipient_email_search = lower(btrim(recipient_email_search))
    and char_length(recipient_email_search) between 3 and 320
  ),
  constraint agent_message_authorizations_subject_check check (
    char_length(btrim(subject)) between 1 and 500
  ),
  constraint agent_message_authorizations_summary_check check (
    char_length(btrim(body_summary)) between 1 and 2000
  ),
  constraint agent_message_authorizations_hash_check check (
    content_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint agent_message_authorizations_expiry_check check (
    expires_at > created_at
  ),
  constraint agent_message_authorizations_consumed_check check (
    consumed_at is null or consumed_at >= created_at
  )
);

alter table app_private.agent_message_authorizations enable row level security;
revoke all on table app_private.agent_message_authorizations from public, anon, authenticated;
grant select, insert, update on table app_private.agent_message_authorizations to service_role;
create index if not exists agent_message_authorizations_open_idx
  on app_private.agent_message_authorizations(agent_ref, expires_at)
  where consumed_at is null;

create or replace function app_private.create_initial_inbound_shipment()
returns trigger
language plpgsql
set search_path = pg_catalog, app_private
as $$
begin
  insert into app_private.donation_shipments(donation_id, direction, status)
  values (new.id, 'inbound', 'not_mailed')
  on conflict (donation_id) where direction = 'inbound' do nothing;
  return new;
end;
$$;

drop trigger if exists donations_create_initial_inbound_shipment on app_private.donations;
create trigger donations_create_initial_inbound_shipment
after insert on app_private.donations
for each row execute function app_private.create_initial_inbound_shipment();

insert into app_private.donation_shipments(donation_id, direction, status)
select d.id, 'inbound', 'not_mailed'
from app_private.donations d
where not exists (
  select 1 from app_private.donation_shipments s
  where s.donation_id = d.id and s.direction = 'inbound'
)
on conflict (donation_id) where direction = 'inbound' do nothing;

do $$
begin
  if not exists (
    select 1 from app_private.action_policy_versions
    where policy_key = 'beta_agent_actions'
      and lifecycle = 'active'
      and now() >= effective_from
      and (effective_to is null or now() < effective_to)
  ) then
    raise exception 'active beta_agent_actions policy required' using errcode = '22023';
  end if;
end;
$$;

with active_policy as (
  select id
  from app_private.action_policy_versions
  where policy_key = 'beta_agent_actions'
    and lifecycle = 'active'
    and now() >= effective_from
    and (effective_to is null or now() < effective_to)
  order by version desc
  limit 1
)
insert into app_private.action_policy_rules(
  policy_version_id, command_name, actor, risk_levels, target_type,
  outcome, rationale_code, priority, conditions
)
select id, 'send_message', 'agent', array['low']::app_private.risk_level[],
  'support_email', 'ALLOW_AUTOMATICALLY', 'bounded_support_email_autonomy', 300,
  jsonb_build_object(
    'requires_exact_content_hash', true,
    'requires_identity_verification_for_private_facts', true,
    'allowed_categories', jsonb_build_array(
      'general_faq','donation_status','donation_value_status',
      'donation_shipping','donation_preparation',
      'donation_acknowledgment_process','partner_campaign_setup',
      'partner_portal_help','partner_campaign_status','internal_escalation'
    )
  )
from active_policy
where not exists (
  select 1 from app_private.action_policy_rules r
  where r.policy_version_id = active_policy.id
    and r.command_name = 'send_message'
    and r.actor = 'agent'
    and r.target_type = 'support_email'
    and r.outcome = 'ALLOW_AUTOMATICALLY'
);

with active_policy as (
  select id
  from app_private.action_policy_versions
  where policy_key = 'beta_agent_actions'
    and lifecycle = 'active'
    and now() >= effective_from
    and (effective_to is null or now() < effective_to)
  order by version desc
  limit 1
)
insert into app_private.action_policy_rules(
  policy_version_id, command_name, actor, risk_levels, target_type,
  outcome, rationale_code, priority, conditions
)
select id, 'create_partner_lead', 'agent', array['low']::app_private.risk_level[],
  'partner_lead', 'ALLOW_AUTOMATICALLY', 'bounded_partner_lead_autonomy', 300,
  jsonb_build_object('no_role_grant', true, 'no_campaign_publication', true)
from active_policy
where not exists (
  select 1 from app_private.action_policy_rules r
  where r.policy_version_id = active_policy.id
    and r.command_name = 'create_partner_lead'
    and r.actor = 'agent'
    and r.target_type = 'partner_lead'
    and r.outcome = 'ALLOW_AUTOMATICALLY'
);

create or replace function app_private.assert_agent_identity(agent_identity text)
returns void
language plpgsql
set search_path = pg_catalog, app_private
as $$
begin
  if agent_identity is null
    or char_length(btrim(agent_identity)) not between 3 and 200
    or btrim(agent_identity) !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$'
  then
    raise exception 'valid agent identity required' using errcode = '22023';
  end if;
end;
$$;

create or replace function app_private.support_content_hash(
  message_category text,
  recipient_email text,
  subject_value text,
  body_value text,
  donation_value uuid,
  organization_value uuid,
  campaign_value uuid
)
returns text
language sql
immutable
set search_path = pg_catalog, extensions
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'category', lower(btrim(message_category)),
          'recipient', lower(btrim(recipient_email)),
          'subject', btrim(subject_value),
          'body', body_value,
          'donationId', donation_value,
          'organizationId', organization_value,
          'campaignId', campaign_value
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function app_private.assert_agent_identity(text) from public, anon, authenticated;
grant execute on function app_private.assert_agent_identity(text) to service_role;
revoke all on function app_private.support_content_hash(text,text,text,text,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function app_private.support_content_hash(text,text,text,text,uuid,uuid,uuid) to service_role;
