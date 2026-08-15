import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { accessTokenAssuranceLevel, boundedPkceStorage, brevoIdempotencyKey, browserMutationOriginAllowed, isValidAuthDestination, isValidAuthTokenResponse, readBoundedResponseBytes, readBoundedResponseJson, readJson, storageObjectPath, verifyTurnstile } from "./worker";
import { sealSession, sessionCookie } from "./gen2/bffSession";

const fixtureSecret = (label: string) => `${label}-fixture-secret-32-characters-minimum`;

afterEach(() => vi.restoreAllMocks());

describe("bounded JSON request parsing", () => {
  it("rejects a streaming body that omits content-length and exceeds the limit", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"'));
        controller.enqueue(new TextEncoder().encode("x".repeat(128)));
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
      },
    });
    const request = new Request("https://beta.donatebymail.org/api/example", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readJson(request, 64)).rejects.toThrow("Request is too large.");
  });

  it("parses a bounded JSON body without trusting content-length", async () => {
    const request = new Request("https://beta.donatebymail.org/api/example", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "safe" }),
    });

    await expect(readJson(request, 64)).resolves.toEqual({ value: "safe" });
  });

  it("accepts case-insensitive JSON media types with a charset", async () => {
    const request = new Request("https://beta.donatebymail.org/api/example", {
      method: "POST",
      headers: { "content-type": "Application/JSON; charset=utf-8" },
      body: JSON.stringify({ value: "safe" }),
    });

    await expect(readJson(request, 64)).resolves.toEqual({ value: "safe" });
  });

  it("rejects a misleading JSON substring in the media type", async () => {
    const request = new Request("https://beta.donatebymail.org/api/example", {
      method: "POST",
      headers: { "content-type": "text/plain; application/json" },
      body: JSON.stringify({ value: "safe" }),
    });

    await expect(readJson(request, 64)).rejects.toThrow("Expected a JSON request.");
  });

  it("does not wait indefinitely for a stalled request body", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull() { return new Promise<void>(() => undefined); },
    });
    const request = new Request("https://beta.donatebymail.org/api/example", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readJson(request, 64, 5)).rejects.toThrow("request_read_timeout");
  });
});

describe("private storage path boundary", () => {
  it("rejects traversal and control characters before constructing a Storage URL", () => {
    expect(storageObjectPath("campaigns/00000000-0000-4000-8000-000000000001/image.webp")).toContain("campaigns/");
    expect(() => storageObjectPath("campaigns/../secrets")).toThrow("unsafe_storage_path");
    expect(() => storageObjectPath("campaigns/%2e%2e/secrets")).not.toThrow();
    expect(() => storageObjectPath("campaigns/\u0000secret")).toThrow("unsafe_storage_path");
    expect(() => storageObjectPath("/campaigns/image.webp")).toThrow("unsafe_storage_path");
  });
});

describe("provider session response boundary", () => {
  it("accepts only bounded, positive-lifetime token responses", () => {
    expect(isValidAuthTokenResponse({ access_token: "access", refresh_token: "refresh", expires_in: 3600 })).toBe(true);
    expect(isValidAuthTokenResponse({ access_token: "", refresh_token: "refresh", expires_in: 3600 })).toBe(false);
    expect(isValidAuthTokenResponse({ access_token: "access", refresh_token: "refresh", expires_in: 0 })).toBe(false);
    expect(isValidAuthTokenResponse({ access_token: "access", refresh_token: "refresh", expires_in: 60.5 })).toBe(false);
    expect(isValidAuthTokenResponse({ access_token: "access", refresh_token: "refresh", expires_in: 60 * 60 * 24 * 8 })).toBe(false);
    expect(isValidAuthTokenResponse({ access_token: "access", refresh_token: "refresh", expires_in: 3600, unexpected: true })).toBe(true);
  });
});

