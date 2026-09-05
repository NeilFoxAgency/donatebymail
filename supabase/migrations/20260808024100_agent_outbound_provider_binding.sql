-- The workspace agent sends an approved message through a separate provider
-- connector. Return the exact outbound payload to that connector, and require
-- the connector's recorded recipient to match the authorization before the
-- provider message is journaled. Provider IDs alone do not prove who received
-- a message.
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

create or replace function api.agent_record_outbound_message_checked(
  agent_identity text,
  authorization_value uuid,
  subject_value text,
  body_value text,
  content_hash_value text,
  provider_value text,
  external_thread_value text,
  external_message_value text,
  sender_identity_value text,
  sent_at_value timestamptz default now(),
  recipient_email_value text default null
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = pg_catalog, app_private
as $$
declare
  expected_email text;
  normalized_email text := lower(btrim(coalesce(recipient_email_value, '')));
begin
  perform app_private.assert_service_role();
  perform app_private.assert_agent_identity(agent_identity);
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'authorized recipient email required' using errcode = '22023';
  end if;
  select recipient_email_search into expected_email
  from app_private.agent_message_authorizations
  where id = authorization_value and agent_ref = agent_identity;
  if expected_email is null or normalized_email <> expected_email then
    raise exception 'provider recipient does not match authorization' using errcode = '22023';
  end if;
  return api.agent_record_outbound_message(
    agent_identity, authorization_value, subject_value, body_value,
    content_hash_value, provider_value, external_thread_value,
    external_message_value, sender_identity_value, sent_at_value
  );
end;
$$;

revoke execute on function api.agent_authorize_support_message_payload(text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,boolean,boolean,boolean,boolean,boolean) from public, anon, authenticated;
grant execute on function api.agent_authorize_support_message_payload(text,text,text,text,text,text,text,uuid,uuid,uuid,uuid,boolean,boolean,boolean,boolean,boolean) to service_role;
revoke execute on function api.agent_record_outbound_message_checked(text,uuid,text,text,text,text,text,text,text,timestamptz,text) from public, anon, authenticated;
grant execute on function api.agent_record_outbound_message_checked(text,uuid,text,text,text,text,text,text,text,timestamptz,text) to service_role;
-- Keep the legacy journal RPC callable only by the checked wrapper's
-- SECURITY DEFINER owner; callers must provide the provider recipient binding.
revoke execute on function api.agent_record_outbound_message(text,uuid,text,text,text,text,text,text,text,timestamptz) from service_role;
