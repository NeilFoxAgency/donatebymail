import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticatedApi, publicApi, responseJson, sessionStatus } from "./AuthSession";

describe("browser API response handling", () => {
  afterEach(() => vi.restoreAllMocks());

  it("turns an HTML Cloudflare Access challenge into an actionable error", async () => {
    const response = new Response("<!doctype html><title>Access</title>", {
      status: 200,
      headers: { "content-type": "text/html; charset=UTF-8" },
    });
    await expect(responseJson(response)).rejects.toThrow("unexpected response");
  });

  it("rejects a misleading JSON substring in the response media type", async () => {
    const response = new Response('{"ok":true}', {
      status: 200,
      headers: { "content-type": "text/plain; application/json" },
    });
    await expect(responseJson(response)).rejects.toThrow("unexpected response");
  });

  it("returns false when an auth status endpoint is unavailable or non-JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Access</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    })));
    await expect(sessionStatus("/api/account/session")).resolves.toBe(false);
  });

  it("accepts the role-scoped session shape without weakening generic auth", async () => {
    vi.stubGlobal("fetch", vi.fn(async (path: string) => new Response(JSON.stringify(
      path === "/api/staff/session" ? { ok: true, user: { id: "staff" } } : { ok: true, authenticated: false },
    ), { status: 200, headers: { "content-type": "application/json" } })));
    await expect(sessionStatus("/api/staff/session")).resolves.toBe(true);
    await expect(sessionStatus("/api/auth/session")).resolves.toBe(false);
  });

  it("uses JSON negotiation and included cookies for public API calls", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(publicApi<{ ok: boolean }>("/api/auth/session")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/session", expect.objectContaining({
      credentials: "include",
      cache: "no-store",
      headers: expect.objectContaining({ accept: "application/json" }),
    }));
  });

  it("does not allow callers to replace generated JSON or CSRF headers", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: "server-csrf-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(authenticatedApi("/api/staff/example", {
      method: "POST",
      headers: { accept: "text/plain", "content-type": "text/plain", "x-csrf-token": "caller-value" },
      body: "{}",
    })).resolves.toMatchObject({ ok: true });
    const requestInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(requestInit.headers).toEqual(expect.objectContaining({
      accept: "application/json",
      "content-type": "application/json",
      "x-csrf-token": "server-csrf-token",
    }));
  });

  it("rejects oversized JSON responses before parsing them", async () => {
    const response = new Response(JSON.stringify({ payload: "x".repeat(600_000) }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    await expect(responseJson(response)).rejects.toThrow("invalid response");
  });
});
