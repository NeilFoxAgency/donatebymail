create or replace function api.agent_support_capabilities(agent_identity text)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.assert_service_role();
  perform app_private.assert_agent_identity(agent_identity);
  return jsonb_build_object(
    'agentIdentity', agent_identity,
    'automaticEmailCategories', jsonb_build_array(
      'general_faq','donation_status','donation_value_status',
      'donation_shipping','donation_preparation',
      'donation_acknowledgment_process','partner_campaign_setup',
      'partner_portal_help','partner_campaign_status','internal_escalation'
    ),
    'automaticWrites', jsonb_build_array(
      'record_inbound_message','record_outbound_message','create_partner_lead','set_communication_thread_status'
    ),
    'approvalRequired', jsonb_build_array(
      'campaign_content_change','campaign_publication','external_access_change',
      'nonroutine_or_sensitive_message'
    ),
    'humanOnly', jsonb_build_array(
      'physical_receipt','device_inspection','device_wipe_verification',
      'device_valuation','financial_finalization_approval','disbursement_execution',
      'role_or_credential_administration','production_deployment',
      'arbitrary_database_query','unrestricted_pii_export'
    ),
    'databaseAccess', 'bounded_rpc_only'
  );
end;
$$;

create or replace function api.agent_find_donations(
  agent_identity text,
  requester_email text,
  public_id_hint text default null,
  result_limit integer default 10
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = pg_catalog, app_private
as $$
declare
  normalized_email text := lower(btrim(coalesce(requester_email, '')));
  normalized_public_id text := nullif(upper(btrim(coalesce(public_id_hint, ''))), '');
  result jsonb;
  result_count integer;
  verified_count integer;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_agent_identity(agent_identity);
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or result_limit not between 1 and 25
    or (normalized_public_id is not null and normalized_public_id !~ '^DBM-[0-9]{8}-[A-F0-9]{8}$')
  then
    raise exception 'bounded donor lookup inputs required' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb),
    count(*)::integer,
    count(*) filter (where identity_verified)::integer
  into result, result_count, verified_count
  from (
    select jsonb_build_object(
      'donationId', case when c.email_search = normalized_email then d.id else null end,
      'publicId', d.public_id,
      'identityVerified', c.email_search = normalized_email,
      'status', case when c.email_search = normalized_email then d.status::text else null end,
      'charityName', case when c.email_search = normalized_email then d.selected_charity_name else null end,
      'deviceCount', case when c.email_search = normalized_email then
        (select count(*) from app_private.donation_devices x where x.donation_id = d.id)
        else null end,
      'createdAt', case when c.email_search = normalized_email then d.created_at else null end,
      'receivedAt', case when c.email_search = normalized_email then d.received_at else null end,
      'completedAt', case when c.email_search = normalized_email then d.completed_at else null end
    ) as item,
    d.created_at,
    (c.email_search = normalized_email) as identity_verified
    from app_private.donations d
    join app_private.donor_contacts c on c.id = d.donor_contact_id
    where (
      normalized_public_id is not null and d.public_id = normalized_public_id
    ) or (
      normalized_public_id is null and c.email_search = normalized_email
    )
    order by d.created_at desc
    limit result_limit
  ) matches;

  insert into app_private.audit_events(
    actor, actor_ref, action_name, entity_type, entity_id,
    reason_code, redacted_changes, metadata
  ) values (
    'agent', agent_identity, 'agent.support.search_donations', 'donation', null,
    'bounded_support_lookup', '{}'::jsonb,
    jsonb_build_object(
      'public_id_supplied', normalized_public_id is not null,
      'result_count', result_count,
      'identity_verified_count', verified_count,
      'requester_email_redacted', true
    )
  );

  return jsonb_build_object(
    'matches', result,
    'resultCount', result_count,
    'identityVerifiedCount', verified_count,
    'lookupRule', 'exact sender email or exact public donation ID only'
  );
end;
$$;

