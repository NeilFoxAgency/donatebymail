import { describe, expect, it } from "vitest";
import { mergeCharityDetails, type SelectedCharity } from "./pledge";

describe("Pledge charity name resolution", () => {
  it("replaces the UUID-only widget fallback with API organization details", () => {
    const widgetSelection: SelectedCharity = {
      pledgeId: "3685b542-61d5-45da-9580-162dca725966",
      name: "Selected Pledge nonprofit",
    };

    expect(
      mergeCharityDetails(widgetSelection, {
        pledgeId: widgetSelection.pledgeId,
        name: "American Red Cross",
        ein: "53-0196605",
        city: "WASHINGTON",
        state: "DC",
      }),
    ).toMatchObject({
      pledgeId: widgetSelection.pledgeId,
      name: "American Red Cross",
      ein: "53-0196605",
      city: "WASHINGTON",
      state: "DC",
    });
  });
});