describe("auth handoff boundary", () => {
  it("accepts only fixed destinations and bounded PKCE storage", () => {
    expect(isValidAuthDestination("/staff")).toBe(true);
    expect(isValidAuthDestination("https://attacker.example")).toBe(false);
    expect(boundedPkceStorage({ verifier: "safe" })).toEqual({ verifier: "safe" });
    expect(boundedPkceStorage({ "bad key": "safe" })).toBeNull();
    expect(boundedPkceStorage({ verifier: "x".repeat(4_097) })).toBeNull();
    expect(boundedPkceStorage(Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`k${index}`, "v"]))))
      .toBeNull();
  });
});

describe("bounded private asset reads", () => {
  it("rejects a provider response whose declared length exceeds the image cap", async () => {
    const response = new Response(new Uint8Array(32), {
      headers: { "content-length": "32" },
    });
    await expect(readBoundedResponseBytes(response, 16)).rejects.toThrow("asset_too_large");
  });

  it("rejects a chunked provider response that exceeds the image cap", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(9));
        controller.close();
      },
    });
    const response = new Response(body);
    await expect(readBoundedResponseBytes(response, 16)).rejects.toThrow("asset_too_large");
  });
});

describe("bounded upstream JSON reads", () => {
  it("rejects a declared oversized provider response before JSON parsing", async () => {
    const response = new Response('{"ok":true}', {
      headers: { "content-length": "128" },
    });
    await expect(readBoundedResponseJson(response, 32)).rejects.toThrow("response_too_large");
  });

  it("rejects a chunked provider response that exceeds the JSON cap", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"'));
        controller.enqueue(new TextEncoder().encode("x".repeat(40)));
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
      },
    });
    await expect(readBoundedResponseJson(new Response(body), 32)).rejects.toThrow("response_too_large");
  });

  it("parses a bounded upstream JSON response", async () => {
    await expect(readBoundedResponseJson<{ ok: boolean }>(new Response('{"ok":true}'), 128)).resolves.toEqual({ ok: true });
  });
});

describe("browser mutation origin checks", () => {
  it("rejects missing and cross-site origins while accepting same-origin browser requests", () => {
    expect(browserMutationOriginAllowed(new Request("https://beta.donatebymail.org/api/example", { method: "POST" }))).toBe(false);
    expect(browserMutationOriginAllowed(new Request("https://beta.donatebymail.org/api/example", {
      method: "POST", headers: { origin: "https://attacker.example" },
    }))).toBe(false);
    expect(browserMutationOriginAllowed(new Request("https://beta.donatebymail.org/api/example", {
      method: "POST", headers: { origin: "https://beta.donatebymail.org" },
    }))).toBe(true);
    expect(browserMutationOriginAllowed(new Request("https://beta.donatebymail.org/api/example", {
      method: "POST", headers: { "sec-fetch-site": "same-origin" },
    }))).toBe(true);
  });
});

