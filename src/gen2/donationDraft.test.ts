import { describe, expect, it } from "vitest";
import { parseDonationDraft, serializeDonationDraft } from "./donationDraft";

describe("donation draft privacy", () => {
  it("persists only non-contact progress fields", () => {
    const serialized = serializeDonationDraft({
      devices: [{ model: "Example phone" }],
      selectedCharity: { name: "Example charity" },
      step: 2,
    });

    expect(JSON.parse(serialized)).toEqual({
      devices: [{ model: "Example phone" }],
      selectedCharity: { name: "Example charity" },
      step: 2,
    });
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("address");
    expect(parseDonationDraft(serialized).step).toBe(2);
  });
});
