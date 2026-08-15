import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("optional analytics storage boundary", () => {
  it("does not throw when browser storage is unavailable", () => {
    vi.stubEnv("VITE_GA4_MEASUREMENT_ID", "G-TEST1234");
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => { throw new Error("storage_denied"); },
        setItem: () => { throw new Error("storage_denied"); },
      },
    });
    return import("./analytics").then(({ getAnalyticsConsent, setAnalyticsConsent, trackEvent }) => {
      expect(getAnalyticsConsent()).toBeNull();
      expect(() => setAnalyticsConsent("granted")).not.toThrow();
      expect(() => trackEvent("donation_packet_created")).not.toThrow();
    });
  });
});
