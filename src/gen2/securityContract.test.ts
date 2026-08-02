import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const worker = readFileSync("src/worker.ts", "utf8");
const authClient = readFileSync("src/gen2/AuthSession.ts", "utf8");
const app = readFileSync("src/App.tsx", "utf8");

describe("Gen2 browser security contract", () => {
  it("never stores Supabase authorization credentials in browser storage", () => {
    expect(authClient).not.toContain("sessionStorage");
    expect(authClient).not.toContain("authorization: `Bearer");
    expect(app).not.toContain("access_token=");
    expect(app).not.toContain("dbm-beta-auth-destination");
  });
  it("uses PKCE, encrypted HttpOnly cookies, refresh, logout, and CSRF", () => {
    expect(worker).toContain('flowType: "pkce"');
    expect(worker).toContain("exchangeCodeForSession");
    expect(worker).toContain("sessionCookie(await sealSession");
    expect(worker).toContain("grant_type=refresh_token");
    expect(worker).toContain('url.pathname === "/api/auth/logout"');
    expect(worker).toContain('request.headers.get("x-csrf-token")');
  });
  it("deploys required hardening headers and exact Pledge origins", () => {
    for (const header of ["content-security-policy", "referrer-policy", "permissions-policy", "x-content-type-options", "x-frame-options"])
      expect(worker).toContain(`headers.set("${header}"`);
    expect(worker).toContain("https://www.pledge.to");
    expect(worker).toContain("https://staging.pledge.to");
    expect(worker).not.toContain("frame-src https://*.pledge.to");
  });
});
