-- Bound the remaining support snapshots.  The workspace agent must never be
-- able to turn a single support lookup into an unbounded historical export.

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
      select jsonb_agg(item order by created_at)
      from (
        select jsonb_build_object(
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
        ) item, x.created_at
        from app_private.donation_devices x
        where x.donation_id = d.id
        order by x.created_at
        limit 20
      ) bounded
    ), '[]'::jsonb),
    'timeline', coalesce((
      select jsonb_agg(item order by occurred_at)
      from (
        select jsonb_build_object(
          'status', e.status::text,
          'message', e.public_message,
          'occurredAt', e.occurred_at
        ) item, e.occurred_at
        from app_private.donation_status_events e
        where e.donation_id = d.id and e.donor_visible
        order by e.occurred_at
        limit 100
      ) bounded
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
    'bounded_verified_support_lookup', '{}'::jsonb,
    jsonb_build_object('requester_email_redacted', true, 'identity_verified', true,
      'device_limit', 20, 'timeline_limit', 100)
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
      and i.revoked_at is null and i.expires_at > now() and not i.accepted_once
  ), authorized_orgs as (
    select distinct on (id) id, access_state, role, membership_status
    from candidate_orgs
    order by id, access_priority
  )
  select
    coalesce((select jsonb_agg(item order by sort_name) from (
      select jsonb_build_object(
        'id', o.id,
        'name', o.name,
        'slug', o.slug,
        'status', o.status::text,
        'accessState', a.access_state,
        'role', a.role,
        'membershipStatus', a.membership_status,
        'verifiedCharities', coalesce((
          select jsonb_agg(item order by sort_name) from (
            select jsonb_build_object(
              'id', ch.id,
              'name', ch.canonical_name,
              'pledgeId', ch.pledge_id,
              'ein', ch.ein
            ) item, ch.canonical_name sort_name
            from app_private.organization_charities oc
            join app_private.charities ch on ch.id = oc.charity_id
            where oc.organization_id = o.id
              and oc.status = 'verified'
              and ch.status = 'verified'
            order by ch.canonical_name
            limit 50
          ) bounded_charities
        ), '[]'::jsonb),
        'campaigns', coalesce((
          select jsonb_agg(item order by sort_at desc) from (
            select jsonb_build_object(
              'id', cp.id,
              'name', cp.name,
              'slug', cp.slug,
              'status', cp.status::text,
              'charityName', cp.selected_charity_name,
              'activeRevisionId', cp.active_revision_id,
              'revisionCount', (select count(*) from app_private.campaign_revisions r where r.campaign_id = cp.id),
              'updatedAt', cp.updated_at
            ) item, cp.updated_at sort_at
            from app_private.campaigns cp
            where cp.organization_id = o.id
            order by cp.updated_at desc
            limit 50
          ) bounded_campaigns
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
      ) item, o.name sort_name
      from authorized_orgs a
      join app_private.organizations o on o.id = a.id
      order by o.name
      limit 50
    ) bounded_organizations), '[]'::jsonb),
    (select count(*)::integer from authorized_orgs)
  into organizations_value, organization_count;

  select coalesce((select jsonb_agg(item order by sort_at desc) from (
    select jsonb_build_object(
      'id', l.id,
      'organizationName', l.organization_name,
      'websiteUrl', l.website_url,
      'status', l.status,
      'updatedAt', l.updated_at
    ) item, l.updated_at sort_at
    from app_private.partner_leads l
    where l.requester_email_search = normalized_email
    order by l.updated_at desc
    limit 50
  ) bounded_leads), '[]'::jsonb)
  into leads_value;

  insert into app_private.audit_events(
    actor, actor_ref, action_name, entity_type, entity_id,
    reason_code, redacted_changes, metadata
  ) values (
    'agent', agent_identity, 'agent.support.read_partner_context', 'organization', null,
    'bounded_partner_lookup', '{}'::jsonb,
    jsonb_build_object(
      'requester_email_redacted', true,
      'organization_count', organization_count,
      'organization_limit', 50,
      'lead_count', jsonb_array_length(leads_value),
      'lead_limit', 50
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

revoke execute on function api.agent_get_donation_support_snapshot(text, uuid, text),
  api.agent_get_partner_support_snapshot(text, text) from public, anon, authenticated;
grant execute on function api.agent_get_donation_support_snapshot(text, uuid, text),
  api.agent_get_partner_support_snapshot(text, text) to service_role;
