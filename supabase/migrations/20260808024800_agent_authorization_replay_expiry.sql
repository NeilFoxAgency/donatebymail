-- Keep the public payload wrapper correct even when an earlier deployment
-- created the underlying authorization function. Replaying a consumed or
-- expired authorization must never tell the connector that it may send.
create or replace function api.agent_authorize_support_message_payload(
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
  result jsonb;
  normalized_email text := lower(btrim(coalesce(recipient_email, '')));
  authorization_row app_private.agent_message_authorizations%rowtype;
begin
  perform app_private.assert_service_role();
  perform app_private.assert_agent_identity(agent_identity);
  result := api.agent_authorize_support_message(
    agent_identity, message_category, recipient_email, subject_value, body_value,
    body_summary_value, idempotency_value, correlation_value,
    candidate_donation_id, candidate_organization_id, candidate_campaign_id,
    requests_financial_action, requests_legal_or_tax_advice,
    requests_access_change, security_or_privacy_incident, complaint_or_threat
  );
  select * into authorization_row
  from app_private.agent_message_authorizations
  where id = nullif(result->>'authorizationId', '')::uuid
    and agent_ref = agent_identity;
  if authorization_row.id is null then
    raise exception 'message authorization missing' using errcode = '55000';
  end if;
  return result || jsonb_build_object(
    'recipientEmail', normalized_email,
    'subject', btrim(subject_value),
    'body', body_value,
    'autoSendAllowed', (result->>'autoSendAllowed')::boolean
      and authorization_row.consumed_at is null
      and authorization_row.expires_at > now()
  );
end;
$$;

revoke execute on function api.agent_authorize_support_message_payload(text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,boolean,boolean,boolean,boolean,boolean)
  from public, anon, authenticated;
grant execute on function api.agent_authorize_support_message_payload(text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,boolean,boolean,boolean,boolean,boolean)
  to service_role;
