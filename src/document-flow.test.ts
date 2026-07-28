import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync("src/App.tsx", "utf8");

describe("donation document handoff", () => {
  it("presents one packing-slip and shipping-label workflow", () => {
    expect(app).toContain("1. Put the packing slip inside");
    expect(app).toContain("2. Attach the shipping label outside");
    expect(app).toContain('className="shipping-label-card"');
    expect(app).toContain("<DocumentLogo />");
  });

  it("removes confusing completion actions and uses the approved disclaimer", () => {
    expect(app).not.toContain("Copy ID");
    expect(app).not.toContain("Acknowledgment preview");
    expect(app).not.toContain("Selecting a charity here does not send money");
    expect(app).toContain(
      "Donate by Mail does not assign a fair market value to the donated",
    );
    expect(app).toContain(
      "The donor is responsible for determining and",
    );
  });
});
