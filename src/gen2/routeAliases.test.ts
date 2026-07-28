import { describe, expect, it } from "vitest";
import { validateVanityAlias } from "./routeAliases";

describe("campaign vanity aliases", () => {
  it("accepts a marketing slug and normalizes surrounding slashes", () => {
    expect(validateVanityAlias("/give-kids-the-world/")).toEqual({
      valid: true,
      slug: "give-kids-the-world",
    });
  });

  it("rejects application and public routes permanently", () => {
    expect(validateVanityAlias("/admin")).toMatchObject({
      valid: false,
      reason: "reserved",
    });
    expect(validateVanityAlias("donate-phone")).toMatchObject({
      valid: false,
      reason: "reserved",
    });
  });

  it("rejects nested and unsafe path formats", () => {
    expect(validateVanityAlias("campaign/child")).toMatchObject({
      valid: false,
      reason: "invalid_format",
    });
  });
});
