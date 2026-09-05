import { describe, expect, it } from "vitest";
import { safeExternalHttpsUrl, safeInternalRedirect, safePrivateAssetUrl } from "./urlSafety";

describe("external URL safety", () => {
  it("allows ordinary HTTPS destinations", () => {
    expect(safeExternalHttpsUrl("https://example.org/about")).toBe("https://example.org/about");
  });

  it("rejects non-HTTPS and credential-bearing destinations", () => {
    expect(safeExternalHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalHttpsUrl("https://user:password@example.org")).toBeNull();
  });
});

describe("private asset URL safety", () => {
  const prefixes = ["/api/partner/campaign-assets/", "/api/staff/organization-assets/"] as const;

  it("allows only exact UUID-backed approved routes", () => {
    expect(safePrivateAssetUrl("/api/partner/campaign-assets/123e4567-e89b-12d3-a456-426614174000", prefixes))
      .toBe("/api/partner/campaign-assets/123e4567-e89b-12d3-a456-426614174000");
  });

  it("rejects external, query-bearing, and non-UUID paths", () => {
    expect(safePrivateAssetUrl("https://evil.example/api/partner/campaign-assets/123e4567-e89b-12d3-a456-426614174000", prefixes)).toBeNull();
    expect(safePrivateAssetUrl("/api/partner/campaign-assets/123e4567-e89b-12d3-a456-426614174000?download=1", prefixes)).toBeNull();
    expect(safePrivateAssetUrl("/api/partner/campaign-assets/not-an-id", prefixes)).toBeNull();
    expect(safePrivateAssetUrl("/api/staff/campaign-assets/123e4567-e89b-12d3-a456-426614174000", prefixes)).toBeNull();
  });
});

describe("internal redirect safety", () => {
  it("keeps redirects on the current application origin", () => {
    expect(safeInternalRedirect("/settings?mfa=required", "/login")).toBe("/settings?mfa=required");
    expect(safeInternalRedirect("https://evil.example/phish", "/login")).toBe("/login");
    expect(safeInternalRedirect("//evil.example/phish", "/login")).toBe("/login");
    expect(safeInternalRedirect("/\\\\evil.example/phish", "/login")).toBe("/login");
    expect(safeInternalRedirect("/%2f%2fevil.example/phish", "/login")).toBe("/login");
    expect(safeInternalRedirect("javascript:alert(1)", "/login")).toBe("/login");
  });
});
