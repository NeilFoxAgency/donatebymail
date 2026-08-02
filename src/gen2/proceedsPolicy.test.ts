import { describe, expect, it } from "vitest";
import {
  resolveProceedsPolicy,
  type ProceedsPolicyAssignment,
} from "./proceedsPolicy";

const version = (id: string, shareBasisPoints: number | null, version = 1) => ({
  id,
  policyId: `policy-${id}`,
  version,
  lifecycle: "active" as const,
  shareBasisPoints,
  effectiveFrom: "2026-01-01T00:00:00Z",
  effectiveTo: null,
});

const assignment = (
  partial: Partial<ProceedsPolicyAssignment> &
    Pick<ProceedsPolicyAssignment, "id" | "scope" | "scopeId">,
): ProceedsPolicyAssignment => ({
  precedence: 0,
  effectiveFrom: "2026-01-01T00:00:00Z",
  effectiveTo: null,
  policyVersion: version(partial.id, null),
  ...partial,
});

describe("proceeds policy resolution", () => {
  const at = new Date("2026-07-28T00:00:00Z");

  it("prefers a campaign assignment over charity and general policies", () => {
    const selected = resolveProceedsPolicy(
      [
        assignment({ id: "general", scope: "general", scopeId: null }),
        assignment({ id: "charity", scope: "charity", scopeId: "charity-1" }),
        assignment({ id: "campaign", scope: "campaign", scopeId: "campaign-1" }),
      ],
      { campaignId: "campaign-1", charityId: "charity-1" },
      at,
    );
    expect(selected?.id).toBe("campaign");
  });

  it("uses the highest configured precedence within a scope", () => {
    const selected = resolveProceedsPolicy(
      [
        assignment({ id: "low", scope: "general", scopeId: null, precedence: 1 }),
        assignment({ id: "high", scope: "general", scopeId: null, precedence: 5 }),
      ],
      {},
      at,
    );
    expect(selected?.id).toBe("high");
  });

  it("ignores expired and draft policy versions", () => {
    expect(
      resolveProceedsPolicy(
        [
          assignment({
            id: "expired",
            scope: "general",
            scopeId: null,
            effectiveTo: "2026-06-01T00:00:00Z",
          }),
          assignment({
            id: "draft",
            scope: "general",
            scopeId: null,
            policyVersion: {
              ...version("draft", 5000),
              lifecycle: "draft",
            },
          }),
        ],
        {},
        at,
      ),
    ).toBeNull();
  });

  it("supports 50 percent as configuration rather than a default", () => {
    const selected = resolveProceedsPolicy(
      [
        assignment({
          id: "configured-50",
          scope: "general",
          scopeId: null,
          policyVersion: version("configured-50", 5000),
        }),
      ],
      {},
      at,
    );
    expect(selected?.policyVersion.shareBasisPoints).toBe(5000);
    expect(resolveProceedsPolicy([], {}, at)).toBeNull();
  });
});
