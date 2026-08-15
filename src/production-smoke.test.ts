import { afterEach, describe, expect, it } from "vitest";
import { checkProductionEndpoints, checkProductionHosts } from "../scripts/production-smoke.mjs";
import { APPLICATION_CONTRACT_VERSION } from "./contractVersion";

const realFetch = globalThis.fetch;
const productionHeaders = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'; script-src https://www.pledge.to; connect-src https://api.pledge.to",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "cross-origin-resource-policy": "same-origin",
};

describe("production endpoint smoke gate", () => {
  afterEach(() => { globalThis.fetch = realFetch; });

  it("requires JSON Worker health, readiness, and explicit agent/MCP-disabled responses", async () => {
    globalThis.fetch = async (input) => {
      const requestUrl = typeof input === "string" ? input : "url" in input ? input.url : input.href;
      const parsed = new URL(requestUrl);
      if (parsed.protocol === "http:") return new Response(null, { status: 308, headers: { location: "https://donatebymail.org/" } });
      const path = parsed.pathname;
      if (path === "/healthz") return new Response(JSON.stringify({ ok: true, environment: "production" }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
      if (path === "/readyz") return new Response(JSON.stringify({ ok: true, ready: true, environment: "production", applicationContractVersion: APPLICATION_CONTRACT_VERSION }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
      if (path === "/") return new Response("<!doctype html><html><body>Donate by Mail</body></html>", { status: 200, headers: { ...productionHeaders, "content-type": "text/html", "x-dbm-application-contract-version": APPLICATION_CONTRACT_VERSION } });
      if (path === "/ads.txt") return new Response(null, { status: 404, headers: { "x-robots-tag": "noindex", "cache-control": "no-store" } });
      if (path === "/api/agent/v1/queries") return new Response(JSON.stringify({ code: "agent_disabled_in_production" }), { status: 404, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32003, message: "MCP disabled in production" }, id: null }), { status: 404, headers: { "content-type": "application/json" } });
    };
    await expect(checkProductionEndpoints("https://donatebymail.org")).resolves.toMatchObject({ origin: "https://donatebymail.org" });
  });

  it("rejects a cached static page at the health endpoint", async () => {
    globalThis.fetch = async (input) => new URL(typeof input === "string" ? input : "url" in input ? input.url : input.href).protocol === "http:"
      ? new Response(null, { status: 308, headers: { location: "https://donatebymail.org/" } })
      : new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } });
    await expect(checkProductionEndpoints("https://donatebymail.org")).rejects.toThrow(/not JSON/);
  });

  it("rejects an oversized smoke response before parsing it", async () => {
    globalThis.fetch = async (input) => new URL(typeof input === "string" ? input : "url" in input ? input.url : input.href).protocol === "http:"
      ? new Response(null, { status: 308, headers: { location: "https://donatebymail.org/" } })
      : new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "999999999" },
      });
    await expect(checkProductionEndpoints("https://donatebymail.org")).rejects.toThrow(/size limit/);
  });

  it("rejects a stale Worker that reports generic readiness without the current contract", async () => {
    globalThis.fetch = async (input) => {
      const requestUrl = typeof input === "string" ? input : "url" in input ? input.url : input.href;
      const parsed = new URL(requestUrl);
      if (parsed.protocol === "http:") return new Response(null, { status: 308, headers: { location: "https://donatebymail.org/" } });
      const path = parsed.pathname;
      if (path === "/healthz") return new Response(JSON.stringify({ ok: true, environment: "production" }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
      if (path === "/readyz") return new Response(JSON.stringify({ ok: true, ready: true, environment: "production" }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
      return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32003 }, id: null }), { status: 404, headers: { "content-type": "application/json" } });
    };
    await expect(checkProductionEndpoints("https://donatebymail.org")).rejects.toThrow(/not ready/);
  });

  it("rejects a stale static shell after the health contract is repaired", async () => {
    globalThis.fetch = async (input) => {
      const requestUrl = typeof input === "string" ? input : "url" in input ? input.url : input.href;
      const parsed = new URL(requestUrl);
      if (parsed.protocol === "http:") return new Response(null, { status: 308, headers: { location: "https://donatebymail.org/" } });
      const path = parsed.pathname;
      if (path === "/healthz") return new Response(JSON.stringify({ ok: true, environment: "production" }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
      if (path === "/readyz") return new Response(JSON.stringify({ ok: true, ready: true, environment: "production", applicationContractVersion: APPLICATION_CONTRACT_VERSION }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
      if (path === "/") return new Response("<!doctype html><html><body>Donate by Mail</body></html>", { status: 200, headers: { ...productionHeaders, "content-type": "text/html" } });
      if (path === "/api/agent/v1/queries") return new Response(JSON.stringify({ code: "agent_disabled_in_production" }), { status: 404, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32003 }, id: null }), { status: 404, headers: { "content-type": "application/json" } });
    };
    await expect(checkProductionEndpoints("https://donatebymail.org")).rejects.toThrow(/current Worker-served HTML shell/);
  });

  it("requires HSTS to cover subdomains", async () => {
    globalThis.fetch = async (input) => {
      const requestUrl = typeof input === "string" ? input : "url" in input ? input.url : input.href;
      const parsed = new URL(requestUrl);
      if (parsed.protocol === "http:") return new Response(null, { status: 308, headers: { location: "https://donatebymail.org/" } });
      const path = parsed.pathname;
      if (path === "/healthz") return new Response(JSON.stringify({ ok: true, environment: "production" }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
      if (path === "/readyz") return new Response(JSON.stringify({ ok: true, ready: true, environment: "production", applicationContractVersion: APPLICATION_CONTRACT_VERSION }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
      if (path === "/") return new Response("<!doctype html><html><body>Donate by Mail</body></html>", { status: 200, headers: { ...productionHeaders, "strict-transport-security": "max-age=31536000", "content-type": "text/html", "x-dbm-application-contract-version": APPLICATION_CONTRACT_VERSION } });
      if (path === "/ads.txt") return new Response(null, { status: 404, headers: { "x-robots-tag": "noindex", "cache-control": "no-store" } });
      if (path === "/api/agent/v1/queries") return new Response(JSON.stringify({ code: "agent_disabled_in_production" }), { status: 404, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32003 }, id: null }), { status: 404, headers: { "content-type": "application/json" } });
    };
    await expect(checkProductionEndpoints("https://donatebymail.org")).rejects.toThrow(/current Worker-served HTML shell/);
  });

  it("cannot be redirected to an unrelated HTTPS origin", async () => {
    await expect(checkProductionEndpoints("https://production.example")).rejects.toThrow(/canonical Donate by Mail/);
  });

  it("rejects an HTTPS redirect with a non-root path or query", async () => {
    globalThis.fetch = async (input) => new URL(typeof input === "string" ? input : "url" in input ? input.url : input.href).protocol === "http:"
      ? new Response(null, { status: 308, headers: { location: "https://donatebymail.org/alternate?next=1" } })
      : new Response(null, { status: 500 });
    await expect(checkProductionEndpoints("https://donatebymail.org")).rejects.toThrow(/canonical HTTPS origin/);
  });

  it("checks both canonical production hostnames when given the root origin", async () => {
    const seen = new Set<string>();
    globalThis.fetch = async (input) => {
      const requestUrl = typeof input === "string" ? input : "url" in input ? input.url : input.href;
      const parsed = new URL(requestUrl);
      if (parsed.protocol === "http:") return new Response(null, { status: 308, headers: { location: `${parsed.origin.replace("http:", "https:")}/` } });
      seen.add(new URL(requestUrl).origin);
      const path = parsed.pathname;
      if (path === "/healthz") return new Response(JSON.stringify({ ok: true, environment: "production" }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
      if (path === "/readyz") return new Response(JSON.stringify({ ok: true, ready: true, environment: "production", applicationContractVersion: APPLICATION_CONTRACT_VERSION }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
      if (path === "/") return new Response("<!doctype html><html><body>Donate by Mail</body></html>", { status: 200, headers: { ...productionHeaders, "content-type": "text/html", "x-dbm-application-contract-version": APPLICATION_CONTRACT_VERSION } });
      if (path === "/ads.txt") return new Response(null, { status: 404, headers: { "x-robots-tag": "noindex", "cache-control": "no-store" } });
      if (path === "/api/agent/v1/queries") return new Response(JSON.stringify({ code: "agent_disabled_in_production" }), { status: 404, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32003 }, id: null }), { status: 404, headers: { "content-type": "application/json" } });
    };
    await expect(checkProductionHosts("https://donatebymail.org")).resolves.toHaveLength(2);
    expect(seen).toEqual(new Set(["https://donatebymail.org", "https://www.donatebymail.org"]));
  });
});