create or replace function api.agent_get_donation_support_snapshot(
  agent_identity text,
  candidate_donation_id uuid,
  requester_email text
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = pg_catalog, app_private
as $$
declare
  d app_private.donations%rowtype;
  c app_private.donor_contacts%rowtype;
  normalized_email text := lower(btrim(coalesce(requester_email, '')));
  identity_ok boolean := false;
  assessment_total bigint := 0;
  gross_sales bigint := 0;
  allocation_value jsonb;
  disbursed_value boolean := false;
  result jsonb;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_agent_identity(agent_identity);
  select * into d from app_private.donations where id = candidate_donation_id;
  if d.id is null then return jsonb_build_object('found', false); end if;
  select * into c from app_private.donor_contacts where id = d.donor_contact_id;
  identity_ok := c.email_search = normalized_email;

  if not identity_ok then
    insert into app_private.audit_events(
      actor, actor_ref, action_name, entity_type, entity_id,
      reason_code, redacted_changes, metadata
    ) values (
      'agent', agent_identity, 'agent.support.read_donation_denied', 'donation', d.id,
      'requester_identity_mismatch', '{}'::jsonb,
      jsonb_build_object('requester_email_redacted', true)
    );
    return jsonb_build_object(
      'found', true,
      'publicId', d.public_id,
      'identityVerified', false,
      'escalationRequired', true,
      'nextStep', 'Ask the requester to reply from the original donation email or provide the secure tracking link.'
    );
  end if;

  select coalesce(sum(x.assessed_value_cents), 0)
  into assessment_total
  from app_private.donation_devices x
  where x.donation_id = d.id and x.assessed_value_cents is not null;

  select coalesce(sum(s.gross_amount_cents), 0)
  into gross_sales
  from app_private.effective_device_sales s
  join app_private.donation_devices x on x.id = s.device_id
  where x.donation_id = d.id;

  select jsonb_build_object(
    'id', a.id,
    'status', a.status::text,
    'settlementStatus', a.settlement_status,
    'grossCents', a.gross_cents,
    'eligibleCostCents', a.eligible_cost_cents,
    'allocableBaseCents', a.allocable_base_cents,
    'shareBasisPoints', a.share_basis_points,
    'allocatedCents', a.allocated_cents,
    'currency', a.currency,
    'calculatedAt', a.calculated_at
  ) into allocation_value
  from app_private.proceeds_allocations a
  where a.donation_id = d.id
    and a.status in ('policy_hold','calculated','approved','disbursed')
    and not exists (
      select 1 from app_private.proceeds_allocations reversal
      where reversal.status = 'reversed' and reversal.reversal_of = a.id
    )
  order by a.created_at desc
  limit 1;

  select exists(
    select 1
    from app_private.proceeds_allocations a
    join app_private.disbursement_preparation_allocations pa on pa.allocation_id = a.id
    join app_private.disbursements ds on ds.preparation_id = pa.preparation_id
    where a.donation_id = d.id and ds.status = 'completed'
  ) into disbursed_value;

  select jsonb_build_object(
    'found', true,
    'identityVerified', true,
    'donor', jsonb_build_object('firstName', c.first_name),
    'donation', jsonb_build_object(
      'id', d.id,
      'publicId', d.public_id,
      'status', d.status::text,
      'charityName', d.selected_charity_name,
      'campaignId', d.campaign_id,
      'createdAt', d.created_at,
      'receivedAt', d.received_at,
      'completedAt', d.completed_at,
      'policyResolutionStatus', d.policy_resolution_status,
      'financialInputsFinalizedAt', d.financial_inputs_finalized_at,
      'financialRevision', d.financial_revision
    ),
    'shipment', coalesce((
      select jsonb_build_object(
        'status', s.status::text,
        'carrier', s.carrier,
        'trackingLastFour', case when s.tracking_number is null then null else right(s.tracking_number, 4) end,
        'mailedAt', s.mailed_at,
        'deliveredAt', s.delivered_at
      )
      from app_private.donation_shipments s
      where s.donation_id = d.id and s.direction = 'inbound'
      order by s.created_at desc
      limit 1
    ), jsonb_build_object('status', 'not_mailed')),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id,
        'label', btrim(concat_ws(' ', coalesce(x.actual_brand, x.donor_brand), coalesce(x.actual_model, x.donor_model))),
        'receiptStatus', x.receipt_status::text,
        'inspectionStatus', x.inspection_status::text,
        'processingStatus', x.processing_status::text,
        'dataWipeStatus', x.data_wipe_status::text,
        'assessedValueCents', x.assessed_value_cents,
        'receivedAt', x.received_at,
        'inspectedAt', x.inspected_at,
        'valuedAt', x.valued_at,
        'wipeVerifiedAt', x.wipe_verified_at
      ) order by x.created_at)
      from app_private.donation_devices x
      where x.donation_id = d.id
    ), '[]'::jsonb),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
        'status', e.status::text,
        'message', e.public_message,
        'occurredAt', e.occurred_at
      ) order by e.occurred_at)
      from app_private.donation_status_events e
      where e.donation_id = d.id and e.donor_visible
    ), '[]'::jsonb),
    'value', jsonb_build_object(
      'assessmentTotalCents', assessment_total,
      'effectiveGrossSaleCents', gross_sales,
      'allocation', allocation_value,
      'disbursementCompleted', disbursed_value,
      'taxValueCents', null,
      'taxValueProvided', false,
      'finalProceedsKnown', allocation_value is not null and (allocation_value ->> 'allocatedCents') is not null,
      'interpretation', case
        when allocation_value is not null and (allocation_value ->> 'allocatedCents') is not null
          then 'A proceeds allocation is recorded. It is not a tax valuation.'
        when gross_sales > 0
          then 'Gross sale proceeds are recorded, but a final charity allocation is not yet available.'
        when assessment_total > 0
          then 'An internal device assessment is recorded, but no final sale proceeds or charity allocation is available.'
        else 'No authoritative value has been recorded yet.'
      end
    )
  ) into result;

  insert into app_private.audit_events(
    actor, actor_ref, action_name, entity_type, entity_id,
    reason_code, redacted_changes, metadata
  ) values (
    'agent', agent_identity, 'agent.support.read_donation', 'donation', d.id,
    'verified_support_lookup', '{}'::jsonb,
    jsonb_build_object('requester_email_redacted', true, 'identity_verified', true)
  );

  return result;
