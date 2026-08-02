export const RISK_LEVELS = ["low", "moderate", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const SEMANTIC_COMMANDS = [
  "send_message",
  "update_campaign_content",
  "publish_campaign_revision",
  "change_donation_status",
  "create_partner_lead",
  "create_internal_note",
  "record_physical_receipt",
  "record_device_inspection",
  "verify_device_wipe",
  "record_device_valuation",
  "approve_final_financials",
  "execute_disbursement",
  "manage_credentials",
  "arbitrary_database_query",
  "grant_role",
  "export_unrestricted_pii",
  "deploy_production",
] as const;
export type SemanticCommand = (typeof SEMANTIC_COMMANDS)[number];

export const HUMAN_ONLY_AGENT_COMMANDS = new Set<SemanticCommand>([
  "record_physical_receipt",
  "record_device_inspection",
  "verify_device_wipe",
  "record_device_valuation",
  "approve_final_financials",
  "execute_disbursement",
  "manage_credentials",
  "arbitrary_database_query",
  "grant_role",
  "export_unrestricted_pii",
  "deploy_production",
]);

export function isRiskLevel(value: unknown): value is RiskLevel {
  return typeof value === "string" && RISK_LEVELS.includes(value as RiskLevel);
}

export function isSemanticCommand(value: unknown): value is SemanticCommand {
  return typeof value === "string" && SEMANTIC_COMMANDS.includes(value as SemanticCommand);
}
