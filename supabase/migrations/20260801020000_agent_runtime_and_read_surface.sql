-- Complete the beta agent-facing runtime without widening the database surface.
-- Agent input is still untrusted; only policy-allowed semantic commands can
-- execute, and read functions return deliberately redacted operational context.

alter table app_private.donation_internal_notes alter column created_by drop not null;
alter table app_private.donation_internal_notes add column created_by_agent text
  check (created_by_agent is null or char_length(created_by_agent) between 1 and 200);
alter table app_private.donation_internal_notes add constraint donation_internal_notes_one_actor
  check ((created_by is not null) <> (created_by_agent is not null));

alter table app_private.campaign_revisions add column requested_by_agent text
  check (requested_by_agent is null or char_length(requested_by_agent) between 1 and 200);

-- Version 2 permits bounded low-risk work to run automatically. External
-- messages, publication, and donor-visible status changes remain approval-gated
-- until an operator explicitly changes policy configuration.
update app_private.action_policy_versions
set lifecycle = 'retired', effective_to = now()
where policy_key = 'beta_agent_actions' and lifecycle = 'active';

with policy_version as (
  insert into app_private.action_policy_versions (
    policy_key, version, lifecycle, effective_from, approved_at
  ) values (
    'beta_agent_actions', 2, 'active', now(), now()
  ) returning id
)
insert into app_private.action_policy_rules (
  policy_version_id, command_name, actor, risk_levels,
  outcome, rationale_code, priority
)
select id, command_name, 'agent'::app_private.actor_kind,
  risk_levels, outcome, rationale_code, priority
from policy_version
cross join (
  values
    ('send_message', array['low']::app_private.risk_level[],
      'REQUIRE_APPROVAL'::app_private.action_policy_outcome,
      'beta_external_message_review', 100),
    ('update_campaign_content', array['low']::app_private.risk_level[],
      'ALLOW_AUTOMATICALLY'::app_private.action_policy_outcome,
      'validated_campaign_revision', 200),
    ('publish_campaign_revision', array['low', 'moderate']::app_private.risk_level[],
      'REQUIRE_APPROVAL'::app_private.action_policy_outcome,
      'beta_campaign_publish_review', 100),
    ('change_donation_status', array['low', 'moderate']::app_private.risk_level[],
      'REQUIRE_APPROVAL'::app_private.action_policy_outcome,
      'donor_visible_status_review', 100),
    ('create_partner_lead', array['low']::app_private.risk_level[],
      'ALLOW_AUTOMATICALLY'::app_private.action_policy_outcome,
      'bounded_partner_lead_creation', 200),
    ('create_internal_note', array['low']::app_private.risk_level[],
      'ALLOW_AUTOMATICALLY'::app_private.action_policy_outcome,
      'redacted_internal_note', 200),
    ('record_physical_receipt', array['low', 'moderate', 'high']::app_private.risk_level[],
      'DENY'::app_private.action_policy_outcome,
      'human_physical_receipt', 1000),
    ('record_device_valuation', array['low', 'moderate', 'high']::app_private.risk_level[],
      'DENY'::app_private.action_policy_outcome,
      'human_device_valuation', 1000),
    ('execute_disbursement', array['low', 'moderate', 'high', 'critical']::app_private.risk_level[],
      'DENY'::app_private.action_policy_outcome,
      'human_financial_execution', 1000),
    ('arbitrary_database_query', array['low', 'moderate', 'high', 'critical']::app_private.risk_level[],
      'DENY'::app_private.action_policy_outcome,
      'no_arbitrary_sql', 1000)
) as seed_rules(command_name, risk_levels, outcome, rationale_code, priority);

-- Support email autonomy uses the specialized exact-content authorizer. The
-- generic evaluator still escalates this target, while the authorizer looks up
-- this target-specific rule after validating category, identity, and content.
insert into app_private.action_policy_rules(
  policy_version_id, command_name, actor, risk_levels, target_type,
  outcome, rationale_code, priority, conditions
)
select v.id, 'send_message', 'agent', array['low']::app_private.risk_level[],
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
from app_private.action_policy_versions v
where v.policy_key = 'beta_agent_actions' and v.version = 2 and v.lifecycle = 'active';