end;
$$;

create or replace function api.agent_get_partner_support_snapshot(
  agent_identity text,
  requester_email text
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = pg_catalog, app_private, auth
as $$
declare
  normalized_email text := lower(btrim(coalesce(requester_email, '')));
  organizations_value jsonb;
  leads_value jsonb;
  organization_count integer;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_agent_identity(agent_identity);
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'valid requester email required' using errcode = '22023';
  end if;

  with candidate_orgs as (
    select o.id,
      'active_member'::text as access_state,
      m.role::text as role,
      m.status::text as membership_status,
      1 as access_priority
    from app_private.organizations o
    join app_private.organization_memberships m on m.organization_id = o.id
    join auth.users u on u.id = m.user_id
    where lower(u.email) = normalized_email and m.status = 'active'
    union all
    select o.id,
      'invited'::text as access_state,
      i.role::text as role,
      i.status::text as membership_status,
      2 as access_priority
    from app_private.organizations o
    join app_private.partner_invitations i on i.organization_id = o.id
    where i.email_search = normalized_email and i.status = 'invited'
  ), authorized_orgs as (
    select distinct on (id) id, access_state, role, membership_status
    from candidate_orgs
    order by id, access_priority
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id,
    'name', o.name,
    'slug', o.slug,
    'status', o.status::text,
    'accessState', a.access_state,
    'role', a.role,
    'membershipStatus', a.membership_status,
    'verifiedCharities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ch.id,
        'name', ch.canonical_name,
        'pledgeId', ch.pledge_id,
        'ein', ch.ein
      ) order by ch.canonical_name)
      from app_private.organization_charities oc
      join app_private.charities ch on ch.id = oc.charity_id
      where oc.organization_id = o.id
        and oc.status = 'verified'
        and ch.status = 'verified'
    ), '[]'::jsonb),
    'campaigns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cp.id,
        'name', cp.name,
        'slug', cp.slug,
        'status', cp.status::text,
        'charityName', cp.selected_charity_name,
        'activeRevisionId', cp.active_revision_id,
        'revisionCount', (select count(*) from app_private.campaign_revisions r where r.campaign_id = cp.id),
        'updatedAt', cp.updated_at
      ) order by cp.updated_at desc)
      from app_private.campaigns cp
      where cp.organization_id = o.id
    ), '[]'::jsonb),
    'setupChecklist', jsonb_build_object(
      'organizationActive', o.status = 'active',
      'hasVerifiedCharity', exists(
        select 1 from app_private.organization_charities oc
        join app_private.charities ch on ch.id = oc.charity_id
        where oc.organization_id = o.id
          and oc.status = 'verified' and ch.status = 'verified'
      ),
      'hasActiveMember', a.access_state = 'active_member',
      'campaignCount', (select count(*) from app_private.campaigns cp where cp.organization_id = o.id)
    )
  ) order by o.name), '[]'::jsonb), count(*)::integer
  into organizations_value, organization_count
  from authorized_orgs a
  join app_private.organizations o on o.id = a.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'organizationName', l.organization_name,
    'websiteUrl', l.website_url,
    'status', l.status,
    'updatedAt', l.updated_at
  ) order by l.updated_at desc), '[]'::jsonb)
  into leads_value
  from app_private.partner_leads l
  where l.requester_email_search = normalized_email;

  insert into app_private.audit_events(
    actor, actor_ref, action_name, entity_type, entity_id,
    reason_code, redacted_changes, metadata
  ) values (
    'agent', agent_identity, 'agent.support.read_partner_context', 'organization', null,
    'bounded_partner_lookup', '{}'::jsonb,
    jsonb_build_object(
      'requester_email_redacted', true,
      'organization_count', organization_count,
      'lead_count', jsonb_array_length(leads_value)
    )
  );

  return jsonb_build_object(
    'existingPartner', organization_count > 0,
    'organizations', organizations_value,
    'leads', leads_value,
    'recommendedNextStep', case
      when organization_count = 0 and jsonb_array_length(leads_value) = 0 then 'create_partner_lead'
      when organization_count = 0 then 'continue_lead_qualification'
      else 'use_the_setup_checklist_and_campaign_status'
    end
  );
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
      'agentEscalations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.id,
          'severity', e.severity::text,
          'reasonCode', e.reason_code,
          'summary', e.summary,
          'createdAt', e.created_at
        ) order by e.created_at)
        from app_private.agent_escalations e
        where e.status = 'open'
      ), '[]'::jsonb),
      'failedOutboxEvents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', o.id,
          'eventType', o.event_type,
          'handlerKey', o.handler_key,
          'attemptCount', o.attempt_count,
          'lastErrorCode', o.last_error_code,
          'updatedAt', o.updated_at
        ) order by o.updated_at)
        from app_private.outbox_events o
        where o.status = 'failed'
      ), '[]'::jsonb),
      'financialApprovals', coalesce((
        select jsonb_agg(jsonb_build_object(
          'disbursementId', d.id,
          'preparationId', d.preparation_id,
          'status', d.status::text,
          'createdAt', d.created_at
        ) order by d.created_at)
        from app_private.disbursements d
        where d.status in ('prepared','approved')
      ), '[]'::jsonb)
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

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='api' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end;
$$;
