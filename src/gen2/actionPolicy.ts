export type ActionPolicyOutcome =
  | "ALLOW_AUTOMATICALLY"
  | "REQUIRE_APPROVAL"
  | "ESCALATE"
  | "DENY";

export type ActorKind =
  | "donor"
  | "partner"
  | "staff"
  | "service"
  | "agent"
  | "system";

export type RiskLevel = "low" | "moderate" | "high" | "critical";

export interface ActionPolicyRule {
  id: string;
  policyVersion: number;
  command: string;
  actorKind: ActorKind | "any";
  riskLevels: RiskLevel[];
  targetType?: string;
  outcome: ActionPolicyOutcome;
  rationaleCode: string;
  priority: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface ActionPolicyInput {
  command: string;
  actorKind: ActorKind;
  riskLevel: RiskLevel;
  targetType?: string;
  at?: Date;
}

export interface ActionPolicyDecision {
  outcome: ActionPolicyOutcome;
  rationaleCode: string;
  ruleId: string | null;
  policyVersion: number | null;
}

const agentDeniedCommands = new Set([
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

const ruleIsActive = (rule: ActionPolicyRule, instant: number) => {
  const startsAt = Date.parse(rule.effectiveFrom);
  const endsAt = rule.effectiveTo
    ? Date.parse(rule.effectiveTo)
    : Number.POSITIVE_INFINITY;
  return Number.isFinite(startsAt) && startsAt <= instant && instant < endsAt;
};

export function evaluateActionPolicy(
  rules: ActionPolicyRule[],
  input: ActionPolicyInput,
): ActionPolicyDecision {
  if (input.actorKind === "agent" && agentDeniedCommands.has(input.command)) {
    return {
      outcome: "DENY",
      rationaleCode: "agent_command_safety_boundary",
      ruleId: null,
      policyVersion: null,
    };
  }

  const instant = (input.at ?? new Date()).getTime();
  const match = rules
    .filter(
      (rule) =>
        (rule.command === input.command || rule.command === "*") &&
        (rule.actorKind === input.actorKind || rule.actorKind === "any") &&
        rule.riskLevels.includes(input.riskLevel) &&
        (!rule.targetType || rule.targetType === input.targetType) &&
        ruleIsActive(rule, instant),
    )
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        right.policyVersion - left.policyVersion ||
        left.id.localeCompare(right.id),
    )[0];

  if (!match) {
    return {
      outcome: "ESCALATE",
      rationaleCode: "no_matching_policy_rule",
      ruleId: null,
      policyVersion: null,
    };
  }

  return {
    outcome: match.outcome,
    rationaleCode: match.rationaleCode,
    ruleId: match.id,
    policyVersion: match.policyVersion,
  };
}
