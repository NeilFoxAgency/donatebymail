import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./StaffPage.tsx", import.meta.url), "utf8");

describe("staff operations UI contracts", () => {
  it("does not prefill an authorized staff email address", () => {
    expect(source).toContain('useState("")');
    expect(source).not.toContain("tre+beta@donatebymail.org");
  });

  it("uses environment-neutral operations wording", () => {
    expect(source).toContain("Operations workspace");
    expect(source).not.toContain("Beta operations");
  });

  it("uses the database device status values", () => {
    for (const value of ["inspecting", "inspected", "blocked", "reuse", "resale", "parts", "recycle", "complete", "not_required"])
      expect(source).toContain(`<option>${value}</option>`);
    expect(source).not.toContain("<option>listed</option>");
    expect(source).not.toContain("<option>sold</option>");
  });

  it("offers only valid next donation states", () => {
    expect(source).toContain('received: ["inspecting", "processing", "exception"]');
    expect(source).toContain('inspecting: ["processing", "exception"]');
    expect(source).toContain("No further status changes are available.");
  });
});
