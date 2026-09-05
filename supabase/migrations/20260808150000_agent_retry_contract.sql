-- Make the remaining small agent writes safe to retry with the same state.
-- A client can lose the response after a successful transition; repeating the
-- request must not create another audit event for an already-current status.
create or replace function api.agent_set_communication_thread_status(
  agent_identity text,
  candidate_thread_id uuid,
  status_value text
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = pg_catalog, app_private
as $$
declare
  old_status text;
  replayed boolean;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_agent_identity(agent_identity);
  if status_value not in ('open','waiting_on_contact','waiting_on_staff','resolved','closed') then
    raise exception 'bounded thread status required' using errcode = '22023';
  end if;
  select status into old_status
  from app_private.communication_threads
  where id = candidate_thread_id
  for update;
  if old_status is null then
    raise exception 'communication thread not found' using errcode = '22023';
  end if;
  replayed := old_status = status_value;
  if not replayed then
    update app_private.communication_threads
    set status = status_value
    where id = candidate_thread_id;
    insert into app_private.audit_events(
      actor, actor_ref, action_name, entity_type, entity_id,
      reason_code, redacted_changes, metadata
    ) values (
      'agent', agent_identity, 'agent.communication.change_thread_status',
      'communication_thread', candidate_thread_id,
      'bounded_support_thread_update',
      jsonb_build_object('status', jsonb_build_object('from', old_status, 'to', status_value)),
      '{}'::jsonb
    );
  end if;
  return jsonb_build_object('threadId', candidate_thread_id, 'status', status_value, 'replayed', replayed);
end;
$$;

revoke execute on function api.agent_set_communication_thread_status(text,uuid,text)
  from public, anon, authenticated;
grant execute on function api.agent_set_communication_thread_status(text,uuid,text)
  to service_role;

-- Keep the output shape stable for MCP clients on both the first failure and a
-- replay of the same consumed authorization.
create or replace function api.agent_record_message_failure(
  agent_identity text,
  authorization_value uuid,
  failure_code text
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = pg_catalog, app_private
as $$
declare
  authorization_row app_private.agent_message_authorizations%rowtype;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_agent_identity(agent_identity);
  if failure_code is null or failure_code !~ '^[a-z][a-z0-9_]{2,79}$' then
    raise exception 'bounded failure code required' using errcode = '22023';
  end if;
  select * into authorization_row
  from app_private.agent_message_authorizations
  where id = authorization_value for update;
  if authorization_row.id is null or authorization_row.agent_ref <> agent_identity then
    raise exception 'authorization required' using errcode = '22023';
  end if;
  if authorization_row.consumed_at is not null then
    return jsonb_build_object('recorded', true, 'replayed', true, 'status', 'failed');
  end if;

  insert into app_private.action_execution_results(
    action_decision_id, status, executor, executor_ref,
    result_metadata, verification_metadata
  ) values (
    authorization_row.action_decision_id, 'failed', 'agent', agent_identity,
    jsonb_build_object('failureCode', failure_code),
    jsonb_build_object('messageSent', false)
  );
  update app_private.agent_actions set status = 'failed', updated_at = now()
  where id = authorization_row.agent_action_id;
  update app_private.agent_message_authorizations set consumed_at = now()
  where id = authorization_row.id;
  return jsonb_build_object('recorded', true, 'replayed', false, 'status', 'failed');
end;
$$;

revoke execute on function api.agent_record_message_failure(text,uuid,text)
  from public, anon, authenticated;
grant execute on function api.agent_record_message_failure(text,uuid,text)
  to service_role;