describe("credentialed read origin checks", () => {
  it("rejects cross-site staff reads before authenticating the private session", async () => {
    const accessTokenPayload = btoa(JSON.stringify({ aal: "aal2" })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const sessionSecret = fixtureSecret("staff-session");
    const sealed = await sealSession({
      accessToken: `header.${accessTokenPayload}.signature`,
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 3_600_000,
      absoluteExpiresAt: Date.now() + 86_400_000,
      csrf: "csrf-token-with-sufficient-entropy",
    }, sessionSecret);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await worker.fetch(
      new Request("https://beta.donatebymail.org/api/staff/session", {
        headers: { cookie: sessionCookie(sealed), "sec-fetch-site": "cross-site" },
      }),
      {
        DEPLOYMENT_ENVIRONMENT: "beta",
        SUPABASE_URL: "https://beta.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "publishable-key",
        SUPABASE_SECRET_KEY: fixtureSecret("staff-supabase"),
        DONATION_TRACKING_SECRET: fixtureSecret("staff-donation"),
        BFF_SESSION_SECRET: sessionSecret,
      } as never,
    );
    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects cross-site fetch metadata before a Pledge provider lookup", async () => {
    const response = await worker.fetch(
      new Request("https://beta.donatebymail.org/api/pledge/organizations/00000000-0000-4000-8000-000000000001", {
        headers: { "sec-fetch-site": "cross-site" },
      }),
      { DEPLOYMENT_ENVIRONMENT: "beta", PLEDGE_API_KEY: fixtureSecret("pledge") } as never,
    );
    expect(response.status).toBe(403);
  });

  it("rate-limits same-origin Pledge lookups before spending the provider credential", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("false", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const response = await worker.fetch(
      new Request("https://beta.donatebymail.org/api/pledge/organizations/00000000-0000-4000-8000-000000000001", {
        headers: { origin: "https://beta.donatebymail.org", "cf-connecting-ip": "203.0.113.10" },
      }),
      {
        DEPLOYMENT_ENVIRONMENT: "beta",
        PLEDGE_API_KEY: fixtureSecret("pledge"),
        SUPABASE_URL: "https://beta.supabase.co",
        SUPABASE_SECRET_KEY: fixtureSecret("supabase"),
        DONATION_TRACKING_SECRET: "donation-tracking-secret-32-characters-minimum",
      } as never,
    );
    expect(response.status).toBe(429);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toContain("/rest/v1/rpc/consume_anonymous_rate_limit");
  });

  it("uses the isolated Pledge staging API for beta beneficiary verification", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/rest/v1/rpc/consume_anonymous_rate_limit"))
        return new Response("true", { status: 200, headers: { "content-type": "application/json" } });
      if (url.startsWith("https://api-staging.pledge.to/v1/organizations/"))
        return new Response(JSON.stringify({ name: "Sandbox Charity", country_code: "US" }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("unexpected", { status: 500 });
    });
    const response = await worker.fetch(
      new Request("https://beta.donatebymail.org/api/pledge/organizations/00000000-0000-4000-8000-000000000001", {
        headers: { origin: "https://beta.donatebymail.org", "cf-connecting-ip": "203.0.113.13" },
      }),
      {
        DEPLOYMENT_ENVIRONMENT: "beta",
        PLEDGE_API_KEY: fixtureSecret("sandbox-pledge"),
        SUPABASE_URL: "https://beta.supabase.co",
        SUPABASE_SECRET_KEY: fixtureSecret("supabase"),
        DONATION_TRACKING_SECRET: "donation-tracking-secret-32-characters-minimum",
      } as never,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, charity: { name: "Sandbox Charity" } });
    expect(fetchSpy.mock.calls.some(([input]) => String(input).startsWith("https://api-staging.pledge.to/"))).toBe(true);
    expect(fetchSpy.mock.calls.some(([input]) => String(input).startsWith("https://api.pledge.to/"))).toBe(false);
  });

  it("does not let public campaign enrichment bypass the Pledge lookup budget", async () => {
    const campaignId = "00000000-0000-4000-8000-000000000001";
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        slug: "spring-drive", headline: "Spring phone drive", charityPledgeId: campaignId,
        charityName: "Verified charity",
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response("false", {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    const response = await worker.fetch(
      new Request("https://beta.donatebymail.org/api/campaigns/spring-drive", {
        headers: { "cf-connecting-ip": "203.0.113.11" },
      }),
      {
        DEPLOYMENT_ENVIRONMENT: "beta",
        PLEDGE_API_KEY: fixtureSecret("pledge"),
        SUPABASE_URL: "https://beta.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "supabase-publishable",
        SUPABASE_SECRET_KEY: fixtureSecret("supabase"),
        DONATION_TRACKING_SECRET: "donation-tracking-secret-32-characters-minimum",
        BFF_SESSION_SECRET: "bff-session-secret-32-characters-minimum",
      } as never,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, campaign: { charityName: "Verified charity" } });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls.some(([input]) => String(input).includes("api.pledge.to"))).toBe(false);
  });

  it("rate-limits tracking material probes before the HMAC lookup", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("false", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const response = await worker.fetch(
      new Request("https://beta.donatebymail.org/api/donations/status", {
        method: "POST",
        headers: { origin: "https://beta.donatebymail.org", "cf-connecting-ip": "203.0.113.12", "content-type": "application/json" },
        body: JSON.stringify({ publicId: "DBM-20260808-ABCDEF12", token: "a".repeat(43) }),
      }),
      {
        DEPLOYMENT_ENVIRONMENT: "beta",
        SUPABASE_URL: "https://beta.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "supabase-publishable",
        SUPABASE_SECRET_KEY: fixtureSecret("supabase"),
        DONATION_TRACKING_SECRET: "donation-tracking-secret-32-characters-minimum",
        BFF_SESSION_SECRET: "bff-session-secret-32-characters-minimum",
      } as never,
    );
    expect(response.status).toBe(429);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toContain("/rest/v1/rpc/consume_anonymous_rate_limit");
  });
});

