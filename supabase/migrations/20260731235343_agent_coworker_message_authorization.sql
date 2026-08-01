create or replace function api.agent_authorize_support_message(
  agent_identity text,
  message_category text,
  recipient_email text,
  subject_value text,
  body_value text,
  body_summary_value text,
  idempotency_value text,
  correlation_value uuid default null,
  candidate_donation_id uuid default null,
  candidate_organization_id uuid default null,
  candidate_campaign_id uuid default null,
  requests_financial_action boolean default false,
  requests_legal_or_tax_advice boolean default false,
  requests_access_change boolean default false,
  security_or_privacy_incident boolean default false,
  complaint_or_threat boolean default false
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = pg_catalog, app_private, auth
as $$
declare
  normalized_email text := lower(btrim(coalesce(recipient_email, '')));
  normalized_category text := lower(btrim(coalesce(message_category, '')));
  safe_category boolean := false;
  identity_required boolean := false;
  identity_ok boolean := false;
  risk_value app_private.risk_level := 'moderate';
  target_value uuid := coalesce(candidate_donation_id, candidate_organization_id, candidate_campaign_id);
  content_hash_value text;
  policy_id_value uuid;
  rule_id_value uuid;
  outcome_value app_private.action_policy_outcome;
  rationale_value text;
  decision_id_value uuid;
  action_id_value uuid;
  authorization_id_value uuid;
  existing_decision app_private.action_decisions%rowtype;
  existing_action app_private.agent_actions%rowtype;
  existing_authorization app_private.agent_message_authorizations%rowtype;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_agent_identity(agent_identity);

  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or normalized_category !~ '^[a-z][a-z0-9_]{2,79}$'
    or char_length(btrim(coalesce(subject_value, ''))) not between 1 and 500
    or char_length(coalesce(body_value, '')) not between 1 and 12000
    or char_length(btrim(coalesce(body_summary_value, ''))) not between 1 and 2000
    or char_length(btrim(coalesce(idempotency_value, ''))) not between 8 and 200
  then
    raise exception 'bounded support message inputs required' using errcode = '22023';
  end if;

  safe_category := normalized_category in (
    'general_faq','donation_status','donation_value_status',
    'donation_shipping','donation_preparation',
    'donation_acknowledgment_process','partner_campaign_setup',
    'partner_portal_help','partner_campaign_status','internal_escalation'
  );
  if normalized_category = 'internal_escalation'
    and normalized_email <> 'tre@donatebymail.org' then
    safe_category := false;
  end if;

  identity_required := normalized_category in (
    'donation_status','donation_value_status','donation_shipping',
    'partner_portal_help','partner_campaign_status'
  );

  if candidate_campaign_id is not null and (
    candidate_organization_id is null or not exists (
      select 1 from app_private.campaigns cp
      where cp.id = candidate_campaign_id
        and cp.organization_id = candidate_organization_id
    )
  ) then
    raise exception 'campaign and organization context do not match' using errcode = '22023';
  end if;

  if candidate_donation_id is not null then
    identity_ok := exists(
      select 1
      from app_private.donations d
      join app_private.donor_contacts c on c.id = d.donor_contact_id
      where d.id = candidate_donation_id and c.email_search = normalized_email
    );
  elsif candidate_organization_id is not null then
    identity_ok := exists(
      select 1
      from app_private.organization_memberships m
      join auth.users u on u.id = m.user_id
      where m.organization_id = candidate_organization_id
        and m.status = 'active' and lower(u.email) = normalized_email
    ) or exists(
      select 1 from app_private.partner_invitations i
      where i.organization_id = candidate_organization_id
        and i.status = 'invited' and i.email_search = normalized_email
    );
  elsif not identity_required then
    identity_ok := true;
  end if;

  if normalized_category = 'internal_escalation'
    and normalized_email = 'tre@donatebymail.org' then
    risk_value := 'low';
  elsif security_or_privacy_incident or complaint_or_threat then
    risk_value := 'high';
  elsif requests_financial_action or requests_legal_or_tax_advice or requests_access_change then
    risk_value := 'moderate';
  elsif not safe_category or (identity_required and not identity_ok) then
    risk_value := 'moderate';
  else
    risk_value := 'low';
  end if;

  content_hash_value := app_private.support_content_hash(
    normalized_category, normalized_email, btrim(subject_value), body_value,
    candidate_donation_id, candidate_organization_id, candidate_campaign_id
  );

  select * into existing_decision
  from app_private.action_decisions
  where actor = 'agent'
    and actor_ref = agent_identity
    and idempotency_key = idempotency_value;

  if existing_decision.id is not null then
    if existing_decision.input_hash <> content_hash_value
      or existing_decision.command_name <> 'send_message'
      or existing_decision.target_type <> 'support_email'
      or existing_decision.target_id is distinct from target_value
    then
      raise exception 'agent idempotency payload mismatch' using errcode = '23505';
    end if;
    select * into existing_action
    from app_private.agent_actions
    where action_decision_id = existing_decision.id;
    select * into existing_authorization
    from app_private.agent_message_authorizations
    where action_decision_id = existing_decision.id;
    if existing_action.id is null or existing_authorization.id is null then
      raise exception 'incomplete prior authorization transaction' using errcode = '55000';
    end if;
    return jsonb_build_object(
      'decisionId', existing_decision.id,
      'agentActionId', existing_action.id,
      'authorizationId', existing_authorization.id,
      'outcome', existing_decision.outcome,
      'rationaleCode', existing_decision.rationale_code,
      'risk', existing_decision.risk,
      'identityVerified', existing_authorization.identity_verified,
      'contentHash', existing_authorization.content_hash,
      'expiresAt', existing_authorization.expires_at,
      'autoSendAllowed', existing_decision.outcome = 'ALLOW_AUTOMATICALLY',
      'replayed', true
    );
  end if;

  if risk_value = 'low' and safe_category and (not identity_required or identity_ok) then
    select v.id, r.id, r.outcome, r.rationale_code
    into policy_id_value, rule_id_value, outcome_value, rationale_value
    from app_private.action_policy_versions v
    join app_private.action_policy_rules r on r.policy_version_id = v.id
    where v.lifecycle = 'active'
      and now() >= v.effective_from
      and (v.effective_to is null or now() < v.effective_to)
      and r.actor = 'agent'
      and r.command_name = 'send_message'
      and r.target_type = 'support_email'
      and risk_value = any(r.risk_levels)
      and r.outcome = 'ALLOW_AUTOMATICALLY'
    order by r.priority desc, v.version desc
    limit 1;
    if outcome_value is null then
      outcome_value := 'ESCALATE';
      rationale_value := 'bounded_support_email_policy_missing';
    end if;
  else
    outcome_value := 'ESCALATE';
    rationale_value := case
      when identity_required and not identity_ok then 'support_identity_not_verified'
      when security_or_privacy_incident then 'security_or_privacy_review_required'
      when complaint_or_threat then 'complaint_or_threat_review_required'
      when requests_financial_action then 'financial_action_review_required'
      when requests_legal_or_tax_advice then 'legal_or_tax_review_required'
      when requests_access_change then 'access_change_review_required'
      else 'support_message_outside_bounded_autonomy'
    end;
  end if;

  insert into app_private.action_decisions(
    policy_version_id, policy_rule_id, command_name, actor, actor_ref,
    target_type, target_id, risk, context, outcome, rationale_code,
    input_hash, correlation_id, idempotency_key
  ) values (
    policy_id_value, rule_id_value, 'send_message', 'agent', agent_identity,
    'support_email', target_value, risk_value,
    jsonb_build_object(
      'messageCategory', normalized_category,
      'identityVerified', identity_ok,
      'recipientEmailRedacted', true,
      'contentHash', content_hash_value,
      'requestsFinancialAction', requests_financial_action,
      'requestsLegalOrTaxAdvice', requests_legal_or_tax_advice,
      'requestsAccessChange', requests_access_change,
      'securityOrPrivacyIncident', security_or_privacy_incident,
      'complaintOrThreat', complaint_or_threat,
      'specializedAuthorization', true
    ),
    outcome_value, rationale_value, content_hash_value,
    coalesce(correlation_value, gen_random_uuid()), idempotency_value
  ) returning id into decision_id_value;

  insert into app_private.agent_actions(
    action_decision_id, agent_ref, status, invocation_metadata
  ) values (
    decision_id_value, agent_identity,
    case outcome_value
      when 'ALLOW_AUTOMATICALLY' then 'approved'
      when 'DENY' then 'cancelled'
      else 'proposed'
    end::app_private.agent_action_status,
    jsonb_build_object(
      'target_type', 'support_email',
      'message_category', normalized_category,
      'pii_redacted', true,
      'specialized_authorization', true
    )
  ) returning id into action_id_value;

  if outcome_value = 'ESCALATE' then
    insert into app_private.agent_escalations(
      agent_action_id, severity, reason_code, summary
    ) values (
      action_id_value, risk_value, rationale_value,
      'A support message requires Tre or another authorized administrator to review the case.'
    );
  end if;

  insert into app_private.agent_message_authorizations(
    action_decision_id, agent_action_id, agent_ref,
    message_category, recipient_email_search,
    donation_id, organization_id, campaign_id,
    subject, body_summary, content_hash,
    risk, outcome, identity_verified, expires_at
  ) values (
    decision_id_value, action_id_value, agent_identity,
    normalized_category, normalized_email,
    candidate_donation_id, candidate_organization_id, candidate_campaign_id,
    btrim(subject_value), btrim(body_summary_value), content_hash_value,
    risk_value, outcome_value, identity_ok, now() + interval '2 hours'
  ) returning id into authorization_id_value;

  return jsonb_build_object(
    'decisionId', decision_id_value,
    'agentActionId', action_id_value,
    'authorizationId', authorization_id_value,
    'outcome', outcome_value,
    'rationaleCode', rationale_value,
    'risk', risk_value,
    'identityVerified', identity_ok,
    'contentHash', content_hash_value,
    'expiresAt', (select expires_at from app_private.agent_message_authorizations where id = authorization_id_value),
    'autoSendAllowed', outcome_value = 'ALLOW_AUTOMATICALLY',
    'replayed', false
  );
end;
$$;

revoke execute on function api.agent_authorize_support_message(text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,boolean,boolean,boolean,boolean,boolean) from public, anon, authenticated;
grant execute on function api.agent_authorize_support_message(text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,boolean,boolean,boolean,boolean,boolean) to service_role;
