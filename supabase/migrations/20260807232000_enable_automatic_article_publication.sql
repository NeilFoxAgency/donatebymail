-- Move article publication to an explicit new policy version. Existing
-- decisions retain their original policy/rule attribution; only decisions
-- made after this migration can be automatically executed.

do $$
declare
  previous_policy_id uuid;
  previous_policy_version integer;
  next_policy_id uuid;
  changed_at timestamptz := transaction_timestamp();
begin
  select id, version
  into previous_policy_id, previous_policy_version
  from app_private.action_policy_versions
  where policy_key = 'beta_agent_actions'
    and lifecycle = 'active'
  for update;

  if previous_policy_id is null then
    raise exception 'active beta agent policy required';
  end if;

  update app_private.action_policy_versions
  set lifecycle = 'retired', effective_to = changed_at
  where id = previous_policy_id;

  insert into app_private.action_policy_versions (
    policy_key,
    version,
    lifecycle,
    effective_from,
    approved_at
  ) values (
    'beta_agent_actions',
    previous_policy_version + 1,
    'active',
    changed_at,
    changed_at
  )
  returning id into next_policy_id;

  insert into app_private.action_policy_rules (
    policy_version_id,
    command_name,
    actor,
    risk_levels,
    target_type,
    outcome,
    rationale_code,
    priority,
    conditions
  )
  select
    next_policy_id,
    command_name,
    actor,
    risk_levels,
    target_type,
    case
      when command_name = 'publish_article'
        and actor = 'agent'
        and target_type is null
      then 'ALLOW_AUTOMATICALLY'::app_private.action_policy_outcome
      else outcome
    end,
    case
      when command_name = 'publish_article'
        and actor = 'agent'
        and target_type is null
      then 'article_publication_auto_allowed'
      else rationale_code
    end,
    priority,
    conditions
  from app_private.action_policy_rules
  where policy_version_id = previous_policy_id;
end;
$$;
