create or replace function api.evaluate_agent_command(
  agent_identity text,
  command_value text,
  target_kind text,
  target_value uuid,
  risk_value app_private.risk_level,
  facts jsonb,
  input_hash_value text,
  correlation_value uuid,
  idempotency_value text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
declare
  policy_id uuid;
  rule_id uuid;
  decision_outcome app_private.action_policy_outcome;
  rationale text;
  decision_id uuid;
  action_id uuid;
  existing app_private.action_decisions%rowtype;
  registry app_private.semantic_command_registry%rowtype;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_agent_identity(agent_identity);
  select * into registry
  from app_private.semantic_command_registry
  where command_name = command_value;
  if registry.command_name is null then
    raise exception 'unknown semantic command' using errcode = '22023';
  end if;

  select * into existing
  from app_private.action_decisions
  where actor = 'agent'
    and actor_ref = agent_identity
    and idempotency_key = idempotency_value;
  if existing.id is not null then
    if existing.input_hash <> input_hash_value
      or existing.command_name <> command_value
    then
      raise exception 'agent idempotency payload mismatch' using errcode = '23505';
    end if;
    select id into action_id
    from app_private.agent_actions
    where action_decision_id = existing.id;
    return jsonb_build_object(
      'decisionId', existing.id,
      'agentActionId', action_id,
      'outcome', existing.outcome,
      'rationaleCode', existing.rationale_code,
      'replayed', true
    );
  end if;

  if command_value = 'send_message' and target_kind = 'support_email' then
    decision_outcome := 'ESCALATE';
    rationale := 'specialized_support_message_authorization_required';
  elsif registry.human_only then
    decision_outcome := 'DENY';
    rationale := 'human_or_prohibited_action';
  else
    select v.id, r.id, r.outcome, r.rationale_code
    into policy_id, rule_id, decision_outcome, rationale
    from app_private.action_policy_versions v
    join app_private.action_policy_rules r on r.policy_version_id = v.id
    where v.lifecycle = 'active'
      and now() >= v.effective_from
      and (v.effective_to is null or now() < v.effective_to)
      and r.actor = 'agent'
      and (r.command_name = command_value or r.command_name = '*')
      and risk_value = any(r.risk_levels)
      and (r.target_type is null or r.target_type = target_kind)
    order by (r.command_name = command_value) desc, r.priority desc
    limit 1;
    if decision_outcome is null then
      decision_outcome := 'ESCALATE';
      rationale := 'no_matching_policy';
    end if;
  end if;

  insert into app_private.action_decisions(
    policy_version_id, policy_rule_id, command_name, actor, actor_ref,
    target_type, target_id, risk, context, outcome, rationale_code,
    input_hash, correlation_id, idempotency_key
  ) values (
    policy_id, rule_id, command_value, 'agent', agent_identity,
    target_kind, target_value, risk_value, coalesce(facts, '{}'::jsonb),
    decision_outcome, rationale, input_hash_value,
    correlation_value, idempotency_value
  ) returning id into decision_id;

  insert into app_private.agent_actions(
    action_decision_id, agent_ref, status, invocation_metadata
  ) values (
    decision_id, agent_identity,
    case decision_outcome
      when 'ALLOW_AUTOMATICALLY' then 'approved'
      when 'DENY' then 'cancelled'
      else 'proposed'
    end::app_private.agent_action_status,
    jsonb_build_object('target_type', target_kind, 'pii_redacted', true)
  ) returning id into action_id;

  if decision_outcome = 'ESCALATE' then
    insert into app_private.agent_escalations(
      agent_action_id, severity, reason_code, summary
    ) values (
      action_id, risk_value, rationale,
      'Command requires staff review.'
    );
  end if;

  return jsonb_build_object(
    'decisionId', decision_id,
    'agentActionId', action_id,
    'outcome', decision_outcome,
    'rationaleCode', rationale,
    'replayed', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
revoke execute on function api.evaluate_agent_command(text,text,text,uuid,app_private.risk_level,jsonb,text,uuid,text) from public, anon, authenticated;
grant execute on function api.evaluate_agent_command(text,text,text,uuid,app_private.risk_level,jsonb,text,uuid,text) to service_role;
