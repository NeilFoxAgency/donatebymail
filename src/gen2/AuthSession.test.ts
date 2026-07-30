import { afterEach, describe, expect, it, vi } from "vitest";
import { publicApi, responseJson, sessionStatus } from "./AuthSession";

describe("browser API response handling", () => {
  afterEach(() => vi.restoreAllMocks());

  it("turns an HTML Cloudflare Access challenge into an actionable error", async () => {
    const response = new Response("<!doctype html><title>Access</title>", {
      status: 200,
      headers: { "content-type": "text/html; charset=UTF-8" },
    });
    await expect(responseJson(response)).rejects.toThrow("active Cloudflare Access session");
  });

  it("returns false when an auth status endpoint is unavailable or non-JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Access</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    })));
    await expect(sessionStatus("/api/account/session")).resolves.toBe(false);
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
});
