import { describe, expect, it } from "vitest";
import { parseDonationDraft, serializeDonationDraft } from "./donationDraft";

describe("donation draft privacy", () => {
  it("persists only non-contact progress fields", () => {
    const serialized = serializeDonationDraft({
      devices: [{ model: "Example phone" }],
      selectedCharity: { name: "Example charity" },
      step: 2,
    });

    expect(JSON.parse(serialized)).toEqual({ devices: [{ model: "Example phone" }], step: 2 });
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("address");
    expect(parseDonationDraft(serialized).step).toBe(2);
  });

  it("rejects malformed or unbounded draft envelopes", () => {
    expect(() => parseDonationDraft(JSON.stringify({ devices: [], selectedCharity: null, step: 1 }))).toThrow();
    expect(() => parseDonationDraft(JSON.stringify({ devices: [{}], selectedCharity: null, step: 4 }))).toThrow();
    expect(() => parseDonationDraft("not-json")).toThrow();
    expect(() => parseDonationDraft("x".repeat(100_001))).toThrow();
    expect(() => parseDonationDraft(JSON.stringify({ devices: [{ value: "é".repeat(60_000) }], selectedCharity: null, step: 1 }))).toThrow();
  });
});
