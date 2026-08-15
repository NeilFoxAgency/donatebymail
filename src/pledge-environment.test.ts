import { describe, expect, it } from "vitest";
import { resolvePledgeEnvironment } from "./pledge";

describe("Pledge environment resolution", () => {
  it("uses the explicit build override when present", () => {
    expect(resolvePledgeEnvironment("sandbox", "donatebymail.org")).toBe("sandbox");
    expect(resolvePledgeEnvironment("production", "beta.donatebymail.org")).toBe("production");
  });

  it("selects the beta sandbox from the shared bundle hostname", () => {
    expect(resolvePledgeEnvironment(undefined, "beta.donatebymail.org")).toBe("sandbox");
    expect(resolvePledgeEnvironment(undefined, "BETA.DONATEBYMAIL.ORG")).toBe("sandbox");
  });

  it("defaults unknown and local hosts to production", () => {
    expect(resolvePledgeEnvironment(undefined, "donatebymail.org")).toBe("production");
    expect(resolvePledgeEnvironment(undefined, "localhost")).toBe("production");
  });
});
