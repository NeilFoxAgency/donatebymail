import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HUMAN_ONLY_AGENT_COMMANDS, RISK_LEVELS, SEMANTIC_COMMANDS } from "./commandRegistry";

describe("semantic command contract", () => {
  it("uses the canonical risks and never medium", () => {
    expect(RISK_LEVELS).toEqual(["low", "moderate", "high", "critical"]);
    expect(RISK_LEVELS).not.toContain("medium" as never);
  });
  it("keeps every human authority boundary explicit", () => {
    expect([...HUMAN_ONLY_AGENT_COMMANDS]).toEqual(expect.arrayContaining([
      "record_physical_receipt", "record_device_inspection", "verify_device_wipe",
      "record_device_valuation", "approve_final_financials", "execute_disbursement",
      "manage_credentials", "arbitrary_database_query", "grant_role",
      "export_unrestricted_pii", "deploy_production",
    ]));
  });
  it("matches the SQL registry seed", () => {
    const sql = readFileSync("supabase/migrations/20260729214952_gen2_review_remediation.sql", "utf8") +
      readFileSync("supabase/migrations/20260802020057_article_cms.sql", "utf8");
    for (const command of SEMANTIC_COMMANDS) expect(sql).toContain(`('${command}',`);
    for (const risk of RISK_LEVELS) expect(sql).toContain(`'${risk}'`);
  });
});