create or replace function api.agent_get_donation_context(candidate_public_id text)
returns jsonb language plpgsql security definer volatile
set search_path = pg_catalog, app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object(
    'publicId', d.public_id,
    'status', d.status,
    'createdAt', d.created_at,
    'updatedAt', d.updated_at,
    'charity', jsonb_build_object('name', d.selected_charity_name, 'pledgeId', d.selected_charity_pledge_id),
    'devices', coalesce((select jsonb_agg(jsonb_build_object(
      'source', x.source, 'brand', coalesce(x.actual_brand, x.donor_brand),
      'model', coalesce(x.actual_model, x.donor_model),
      'receiptStatus', x.receipt_status, 'inspectionStatus', x.inspection_status,
      'processingStatus', x.processing_status, 'dataWipeStatus', x.data_wipe_status
    ) order by x.created_at) from app_private.donation_devices x where x.donation_id = d.id), '[]'::jsonb),
    'shipment', (select jsonb_build_object(
      'status', s.status, 'carrier', s.carrier,
      'trackingLastFour', case when s.tracking_number is null then null else right(s.tracking_number, 4) end,
      'mailedAt', s.mailed_at, 'deliveredAt', s.delivered_at
    ) from app_private.donation_shipments s where s.donation_id = d.id and s.direction = 'inbound'),
    'history', coalesce((select jsonb_agg(jsonb_build_object(
      'status', e.status, 'message', e.public_message, 'occurredAt', e.occurred_at
    ) order by e.occurred_at) from app_private.donation_status_events e where e.donation_id = d.id), '[]'::jsonb)
  ) into result
  from app_private.donations d
  where d.public_id = upper(trim(candidate_public_id));
  return result;
end $$;

create or replace function api.agent_get_campaign_metrics(candidate_campaign_id uuid)
returns jsonb language plpgsql security definer volatile
set search_path = pg_catalog, app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object(
    'campaignId', c.id, 'slug', c.slug, 'name', c.name, 'status', c.status,
    'donations', (select count(*) from app_private.donations d where d.campaign_id = c.id),
    'submittedDonations', (select count(*) from app_private.donations d where d.campaign_id = c.id and d.status = 'submitted'),
    'receivedDonations', (select count(*) from app_private.donations d where d.campaign_id = c.id and d.received_at is not null),
    'completedDonations', (select count(*) from app_private.donations d where d.campaign_id = c.id and d.status = 'completed'),
    'events', coalesce((select jsonb_object_agg(event_type, event_count) from (
      select event_type, count(*) as event_count from app_private.campaign_events
      where campaign_id = c.id group by event_type
    ) rollup), '{}'::jsonb)
  ) into result
  from app_private.campaigns c where c.id = candidate_campaign_id;
  return result;
end $$;

create or replace function api.agent_get_partner_context(candidate_organization_id uuid)
returns jsonb language plpgsql security definer volatile
set search_path = pg_catalog, app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object(
    'organization', jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug, 'status', o.status),
    'charities', coalesce((select jsonb_agg(jsonb_build_object('id', ch.id, 'name', ch.canonical_name, 'pledgeId', ch.pledge_id) order by ch.canonical_name)
      from app_private.organization_charities oc join app_private.charities ch on ch.id = oc.charity_id
      where oc.organization_id = o.id and oc.status = 'verified' and ch.status = 'verified'), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'status', c.status, 'metrics', api.agent_get_campaign_metrics(c.id)) order by c.updated_at desc)
      from app_private.campaigns c where c.organization_id = o.id), '[]'::jsonb)
  ) into result
  from app_private.organizations o where o.id = candidate_organization_id;
  return result;
end $$;

