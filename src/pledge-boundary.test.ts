import { describe, expect, it } from "vitest";
import { mergeCharityDetails, parsePledgeMessage } from "./pledge";

const pledgeId = "ec0b21fc-2671-431e-8a81-783b7a9626c9";

describe("Pledge metadata boundary", () => {
  it("keeps provider metadata within donation validation bounds", () => {
    const action = parsePledgeMessage({
      origin: "https://www.pledge.to",
      data: {
        action: "updateEvent",
        data: {
          beneficiary_uuid: pledgeId,
          organization_name: "x".repeat(500),
          country: "United States",
          website_url: "https://user:password@example.com/profile",
        },
      },
    });
    expect(action).toMatchObject({ type: "selected", charity: { pledgeId, name: "Selected Pledge nonprofit" } });
    expect(action?.type === "selected" ? action.charity.country : undefined).toBeUndefined();
    expect(action?.type === "selected" ? action.charity.websiteUrl : undefined).toBeUndefined();
  });

  it("does not merge credential-bearing or invalid URLs from a lookup", () => {
    const merged = mergeCharityDetails(
      { pledgeId, name: "Example" },
      { websiteUrl: "https://user:password@example.com", logoUrl: "javascript:alert(1)" },
    );
    expect(merged.websiteUrl).toBeUndefined();
    expect(merged.logoUrl).toBeUndefined();
  });
});
