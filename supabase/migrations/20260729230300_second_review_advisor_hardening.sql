-- Advisor-driven grants and foreign-key indexes for the second review.
revoke execute on function api.staff_prepare_disbursement(uuid,uuid,bigint,text,jsonb)
  from public,anon,authenticated;
grant execute on function api.staff_prepare_disbursement(uuid,uuid,bigint,text,jsonb) to service_role;

create index auth_login_attempts_pending_claim_idx on app_private.auth_login_attempts(pending_claim_id) where pending_claim_id is not null;
create index pending_donation_claims_donation_idx on app_private.pending_donation_claims(donation_id);
create index donations_financial_finalized_by_idx on app_private.donations(financial_inputs_finalized_by) where financial_inputs_finalized_by is not null;
create index reconciliation_snapshots_finalized_by_idx on app_private.financial_reconciliation_snapshots(finalized_by);
create index reconciliation_devices_device_idx on app_private.financial_reconciliation_devices(device_id);
create index reconciliation_devices_sale_idx on app_private.financial_reconciliation_devices(sale_result_id);
create index financial_cost_applications_cost_idx on app_private.financial_cost_applications(cost_id);
create index financial_cost_applications_rule_idx on app_private.financial_cost_applications(policy_rule_id);
create index proceeds_allocations_reconciliation_idx on app_private.proceeds_allocations(reconciliation_snapshot_id) where reconciliation_snapshot_id is not null;
create index proceeds_allocations_beneficiary_charity_idx on app_private.proceeds_allocations(beneficiary_charity_id) where beneficiary_charity_id is not null;
create index proceeds_allocations_campaign_context_idx on app_private.proceeds_allocations(campaign_id) where campaign_id is not null;
create index proceeds_allocations_organization_context_idx on app_private.proceeds_allocations(organization_id) where organization_id is not null;
create index proceeds_allocations_sale_result_legacy_idx on app_private.proceeds_allocations(sale_result_id) where sale_result_id is not null;
create index disbursement_preparations_charity_idx on app_private.disbursement_preparations(beneficiary_charity_id) where beneficiary_charity_id is not null;
create index disbursement_preparations_campaign_idx on app_private.disbursement_preparations(campaign_id) where campaign_id is not null;
create index disbursement_preparations_organization_idx on app_private.disbursement_preparations(organization_id) where organization_id is not null;
create index disbursement_preparations_policy_idx on app_private.disbursement_preparations(approval_policy_id) where approval_policy_id is not null;
create index partner_invitations_invited_by_idx on app_private.partner_invitations(invited_by);
create index partner_invitations_activated_by_idx on app_private.partner_invitations(activated_by) where activated_by is not null;
create index partner_invitations_suspended_by_idx on app_private.partner_invitations(suspended_by) where suspended_by is not null;