create or replace function api.agent_execute_command(
  decision_id_value uuid, agent_identity text, command_value text,
  target_id_value uuid, payload_value jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, app_private as $$
declare decision_row app_private.action_decisions%rowtype;
  result jsonb; note_id uuid; revision_id uuid; lead_id uuid; agent_action_id uuid;
  body_value text; headline_value text; summary_value text; story_value text; cta_value text;
  blocks_value jsonb; canonical_hash text; next_version integer; campaign_id_value uuid;
  email_value text; normalized_email text; display_name_value text; organization_name_value text; notes_value text;
begin
  perform app_private.assert_service_role();
  select * into decision_row from app_private.action_decisions
  where id = decision_id_value and actor = 'agent' and actor_ref = agent_identity
  for update;
  if decision_row.id is null then raise exception 'agent decision required' using errcode = '42501'; end if;
  if decision_row.command_name <> command_value or decision_row.target_id is distinct from target_id_value
    then raise exception 'agent decision target mismatch' using errcode = '42501'; end if;
  if decision_row.outcome <> 'ALLOW_AUTOMATICALLY' then raise exception 'agent command is not automatically allowed' using errcode = '42501'; end if;
  if exists(select 1 from app_private.action_execution_results where action_decision_id = decision_row.id and status = 'executed') then
    select result_metadata into result from app_private.action_execution_results where action_decision_id = decision_row.id order by created_at desc limit 1;
    return jsonb_build_object('executed', true, 'replayed', true, 'result', coalesce(result, '{}'::jsonb));
  end if;
  if jsonb_typeof(coalesce(payload_value, '{}'::jsonb)) <> 'object' then raise exception 'agent payload must be an object' using errcode = '22023'; end if;

  if command_value = 'create_internal_note' then
    body_value := nullif(trim(payload_value->>'body'), '');
    if target_id_value is null or body_value is null or char_length(body_value) > 4000 then raise exception 'bounded internal note required' using errcode = '22023'; end if;
    if not exists(select 1 from app_private.donations where id = target_id_value) then raise exception 'donation target required' using errcode = '22023'; end if;
    insert into app_private.donation_internal_notes(donation_id, body, created_by_agent)
      values(target_id_value, body_value, agent_identity) returning id into note_id;
    result := jsonb_build_object('noteId', note_id);
    insert into app_private.audit_events(actor, actor_ref, action_name, entity_type, entity_id, reason_code, redacted_changes, metadata)
      values('agent', agent_identity, 'agent.create_internal_note', 'donation', target_id_value, 'policy_allowed_internal_note', jsonb_build_object('body_length', char_length(body_value)), jsonb_build_object('pii_redacted', true));
  elsif command_value = 'create_partner_lead' then
    email_value := nullif(lower(trim(payload_value->>'email')), '');
    normalized_email := email_value;
    display_name_value := nullif(trim(payload_value->>'displayName'), '');
    organization_name_value := nullif(trim(payload_value->>'organizationName'), '');
    notes_value := nullif(trim(payload_value->>'notes'), '');
    if normalized_email is null or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or char_length(normalized_email) > 320 then raise exception 'valid partner lead email required' using errcode = '22023'; end if;
    if display_name_value is not null and char_length(display_name_value) > 160 then raise exception 'partner lead name too long' using errcode = '22023'; end if;
    if organization_name_value is not null and char_length(organization_name_value) > 240 then raise exception 'partner lead organization too long' using errcode = '22023'; end if;
    if notes_value is not null and char_length(notes_value) > 2000 then raise exception 'partner lead notes too long' using errcode = '22023'; end if;
    select id into agent_action_id from app_private.agent_actions where action_decision_id = decision_row.id;
    insert into app_private.partner_leads(
      requester_email_search, organization_name, request_summary,
      agent_action_id, created_by_agent_ref
    ) values(
      normalized_email,
      coalesce(nullif(organization_name_value, ''), 'Prospective nonprofit'),
      coalesce(notes_value, 'Partner lead created by the operations agent.'),
      agent_action_id, agent_identity
    ) returning id into lead_id;
    result := jsonb_build_object('leadId', lead_id, 'stage', 'new');
    insert into app_private.audit_events(actor, actor_ref, action_name, entity_type, entity_id, reason_code, redacted_changes, metadata)
      values('agent', agent_identity, 'agent.create_partner_lead', 'partner_lead', lead_id, 'policy_allowed_lead_creation', jsonb_build_object('email_redacted', true), jsonb_build_object('pii_redacted', true));
  elsif command_value = 'update_campaign_content' then
    campaign_id_value := target_id_value;
    headline_value := nullif(trim(payload_value->>'headline'), '');
    summary_value := nullif(trim(payload_value->>'summary'), '');
    story_value := nullif(trim(payload_value->>'story'), '');
    cta_value := coalesce(nullif(trim(payload_value->>'ctaLabel'), ''), 'Donate a Phone');
    blocks_value := coalesce(payload_value->'blocks', '[]'::jsonb);
    if campaign_id_value is null or headline_value is null or char_length(headline_value) > 160 or summary_value is null or char_length(summary_value) > 600 or story_value is null or char_length(story_value) > 12000 or char_length(cta_value) > 80 or payload_value ? 'heroAssetId' or payload_value ? 'supportingAssetId' or not app_private.validate_campaign_blocks(blocks_value) then raise exception 'bounded text campaign content required; assets require the reviewed staff workflow' using errcode = '22023'; end if;
    if not exists(select 1 from app_private.campaigns where id = campaign_id_value and status not in ('archived','completed')) then raise exception 'editable campaign target required' using errcode = '22023'; end if;
    select coalesce(max(version), 0) + 1 into next_version from app_private.campaign_revisions where campaign_id = campaign_id_value;
    canonical_hash := encode(extensions.digest(convert_to(jsonb_build_object('headline', headline_value, 'summary', summary_value, 'story', story_value, 'ctaLabel', cta_value, 'heroAssetId', payload_value->'heroAssetId', 'supportingAssetId', payload_value->'supportingAssetId', 'blocks', blocks_value)::text, 'utf8'), 'sha256'), 'hex');
    insert into app_private.campaign_revisions(campaign_id, version, headline, summary, story, cta_label, content_hash, content_blocks, requested_by_agent)
      values(campaign_id_value, next_version, headline_value, summary_value, story_value, cta_value, canonical_hash, blocks_value, agent_identity) returning id into revision_id;
    result := jsonb_build_object('revisionId', revision_id, 'version', next_version, 'contentHash', canonical_hash, 'status', 'draft');
    insert into app_private.audit_events(actor, actor_ref, action_name, entity_type, entity_id, reason_code, redacted_changes, metadata)
      values('agent', agent_identity, 'agent.update_campaign_content', 'campaign_revision', revision_id, 'policy_allowed_campaign_revision', jsonb_build_object('content_hash', canonical_hash, 'version', next_version), jsonb_build_object('campaign_id', campaign_id_value));
  else
    raise exception 'unsupported automatically executable command' using errcode = '22023';
  end if;

  update app_private.agent_actions set status = 'completed', updated_at = now() where action_decision_id = decision_row.id;
  insert into app_private.action_execution_results(action_decision_id, status, executor, executor_ref, result_metadata, verification_metadata)
    values(decision_row.id, 'executed', 'agent', agent_identity, coalesce(result, '{}'::jsonb), jsonb_build_object('server_validated', true));
  return jsonb_build_object('executed', true, 'replayed', false, 'result', coalesce(result, '{}'::jsonb));
exception when others then
  if decision_row.id is not null then
    update app_private.agent_actions set status = 'failed', updated_at = now() where action_decision_id = decision_row.id;
    insert into app_private.action_execution_results(action_decision_id, status, executor, executor_ref, result_metadata, verification_metadata)
      values(decision_row.id, 'failed', 'agent', agent_identity, jsonb_build_object('error_code', SQLSTATE), jsonb_build_object('server_validated', false));
  end if;
  raise;
end $$;

revoke all on function api.agent_get_donation_context(text), api.agent_get_campaign_metrics(uuid),
  api.agent_get_partner_context(uuid), api.agent_execute_command(uuid, text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function api.agent_get_donation_context(text), api.agent_get_campaign_metrics(uuid),
  api.agent_get_partner_context(uuid), api.agent_execute_command(uuid, text, text, uuid, jsonb)
  to service_role;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.signature);
  end loop;
end $$;
