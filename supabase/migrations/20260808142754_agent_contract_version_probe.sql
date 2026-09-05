-- A beta Worker must not report readiness while its database is on an older
-- agent contract. This probe is deliberately service-only and read-only; the
-- Worker compares the version before exposing the agent connector as ready.
create or replace function api.agent_contract_version()
returns jsonb
language plpgsql
security definer
volatile
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.assert_service_role();
  if to_regprocedure('app_private.assert_current_agent_message_context(uuid)') is null
    or to_regprocedure('api.agent_authorize_support_message_payload(text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,boolean,boolean,boolean,boolean,boolean)') is null
    or to_regprocedure('api.agent_record_outbound_message_checked(text,uuid,text,text,text,text,text,text,text,timestamptz,text)') is null
    or to_regprocedure('api.prune_anonymous_rate_limits(integer)') is null
  then
    raise exception 'agent contract incomplete' using errcode = '55000';
  end if;
  return jsonb_build_object(
    'contractVersion', '20260808135726',
    'agentIdentity', 'donate-by-mail-operations-agent-v1'
  );
end;
$$;

revoke all on function api.agent_contract_version() from public, anon, authenticated;
grant execute on function api.agent_contract_version() to service_role;
