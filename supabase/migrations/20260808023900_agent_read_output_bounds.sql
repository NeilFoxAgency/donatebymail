-- Keep agent read responses bounded as operational history grows. Aggregate
-- counters remain complete; queue/context arrays are intentionally capped so
-- an agent call cannot become an unbounded data export or oversized response.

create or replace function api.agent_get_donation_context(candidate_public_id text)
returns jsonb
language plpgsql
security definer
volatile
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object(
    'publicId', d.public_id,
    'status', d.status,
    'createdAt', d.created_at,
    'updatedAt', d.updated_at,
    'charity', jsonb_build_object('name', d.selected_charity_name, 'pledgeId', d.selected_charity_pledge_id),
    'devices', coalesce((select jsonb_agg(item order by created_at) from (
      select jsonb_build_object(
        'source', x.source, 'brand', coalesce(x.actual_brand, x.donor_brand),
        'model', coalesce(x.actual_model, x.donor_model),
        'receiptStatus', x.receipt_status, 'inspectionStatus', x.inspection_status,
        'processingStatus', x.processing_status, 'dataWipeStatus', x.data_wipe_status
      ) item, x.created_at
      from app_private.donation_devices x
      where x.donation_id = d.id
      order by x.created_at
      limit 20
    ) bounded), '[]'::jsonb),
    'shipment', (select jsonb_build_object(
      'status', s.status, 'carrier', s.carrier,
      'trackingLastFour', case when s.tracking_number is null then null else right(s.tracking_number, 4) end,
      'mailedAt', s.mailed_at, 'deliveredAt', s.delivered_at
    ) from app_private.donation_shipments s where s.donation_id = d.id and s.direction = 'inbound'),
    'history', coalesce((select jsonb_agg(item order by occurred_at) from (
      select jsonb_build_object(
        'status', e.status, 'message', e.public_message, 'occurredAt', e.occurred_at
      ) item, e.occurred_at
      from app_private.donation_status_events e
      where e.donation_id = d.id
      order by e.occurred_at
      limit 100
    ) bounded), '[]'::jsonb)
  ) into result
  from app_private.donations d
  where d.public_id = upper(trim(candidate_public_id));
  return result;
end;
$$;

create or replace function api.agent_get_partner_context(candidate_organization_id uuid)
returns jsonb language plpgsql security definer volatile
set search_path = pg_catalog, app_private as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  select jsonb_build_object(
    'organization', jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug, 'status', o.status),
    'charities', coalesce((select jsonb_agg(item order by sort_name) from (
      select jsonb_build_object('id', ch.id, 'name', ch.canonical_name, 'pledgeId', ch.pledge_id) item,
        ch.canonical_name sort_name
      from app_private.organization_charities oc
      join app_private.charities ch on ch.id = oc.charity_id
      where oc.organization_id = o.id and oc.status = 'verified' and ch.status = 'verified'
      order by ch.canonical_name
      limit 50
    ) bounded), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(item order by sort_at desc) from (
      select jsonb_build_object('id', c.id, 'slug', c.slug, 'name', c.name, 'status', c.status,
        'metrics', api.agent_get_campaign_metrics(c.id)) item, c.updated_at sort_at
      from app_private.campaigns c
      where c.organization_id = o.id
      order by c.updated_at desc
      limit 50
    ) bounded), '[]'::jsonb)
  ) into result
  from app_private.organizations o where o.id = candidate_organization_id;
  return result;
end;
$$;

create or replace function api.agent_get_operations_overview(agent_identity text)
returns jsonb
language plpgsql
security definer
volatile
set search_path = pg_catalog, app_private
as $$
declare result jsonb;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_agent_identity(agent_identity);
  select jsonb_build_object(
    'donationsByStatus', coalesce((
      select jsonb_object_agg(status::text, item_count)
      from (select status, count(*)::integer item_count from app_private.donations group by status) x
    ), '{}'::jsonb),
    'shipmentsByStatus', coalesce((
      select jsonb_object_agg(status::text, item_count)
      from (select status, count(*)::integer item_count from app_private.donation_shipments group by status) x
    ), '{}'::jsonb),
    'policyHolds', (select count(*) from app_private.donations where policy_resolution_status = 'policy_hold'),
    'failedOutbox', (select count(*) from app_private.outbox_events where status = 'failed'),
    'openAgentEscalations', (select count(*) from app_private.agent_escalations where status = 'open'),
    'openCommunicationThreads', (select count(*) from app_private.communication_threads where status in ('open','waiting_on_staff')),
    'openPartnerLeads', (select count(*) from app_private.partner_leads where status not in ('converted','closed')),
    'disbursementsRequiringHumanAction', (
      select count(*) from app_private.disbursements where status in ('prepared','approved')
    ),
    'humanActionQueue', jsonb_build_object(
      'agentEscalations', coalesce((select jsonb_agg(item order by created_at) from (
        select jsonb_build_object(
          'id', e.id, 'severity', e.severity::text, 'reasonCode', e.reason_code,
          'summary', e.summary, 'createdAt', e.created_at
        ) item, e.created_at
        from app_private.agent_escalations e
        where e.status = 'open'
        order by e.created_at
        limit 100
      ) bounded), '[]'::jsonb),
      'failedOutboxEvents', coalesce((select jsonb_agg(item order by updated_at) from (
        select jsonb_build_object(
          'id', o.id, 'eventType', o.event_type, 'handlerKey', o.handler_key,
          'attemptCount', o.attempt_count, 'lastErrorCode', o.last_error_code,
          'updatedAt', o.updated_at
        ) item, o.updated_at
        from app_private.outbox_events o
        where o.status = 'failed'
        order by o.updated_at
        limit 100
      ) bounded), '[]'::jsonb),
      'financialApprovals', coalesce((select jsonb_agg(item order by created_at) from (
        select jsonb_build_object(
          'disbursementId', d.id, 'preparationId', d.preparation_id,
          'status', d.status::text, 'createdAt', d.created_at
        ) item, d.created_at
        from app_private.disbursements d
        where d.status in ('prepared','approved')
        order by d.created_at
        limit 100
      ) bounded), '[]'::jsonb)
    )
  ) into result;

  insert into app_private.audit_events(
    actor, actor_ref, action_name, entity_type, entity_id,
    reason_code, redacted_changes, metadata
  ) values (
    'agent', agent_identity, 'agent.operations.read_overview', 'audit_event', null,
    'bounded_operations_overview', '{}'::jsonb, '{}'::jsonb
  );
  return result;
end;
$$;

revoke execute on function api.agent_get_donation_context(text), api.agent_get_partner_context(uuid),
  api.agent_get_operations_overview(text) from public, anon, authenticated;
grant execute on function api.agent_get_donation_context(text), api.agent_get_partner_context(uuid),
  api.agent_get_operations_overview(text) to service_role;
