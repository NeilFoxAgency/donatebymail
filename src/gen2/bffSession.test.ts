import { describe, expect, it } from "vitest";
import { clearSessionCookie, constantTimeEqual, cookieValue, openSession, sealSession, sessionCookie, type BffSession } from "./bffSession";

const secret = "test-secret-that-is-at-least-thirty-two-characters";
const fixture = (): BffSession => ({
  accessToken: "server-only-access", refreshToken: "server-only-refresh",
  expiresAt: Date.now() + 3_600_000, absoluteExpiresAt: Date.now() + 86_400_000,
  csrf: "csrf-value-with-sufficient-entropy",
});

describe("BFF application sessions", () => {
  it("encrypts credentials and uses a host-only HttpOnly cookie", async () => {
    const sealed = await sealSession(fixture(), secret);
    expect(sealed).not.toContain("server-only-access");
    expect(sessionCookie(sealed)).toContain("__Host-dbm_session=");
    expect(sessionCookie(sealed)).toContain("HttpOnly; Secure; SameSite=Lax");
    expect(await openSession(sealed, secret)).toMatchObject({ accessToken: "server-only-access" });
  });
  it("rejects tampering and absolute expiry", async () => {
    const sealed = await sealSession(fixture(), secret);
    expect(await openSession(`${sealed}x`, secret)).toBeNull();
    expect(await openSession(sealed, secret, Date.now() + 90_000_000)).toBeNull();
  });
  it("rejects a decrypted session with an invalid shape", async () => {
    const sealed = await sealSession({ ...fixture(), mfaDestination: "https://attacker.example" }, secret);
    expect(await openSession(sealed, secret)).toBeNull();
    const protocolRelative = await sealSession({ ...fixture(), mfaDestination: "//attacker.example" }, secret);
    expect(await openSession(protocolRelative, secret)).toBeNull();
    const backslashRelative = await sealSession({ ...fixture(), mfaDestination: "/\\attacker.example" }, secret);
    expect(await openSession(backslashRelative, secret)).toBeNull();
    expect(await openSession("v1.short.short", secret)).toBeNull();
  });
  it("clears logout cookies and compares CSRF tokens without early exit", () => {
    expect(clearSessionCookie()).toContain("Max-Age=0");
    expect(cookieValue("a=1; __Host-dbm_session=sealed; b=2")).toBe("sealed");
    expect(constantTimeEqual("same", "same")).toBe(true);
    expect(constantTimeEqual("nope", "same")).toBe(false);
  });
});
