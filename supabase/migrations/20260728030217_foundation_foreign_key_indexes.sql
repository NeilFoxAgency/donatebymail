-- Cover every Phase 1A foreign key used for authorization, attribution, and
-- policy joins. These are deliberately separate from the initial migration so
-- the remotely applied schema history remains append-only.

create index staff_memberships_invited_by_idx
  on app_private.staff_memberships (invited_by);

create index organizations_created_by_idx
  on app_private.organizations (created_by);

create index organization_memberships_invited_by_idx
  on app_private.organization_memberships (invited_by);

create index proceeds_policies_created_by_idx
  on app_private.proceeds_policies (created_by);

create index proceeds_policy_versions_approved_by_idx
  on app_private.proceeds_policy_versions (approved_by);

create index proceeds_policy_versions_created_by_idx
  on app_private.proceeds_policy_versions (created_by);

create index proceeds_policy_assignments_policy_version_idx
  on app_private.proceeds_policy_assignments (policy_version_id);

create index proceeds_policy_assignments_created_by_idx
  on app_private.proceeds_policy_assignments (created_by);

create index financial_approval_policies_approved_by_idx
  on app_private.financial_approval_policies (approved_by);

create index action_policy_versions_approved_by_idx
  on app_private.action_policy_versions (approved_by);

create index action_policy_rules_policy_version_idx
  on app_private.action_policy_rules (policy_version_id);

create index action_decisions_policy_version_idx
  on app_private.action_decisions (policy_version_id);

create index action_decisions_policy_rule_idx
  on app_private.action_decisions (policy_rule_id);

create index action_approvals_approver_idx
  on app_private.action_approvals (approver_user_id);

create index action_execution_results_decision_idx
  on app_private.action_execution_results (action_decision_id);

create index agent_escalations_action_idx
  on app_private.agent_escalations (agent_action_id);

create index agent_escalations_assigned_to_idx
  on app_private.agent_escalations (assigned_to);

create index campaign_route_aliases_created_by_idx
  on app_private.campaign_route_aliases (created_by);

create index campaign_route_aliases_retired_by_idx
  on app_private.campaign_route_aliases (retired_by);
