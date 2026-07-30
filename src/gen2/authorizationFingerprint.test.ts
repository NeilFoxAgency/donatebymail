import { describe, expect, it } from "vitest";
import { canonicalAuthorizationInput } from "./authorizationFingerprint";

const base = {
  agentIdentity: "workspace-agent-beta",
  command: "update_campaign_content" as const,
  targetType: "campaign",
  targetId: "10000000-0000-4000-8000-000000000001",
  risk: "low" as const,
  facts: { fields: ["headline"], tenant: "org-1" },
  payload: { headline: "A new headline" },
};

describe("canonical agent authorization input", () => {
  it("is stable when object key order changes", () => {
    expect(canonicalAuthorizationInput(base)).toBe(canonicalAuthorizationInput({
      ...base,
      facts: { tenant: "org-1", fields: ["headline"] },
      payload: { headline: "A new headline" },
    }));
  });

  it("changes when policy-relevant risk, facts, or target changes", () => {
    expect(canonicalAuthorizationInput(base)).not.toBe(canonicalAuthorizationInput({ ...base, risk: "high" }));
    expect(canonicalAuthorizationInput(base)).not.toBe(canonicalAuthorizationInput({ ...base, facts: { fields: ["story"] } }));
    expect(canonicalAuthorizationInput(base)).not.toBe(canonicalAuthorizationInput({ ...base, targetId: "10000000-0000-4000-8000-000000000002" }));
    expect(canonicalAuthorizationInput(base)).not.toBe(canonicalAuthorizationInput({ ...base, targetType: "organization" }));
  });
});
