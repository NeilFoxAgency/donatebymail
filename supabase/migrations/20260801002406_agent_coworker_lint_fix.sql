-- Resolve the two plpgsql_check warnings introduced by the bounded agent coworker RPCs.
alter function api.agent_support_capabilities(text) volatile;

do $$
declare
  function_oid oid;
  current_definition text;
  corrected_definition text;
begin
  select p.oid into function_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api'
    and p.proname = 'agent_authorize_support_message'
    and pg_get_function_identity_arguments(p.oid) = 'agent_identity text, message_category text, recipient_email text, subject_value text, body_value text, body_summary_value text, idempotency_value text, correlation_value uuid, candidate_donation_id uuid, candidate_organization_id uuid, candidate_campaign_id uuid, requests_financial_action boolean, requests_legal_or_tax_advice boolean, requests_access_change boolean, security_or_privacy_incident boolean, complaint_or_threat boolean';

  if function_oid is null then
    raise exception 'agent_authorize_support_message function not found' using errcode = '42883';
  end if;

  current_definition := pg_get_functiondef(function_oid);
  if position('risk_value app_private.risk_level := ''moderate'';' in current_definition) = 0 then
    raise exception 'expected risk initializer not found' using errcode = '55000';
  end if;

  corrected_definition := replace(
    current_definition,
    'risk_value app_private.risk_level := ''moderate'';',
    'risk_value app_private.risk_level := ''moderate''::app_private.risk_level;'
  );
  execute corrected_definition;
end;
$$;
