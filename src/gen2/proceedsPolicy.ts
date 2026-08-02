export type ProceedsPolicyScope =
  | "general"
  | "charity"
  | "partnership"
  | "campaign";

export type ProceedsPolicyLifecycle =
  | "draft"
  | "approved"
  | "active"
  | "retired";

export interface ProceedsPolicyVersion {
  id: string;
  policyId: string;
  version: number;
  lifecycle: ProceedsPolicyLifecycle;
  shareBasisPoints: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface ProceedsPolicyAssignment {
  id: string;
  scope: ProceedsPolicyScope;
  scopeId: string | null;
  precedence: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  policyVersion: ProceedsPolicyVersion;
}

export interface ProceedsPolicyContext {
  campaignId?: string;
  partnershipId?: string;
  charityId?: string;
}

const scopeRank: Record<ProceedsPolicyScope, number> = {
  general: 1,
  charity: 2,
  partnership: 2,
  campaign: 3,
};

const includesInstant = (
  effectiveFrom: string,
  effectiveTo: string | null,
  instant: number,
) => {
  const startsAt = Date.parse(effectiveFrom);
  const endsAt = effectiveTo ? Date.parse(effectiveTo) : Number.POSITIVE_INFINITY;
  return Number.isFinite(startsAt) && startsAt <= instant && instant < endsAt;
};

const scopeMatches = (
  assignment: ProceedsPolicyAssignment,
  context: ProceedsPolicyContext,
) => {
  if (assignment.scope === "general") return assignment.scopeId === null;
  if (assignment.scope === "campaign")
    return Boolean(context.campaignId && context.campaignId === assignment.scopeId);
  if (assignment.scope === "partnership")
    return Boolean(
      context.partnershipId && context.partnershipId === assignment.scopeId,
    );
  return Boolean(context.charityId && context.charityId === assignment.scopeId);
};

export function resolveProceedsPolicy(
  assignments: ProceedsPolicyAssignment[],
  context: ProceedsPolicyContext,
  at = new Date(),
): ProceedsPolicyAssignment | null {
  const instant = at.getTime();
  if (!Number.isFinite(instant)) return null;

  return (
    assignments
      .filter(
        (assignment) =>
          scopeMatches(assignment, context) &&
          includesInstant(
            assignment.effectiveFrom,
            assignment.effectiveTo,
            instant,
          ) &&
          ["approved", "active"].includes(
            assignment.policyVersion.lifecycle,
          ) &&
          includesInstant(
            assignment.policyVersion.effectiveFrom,
            assignment.policyVersion.effectiveTo,
            instant,
          ),
      )
      .sort(
        (left, right) =>
          scopeRank[right.scope] - scopeRank[left.scope] ||
          right.precedence - left.precedence ||
          right.policyVersion.version - left.policyVersion.version ||
          left.id.localeCompare(right.id),
      )[0] ?? null
  );
}
