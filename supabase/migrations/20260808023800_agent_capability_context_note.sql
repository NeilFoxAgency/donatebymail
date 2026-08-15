create or replace function api.agent_support_capabilities(agent_identity text)
returns jsonb
language plpgsql
security definer
volatile
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
    'identityFreeAutomaticEmailRequiresTrustedInbound', jsonb_build_array(
      'general_faq','donation_preparation',
      'donation_acknowledgment_process','partner_campaign_setup'
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

revoke execute on function api.agent_support_capabilities(text) from public, anon, authenticated;
grant execute on function api.agent_support_capabilities(text) to service_role;
