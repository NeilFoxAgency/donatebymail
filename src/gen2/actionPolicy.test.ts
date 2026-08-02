import { describe, expect, it } from "vitest";
import {
  evaluateActionPolicy,
  type ActionPolicyRule,
} from "./actionPolicy";
import type { SemanticCommand } from "./commandRegistry";

const rule = (
  outcome: ActionPolicyRule["outcome"],
  command: SemanticCommand = "send_message",
): ActionPolicyRule => ({
  id: `${command}-${outcome}`,
  policyVersion: 1,
  command,
  actorKind: "agent",
  riskLevels: ["low"],
  outcome,
  rationaleCode: "configured_beta_policy",
  priority: 10,
  effectiveFrom: "2026-01-01T00:00:00Z",
  effectiveTo: null,
});

describe("agent action policy", () => {
  it("initially supports approval for a semantic send-message command", () => {
    expect(
      evaluateActionPolicy([rule("REQUIRE_APPROVAL")], {
        command: "send_message",
        actorKind: "agent",
        riskLevel: "low",
        at: new Date("2026-07-28T00:00:00Z"),
      }).outcome,
    ).toBe("REQUIRE_APPROVAL");
  });

  it("can allow the same semantic command automatically through policy", () => {
    expect(
      evaluateActionPolicy([rule("ALLOW_AUTOMATICALLY")], {
        command: "send_message",
        actorKind: "agent",
        riskLevel: "low",
        at: new Date("2026-07-28T00:00:00Z"),
      }).outcome,
    ).toBe("ALLOW_AUTOMATICALLY");
  });

  it("denies agent physical and financial commands regardless of a permissive rule", () => {
    expect(
      evaluateActionPolicy(
        [rule("ALLOW_AUTOMATICALLY", "record_physical_receipt")],
        {
          command: "record_physical_receipt",
          actorKind: "agent",
          riskLevel: "low",
        },
      ),
    ).toMatchObject({
      outcome: "DENY",
      rationaleCode: "agent_command_safety_boundary",
    });
  });

  it("escalates commands with no matching rule", () => {
    expect(
      evaluateActionPolicy([], {
        command: "update_campaign_content",
        actorKind: "agent",
        riskLevel: "low",
      }).outcome,
    ).toBe("ESCALATE");
  });
});