describe("public partner application request boundary", () => {
  const env = {
    DEPLOYMENT_ENVIRONMENT: "beta",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
    SUPABASE_SECRET_KEY: fixtureSecret("supabase"),
    DONATION_TRACKING_SECRET: "donation-tracking-test-secret-32-characters-minimum",
    BFF_SESSION_SECRET: "bff-session-test-secret-32-characters-minimum",
    BREVO_API_KEY: fixtureSecret("brevo"),
    PLEDGE_API_KEY: fixtureSecret("pledge"),
  };

  it("requires JSON before attempting to parse or persist an application", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("true", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const response = await worker.fetch(new Request("https://beta.donatebymail.org/api/partner/applications", {
      method: "POST",
      headers: { origin: "https://beta.donatebymail.org", "content-type": "text/plain", "cf-connecting-ip": "203.0.113.21" },
      body: "not-json",
    }), env as never);
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ message: "Expected a JSON request." });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects a misleading JSON substring before attempting to persist an application", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("true", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const response = await worker.fetch(new Request("https://beta.donatebymail.org/api/partner/applications", {
      method: "POST",
      headers: { origin: "https://beta.donatebymail.org", "content-type": "text/plain; application/json", "cf-connecting-ip": "203.0.113.24" },
      body: "not-json",
    }), env as never);
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ message: "Expected a JSON request." });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized application before reading the body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("true", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const response = await worker.fetch(new Request("https://beta.donatebymail.org/api/partner/applications", {
      method: "POST",
      headers: { origin: "https://beta.donatebymail.org", "content-type": "application/json", "content-length": "18001", "cf-connecting-ip": "203.0.113.22" },
      body: JSON.stringify({ value: "small" }),
    }), env as never);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ message: "The application is too large." });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid negative declared length before reading the body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("true", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const response = await worker.fetch(new Request("https://beta.donatebymail.org/api/partner/applications", {
      method: "POST",
      headers: { origin: "https://beta.donatebymail.org", "content-type": "application/json", "content-length": "-1", "cf-connecting-ip": "203.0.113.23" },
      body: JSON.stringify({ value: "small" }),
    }), env as never);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ message: "The application is too large." });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("legacy agent REST boundary", () => {
  const env = {
    DEPLOYMENT_ENVIRONMENT: "beta",
    AGENT_API_KEY: "agent-test-key-16",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
    SUPABASE_SECRET_KEY: fixtureSecret("supabase"),
    DONATION_TRACKING_SECRET: "donation-tracking-test-secret-32-characters-minimum",
    BFF_SESSION_SECRET: "bff-session-test-secret-32-characters-minimum",
  };

  it("rejects a weakly configured agent secret before parsing the request", async () => {
    const response = await worker.fetch(new Request("https://beta.donatebymail.org/api/agent/v1/queries", {
      method: "POST",
      headers: { authorization: "Bearer short-agent-key", "content-type": "application/json" },
      body: JSON.stringify({ kind: "campaign", slug: "campaign" }),
    }), { ...env, AGENT_API_KEY: "short-agent-key" } as never);
    expect(response.status).toBe(401);
  });

  it("rejects an oversized agent bearer before hashing it", async () => {
    const response = await worker.fetch(new Request("https://beta.donatebymail.org/api/agent/v1/queries", {
      method: "POST",
      headers: { authorization: `Bearer ${"x".repeat(8_193)}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "campaign", slug: "campaign" }),
    }), env as never);
    expect(response.status).toBe(401);
  });

  it("rejects malformed command targets before calling Supabase", async () => {
    const response = await worker.fetch(new Request("https://beta.donatebymail.org/api/agent/v1/commands", {
      method: "POST",
      headers: { authorization: "Bearer agent-test-key-16", "content-type": "application/json" },
      body: JSON.stringify({ command: "create_internal_note", targetType: "donation", targetId: "not-a-uuid", risk: "low", idempotencyKey: "command-test-1", payload: { body: "note" } }),
    }), env as never);
    expect(response.status).toBe(400);
  });

  it("rejects malformed query identifiers before calling Supabase", async () => {
    const response = await worker.fetch(new Request("https://beta.donatebymail.org/api/agent/v1/queries", {
      method: "POST",
      headers: { authorization: "Bearer agent-test-key-16", "content-type": "application/json" },
      body: JSON.stringify({ kind: "donation_status", publicId: "not-a-public-id" }),
    }), env as never);
    expect(response.status).toBe(400);
  });

  it("accepts the canonical 21-character donation public ID", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      publicId: "DBM-20260808-ABCDEF12",
      status: "submitted",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const response = await worker.fetch(new Request("https://beta.donatebymail.org/api/agent/v1/queries", {
      method: "POST",
      headers: { authorization: "Bearer agent-test-key-16", "content-type": "application/json" },
      body: JSON.stringify({ kind: "donation_status", publicId: "DBM-20260808-ABCDEF12" }),
    }), env as never);
    expect(response.status).toBe(200);
  });

  it("retires tenantless partner and campaign reads at the legacy boundary", async () => {
    const campaignResponse = await worker.fetch(new Request("https://beta.donatebymail.org/api/agent/v1/queries", {
      method: "POST",
      headers: { authorization: "Bearer agent-test-key-16", "content-type": "application/json" },
      body: JSON.stringify({ kind: "campaign_metrics", id: "91000000-0000-4000-8000-000000000005" }),
    }), env as never);
    expect(campaignResponse.status).toBe(410);
    expect(await campaignResponse.json()).toMatchObject({ code: "legacy_agent_query_removed" });

    const partnerResponse = await worker.fetch(new Request("https://beta.donatebymail.org/api/agent/v1/queries", {
      method: "POST",
      headers: { authorization: "Bearer agent-test-key-16", "content-type": "application/json" },
      body: JSON.stringify({ kind: "partner_context", id: "91000000-0000-4000-8000-000000000004" }),
    }), env as never);
    expect(partnerResponse.status).toBe(410);
    expect(await partnerResponse.json()).toMatchObject({ code: "legacy_agent_query_removed" });
  });

  it("rejects malformed legacy MCP envelopes and tool arguments", async () => {
    const response = await worker.fetch(new Request("https://beta.donatebymail.org/mcp", {
      method: "POST",
      headers: { authorization: "Bearer agent-test-key-16", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "1.0", id: { forged: true }, method: "tools/call" }),
    }), env as never);
    expect(response.status).toBe(400);
    const body = await response.json() as { error?: { code?: number }; id?: unknown };
    expect(body.error?.code).toBe(-32600);
    expect(body.id).toBeNull();
  });

  it("returns protocol parse errors for malformed legacy MCP JSON", async () => {
    const response = await worker.fetch(new Request("https://beta.donatebymail.org/mcp", {
      method: "POST",
      headers: { authorization: "Bearer agent-test-key-16", "content-type": "application/json" },
      body: "{\"jsonrpc\":\"2.0\",",
    }), env as never);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  });

  it("returns a protocol size error before parsing an oversized legacy MCP body", async () => {
    const response = await worker.fetch(new Request("https://beta.donatebymail.org/mcp", {
      method: "POST",
      headers: { authorization: "Bearer agent-test-key-16", "content-type": "application/json" },
      body: `{"jsonrpc":"2.0","method":"tools/list","padding":"${"x".repeat(50_001)}"}`,
    }), env as never);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Request too large" } });
  });

  it("keeps legacy MCP semantic commands separate from typed support email tools", async () => {
    const response = await worker.fetch(new Request("https://beta.donatebymail.org/mcp", {
      method: "POST",
      headers: { authorization: "Bearer agent-test-key-16", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    }), env as never);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      result?: { tools?: Array<{ name?: string; inputSchema?: { properties?: { command?: { enum?: string[] } } } }> };
    };
    const commandTool = body.result?.tools?.find((tool) => tool.name === "evaluate_semantic_command");
    expect(commandTool?.inputSchema?.properties?.command?.enum).not.toContain("send_message");

    const rejected = await worker.fetch(new Request("https://beta.donatebymail.org/mcp", {
      method: "POST",
      headers: { authorization: "Bearer agent-test-key-16", "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 3, method: "tools/call",
        params: { name: "evaluate_semantic_command", arguments: {
          command: "send_message", targetType: "support_email", risk: "low", idempotencyKey: "legacy-send-001",
        } },
      }),
    }), env as never);
    const rejectedBody = await rejected.json() as { error?: { code?: number } };
    expect(rejectedBody.error?.code).toBe(-32602);
  });
});

describe("production Turnstile verification", () => {
  it("binds successful tokens to the expected action and hostname", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      success: true,
      action: "auth_magic_link",
      hostname: "donatebymail.org",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const request = new Request("https://donatebymail.org/api/account/auth/magic-link", {
      headers: { "cf-connecting-ip": "192.0.2.20" },
    });

    await expect(verifyTurnstile(request, {
      DEPLOYMENT_ENVIRONMENT: "production",
      TURNSTILE_SECRET_KEY: "test-only-secret",
    } as never, "token", "auth_magic_link")).resolves.toBe(true);
  });

  it("rejects a token issued for a different action", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      success: true,
      action: "donation_submit",
      hostname: "donatebymail.org",
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(verifyTurnstile(new Request("https://donatebymail.org/login"), {
      DEPLOYMENT_ENVIRONMENT: "production",
      TURNSTILE_SECRET_KEY: "test-only-secret",
    } as never, "token", "auth_magic_link")).resolves.toBe(false);
  });

  it("rejects an unsafe configured hostname allowlist before accepting provider output", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(verifyTurnstile(new Request("https://donatebymail.org/login"), {
      DEPLOYMENT_ENVIRONMENT: "production",
      TURNSTILE_SECRET_KEY: "test-only-secret",
      TURNSTILE_HOSTNAMES: "evil.example",
    } as never, "token", "auth_magic_link")).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("staff authenticator assurance", () => {
  const token = (payload: Record<string, unknown>) => `header.${btoa(JSON.stringify(payload)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}.signature`;
  it("accepts only recognized AAL claims from the already validated access token", () => {
    expect(accessTokenAssuranceLevel(token({ aal: "aal2" }))).toBe("aal2");
    expect(accessTokenAssuranceLevel(token({ aal: "aal1" }))).toBe("aal1");
    expect(accessTokenAssuranceLevel(token({ aal: "owner" }))).toBeNull();
    expect(accessTokenAssuranceLevel("malformed")).toBeNull();
  });
});

describe("transactional email idempotency", () => {
  it("derives stable UUID-v4-shaped keys per durable recipient", async () => {
    const donor = await brevoIdempotencyKey("00000000-0000-4000-8000-000000000001", "donor");
    expect(donor).toBe(await brevoIdempotencyKey("00000000-0000-4000-8000-000000000001", "donor"));
    expect(donor).not.toBe(await brevoIdempotencyKey("00000000-0000-4000-8000-000000000001", "admin"));
    expect(donor).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
