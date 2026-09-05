import { afterAll, describe, expect, it } from "vitest";
import agentWorker from "./agentWorker";

const env = {
  DEPLOYMENT_ENVIRONMENT: "beta",
  AGENT_API_KEY: "test-agent-key-16",
  MCP_ARTICLE_BEARER_TOKEN: "test-article-bearer",
  CF_ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
  CF_ACCESS_AUDIENCE: "test-access-audience",
} as unknown as Env;

const context = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

async function mcp(body: Record<string, unknown>, authorization = "Bearer test-agent-key-16") {
  return agentWorker.fetch(
    new Request("https://beta.donatebymail.org/mcp", {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
        origin: "https://chatgpt.com",
      },
      body: JSON.stringify(body),
    }),
    env,
    context,
  );
}

async function operationsMcp(body: Record<string, unknown>, authorization = "Bearer test-agent-key-16") {
  return agentWorker.fetch(
    new Request("https://mcp-operations-connector-beta.donatebymail.org/mcp", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
    context,
  );
}

const realFetch = globalThis.fetch;
let accessKeyPair: CryptoKeyPair | null = null;
let accessPublicJwk: JsonWebKey | null = null;
const accessKid = "test-access-key";

function base64Url(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function accessToken(overrides: Record<string, unknown> = {}): Promise<string> {
  if (!accessKeyPair) {
    accessKeyPair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    ) as CryptoKeyPair;
    accessPublicJwk = await crypto.subtle.exportKey("jwk", accessKeyPair.publicKey);
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      if (url === "https://test.cloudflareaccess.com/cdn-cgi/access/certs") {
        return new Response(JSON.stringify({ keys: [{ ...accessPublicJwk, kid: accessKid, alg: "RS256", use: "sig" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return realFetch(input, init);
    };
  }
  const header = base64Url(JSON.stringify({ alg: "RS256", kid: accessKid, typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    type: "app",
    aud: [env.CF_ACCESS_AUDIENCE],
    iss: `https://${env.CF_ACCESS_TEAM_DOMAIN}`,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  }));
  const input = `${header}.${claims}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    accessKeyPair.privateKey,
    new TextEncoder().encode(input),
  ));
  return `${input}.${base64Url(signature)}`;
}

async function accessHeaders(kind: "assertion" | "authorization" = "assertion", overrides: Record<string, unknown> = {}): Promise<Record<string, string>> {
  const token = await accessToken(overrides);
  return kind === "assertion"
    ? { "cf-access-jwt-assertion": token }
    : { authorization: `Bearer ${token}` };
}

async function articleMcp(body: Record<string, unknown>, headers?: Record<string, string>) {
  return agentWorker.fetch(
    new Request("https://mcp-beta.donatebymail.org/mcp/articles", {
      method: "POST",
      headers: { ...(headers || await accessHeaders()), "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
    context,
  );
}

async function articlePortalUpstream(body: Record<string, unknown>, authorization = "Bearer test-article-bearer") {
  return agentWorker.fetch(
    new Request("https://mcp-connector-beta.donatebymail.org/mcp", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
    context,
  );
}

async function articleDirectOAuth(body: Record<string, unknown>, headers?: Record<string, string>) {
  return agentWorker.fetch(
    new Request("https://mcp-oauth-beta.donatebymail.org/mcp", {
      method: "POST",
      headers: { ...(headers || await accessHeaders()), "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
    context,
  );
}

describe("Donate by Mail agent MCP wrapper", () => {
  it("redirects hosted beta MCP requests to HTTPS before authentication", async () => {
    const response = await agentWorker.fetch(
      new Request("http://mcp-operations-connector-beta.donatebymail.org/mcp", {
        method: "POST",
        headers: { authorization: "Bearer test-agent-key-16", "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      }),
      env,
      context,
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://mcp-operations-connector-beta.donatebymail.org/mcp");
  });

  it("rejects a weakly configured agent secret before accepting the request", async () => {
    const response = await agentWorker.fetch(
      new Request("https://beta.donatebymail.org/mcp", {
        method: "POST",
        headers: { authorization: "Bearer short-agent-key", "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize" }),
      }),
      { ...env, AGENT_API_KEY: "short-agent-key" },
      context,
    );
    expect(response.status).toBe(401);
  });

  it("requires the agent bearer secret", async () => {
    const response = await mcp({ jsonrpc: "2.0", id: 1, method: "initialize" }, "Bearer wrong-key");
    expect(response.status).toBe(401);
  });

  it("rejects oversized bearer credentials before hashing them", async () => {
    const response = await mcp({ jsonrpc: "2.0", id: 2, method: "initialize" }, `Bearer ${"x".repeat(8_193)}`);
    expect(response.status).toBe(401);
  });

  it("accepts a remote MCP origin after bearer authentication", async () => {
    const response = await mcp({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(response.status).toBe(200);
    expect(response.headers.get("MCP-Protocol-Version")).toBe("2025-06-18");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    const body = await response.json() as { result?: { protocolVersion?: string; serverInfo?: { name?: string } } };
    expect(body.result?.protocolVersion).toBe("2025-06-18");
    expect(body.result?.serverInfo?.name).toBe("donate-by-mail-operations");
  });

  it("rejects an untrusted browser origin before MCP authentication or dispatch", async () => {
    const response = await agentWorker.fetch(
      new Request("https://beta.donatebymail.org/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer test-agent-key-16",
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      }),
      env,
      context,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: -32002 } });
  });

  it("binds the operations connector hostname to the full operations surface", async () => {
    const denied = await operationsMcp({ jsonrpc: "2.0", id: 12, method: "initialize" }, "Bearer test-article-bearer");
    expect(denied.status).toBe(401);
    const allowed = await operationsMcp({ jsonrpc: "2.0", id: 13, method: "initialize" });
    expect(allowed.status).toBe(200);
    const body = await allowed.json() as { result?: { serverInfo?: { name?: string } } };
    expect(body.result?.serverInfo?.name).toBe("donate-by-mail-operations");
  });

  it("rejects an oversized MCP request before parsing or invoking a tool", async () => {
    const response = await agentWorker.fetch(
      new Request("https://beta.donatebymail.org/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer test-agent-key-16",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "initialize", padding: "x".repeat(100_001) }),
      }),
      env,
      context,
    );
    expect(response.status).toBe(413);
    const body = await response.json() as { error?: { message?: string } };
    expect(body.error?.message).toBe("Request too large");
  });

  it("rejects malformed JSON-RPC envelopes before dispatch", async () => {
    const response = await mcp({ jsonrpc: "1.0", id: true, method: "initialize" });
    expect(response.status).toBe(200);
    const body = await response.json() as { error?: { code?: number; message?: string } };
    expect(body.error?.code).toBe(-32600);
    expect(body.error?.message).toBe("Invalid Request");
  });

  it("bounds JSON-RPC method and tool-name strings before dispatch or logging", async () => {
    const longMethod = await mcp({ jsonrpc: "2.0", id: 45, method: "x".repeat(121) });
    const longMethodBody = await longMethod.json() as { error?: { code?: number; message?: string } };
    expect(longMethodBody.error?.code).toBe(-32600);

    const longTool = await mcp({
      jsonrpc: "2.0", id: 46, method: "tools/call",
      params: { name: "x".repeat(121), arguments: {} },
    });
    const longToolBody = await longTool.json() as { error?: { code?: number; message?: string } };
    expect(longToolBody.error?.code).toBe(-32602);
  });

  it("does not echo an object JSON-RPC id in an invalid-request response", async () => {
    const response = await mcp({ jsonrpc: "2.0", id: { forged: true }, method: "initialize" });
    const body = await response.json() as { id?: unknown; error?: { code?: number } };
    expect(body.error?.code).toBe(-32600);
    expect(body.id).toBeNull();
  });

  it("rejects array tool arguments before bounded dispatch", async () => {
    const response = await mcp({
      jsonrpc: "2.0",
      id: 38,
      method: "tools/call",
      params: { name: "support_capabilities", arguments: [] },
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { error?: { code?: number; message?: string } };
    expect(body.error?.code).toBe(-32602);
    expect(body.error?.message).toBe("Invalid params");
  });

  it("rejects oversized scalar tool arguments before database dispatch", async () => {
    const response = await mcp({
      jsonrpc: "2.0",
      id: 39,
      method: "tools/call",
      params: {
        name: "get_donation_support_snapshot",
        arguments: { donationId: "x".repeat(4_001), requesterEmail: "donor@example.com" },
      },
    });
    const body = await response.json() as { error?: { code?: number; message?: string } };
    expect(body.error?.code).toBe(-32602);
    expect(body.error?.message).toBe("The bounded operation was rejected.");
  });

  it("rejects an oversized tool result before returning it to the agent", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/rest/v1/rpc/agent_support_capabilities")) {
        return new Response(JSON.stringify({ capabilities: "x".repeat(2 * 1024 * 1024) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return previousFetch(input, init);
    };
    try {
      const response = await agentWorker.fetch(
        new Request("https://beta.donatebymail.org/mcp", {
          method: "POST",
          headers: { authorization: "Bearer test-agent-key-16", "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 48, method: "tools/call", params: { name: "support_capabilities", arguments: {} } }),
        }),
        { ...env, SUPABASE_URL: "https://db.supabase.co", SUPABASE_SECRET_KEY: ["test", "supabase", "secret", "16"].join("-") } as unknown as Env,
        context,
      );
      expect(response.status).toBe(200);
      const body = await response.json() as { error?: { code?: number; message?: string }; result?: unknown };
      expect(body.error?.code).toBe(-32602);
      expect(body.error?.message).toBe("The bounded operation was rejected.");
      expect(body.result).toBeUndefined();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("rejects schema-invalid email and unknown arguments before database dispatch", async () => {
    const invalidEmail = await mcp({
      jsonrpc: "2.0", id: 41, method: "tools/call",
      params: { name: "find_donations", arguments: { requesterEmail: "not-an-email" } },
    });
    const invalidEmailBody = await invalidEmail.json() as { error?: { code?: number } };
    expect(invalidEmailBody.error?.code).toBe(-32602);

    const unknownArgument = await mcp({
      jsonrpc: "2.0", id: 42, method: "tools/call",
      params: { name: "support_capabilities", arguments: { unexpected: true } },
    });
    const unknownArgumentBody = await unknownArgument.json() as { error?: { code?: number } };
    expect(unknownArgumentBody.error?.code).toBe(-32602);
  });

  it("accepts the canonical 21-character donation ID in support lookup", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/rest/v1/rpc/agent_find_donations")) {
        return new Response(JSON.stringify({ matches: [], resultCount: 0 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return previousFetch(input, init);
    };
    try {
      const response = await agentWorker.fetch(
        new Request("https://beta.donatebymail.org/mcp", {
          method: "POST",
          headers: { authorization: "Bearer test-agent-key-16", "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0", id: 44, method: "tools/call",
            params: {
              name: "find_donations",
              arguments: { requesterEmail: "donor@example.com", publicId: "DBM-20260808-ABCDEF12" },
            },
          }),
        }),
        { ...env, SUPABASE_URL: "https://db.supabase.co", SUPABASE_SECRET_KEY: ["test", "supabase", "secret"].join("-") } as unknown as Env,
        context,
      );
      expect(response.status).toBe(200);
      const body = await response.json() as { result?: { structuredContent?: { resultCount?: number } } };
      expect(body.result?.structuredContent?.resultCount).toBe(0);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("rejects malformed article blocks before database dispatch", async () => {
    const response = await mcp({
      jsonrpc: "2.0",
      id: 40,
      method: "tools/call",
      params: {
        name: "create_article_draft",
        arguments: {
          slug: "bounded-article",
          title: "Bounded article",
          excerpt: "Excerpt",
          contentBlocks: [{ type: "link", label: "Unsafe", href: "https://user:password@example.com" }],
          idempotencyKey: "bounded-article-1",
        },
      },
    });
    const body = await response.json() as { error?: { code?: number; message?: string } };
    expect(body.error?.code).toBe(-32602);
    expect(body.error?.message).toBe("The bounded operation was rejected.");
  });

  it("rejects backslash-relative article links before URL normalization", async () => {
    const response = await mcp({
      jsonrpc: "2.0",
      id: 43,
      method: "tools/call",
      params: {
        name: "create_article_draft",
        arguments: {
          slug: "backslash-link",
          title: "Bounded article",
          excerpt: "Excerpt",
          contentBlocks: [{ type: "link", label: "Unsafe", href: "/\\evil" }],
          idempotencyKey: "backslash-link-1",
        },
      },
    });
    const body = await response.json() as { error?: { code?: number; message?: string } };
    expect(body.error?.code).toBe(-32602);
    expect(body.error?.message).toBe("The bounded operation was rejected.");
  });

  it("rejects agent timestamps without an explicit timezone", async () => {
    const response = await mcp({
      jsonrpc: "2.0", id: 47, method: "tools/call",
      params: {
        name: "schedule_article_publication",
        arguments: {
          articleId: "a5000000-0000-4000-8000-000000000001",
          revisionId: "a5000000-0000-4000-8000-000000000002",
          scheduledAt: "2026-08-08T10:00:00",
          idempotencyKey: "timezone-boundary-001",
        },
      },
    });
    const body = await response.json() as { error?: { code?: number; message?: string } };
    expect(body.error?.code).toBe(-32602);
    expect(body.error?.message).toBe("The bounded operation was rejected.");
  });

  it("negotiates the current MCP protocol when a client requests it", async () => {
    const response = await articleMcp({
      jsonrpc: "2.0", id: 11, method: "initialize",
      params: { protocolVersion: "2025-11-25" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("MCP-Protocol-Version")).toBe("2025-11-25");
    const body = await response.json() as { result?: { protocolVersion?: string } };
    expect(body.result?.protocolVersion).toBe("2025-11-25");
  });

  it("rejects an unsupported MCP protocol header instead of silently downgrading", async () => {
    const invalid = await agentWorker.fetch(
      new Request("https://beta.donatebymail.org/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer test-agent-key-16",
          "content-type": "application/json",
          "MCP-Protocol-Version": "2099-01-01",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 52, method: "initialize" }),
      }),
      env,
      context,
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: -32600 } });
  });

  it("exposes only bounded coworker tools", async () => {
    const response = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const body = await response.json() as { result?: { tools?: Array<{ name: string; inputSchema?: { required?: string[]; properties?: Record<string, unknown> }; outputSchema?: { properties?: Record<string, unknown> }; securitySchemes?: unknown; annotations?: { destructiveHint?: boolean } }> } };
    const names = body.result?.tools?.map((tool) => tool.name) ?? [];

    expect(names).toContain("authorize_support_message");
    expect(names).toContain("record_outbound_message");
    expect(names).toContain("get_donation_support_snapshot");
    expect(names).not.toContain("create_article_draft");
    expect(names).not.toContain("schedule_article_publication");
    expect(names).not.toContain("publish_article");
    const commandTool = body.result?.tools?.find((tool) => tool.name === "evaluate_semantic_command");
    const commandEnum = (commandTool?.inputSchema?.properties?.command as { enum?: string[] } | undefined)?.enum;
    expect(commandEnum).not.toContain("create_article_draft");
    expect(commandTool?.annotations?.destructiveHint).toBe(true);
    expect(names).not.toContain("arbitrary_database_query");
    expect(names).not.toContain("execute_disbursement");
    const authorizationTool = body.result?.tools?.find((tool) => tool.name === "authorize_support_message");
    expect(authorizationTool?.annotations?.destructiveHint).toBe(true);
    expect(authorizationTool?.outputSchema?.properties).toEqual(expect.objectContaining({
      recipientEmail: expect.any(Object), subject: expect.any(Object), body: expect.any(Object),
    }));
    const outboundTool = body.result?.tools?.find((tool) => tool.name === "record_outbound_message");
    expect(outboundTool?.inputSchema?.required).toContain("recipientEmail");
    expect((outboundTool?.inputSchema?.properties?.senderIdentity as { pattern?: string } | undefined)?.pattern)
      .toBe("^[A-Za-z0-9._%+-]+@donatebymail\\.org$");
    expect(outboundTool?.outputSchema?.properties).toEqual(expect.objectContaining({
      authorizationConsumed: expect.any(Object), replayed: expect.any(Object),
    }));
    for (const name of [
      "record_inbound_message", "record_message_failure", "create_partner_lead",
      "set_communication_thread_status", "evaluate_semantic_command",
    ]) {
      expect(body.result?.tools?.find((tool) => tool.name === name)?.outputSchema).toBeTruthy();
    }
  });

  it("rejects editorial tools on the operations connector", async () => {
    const response = await operationsMcp({
      jsonrpc: "2.0", id: 49, method: "tools/call",
      params: { name: "publish_article", arguments: { articleId: "a5000000-0000-4000-8000-000000000001", revisionId: "a5000000-0000-4000-8000-000000000002", idempotencyKey: "operations-editorial-001" } },
    });
    const body = await response.json() as { error?: { code?: number; message?: string } };
    expect(body.error?.code).toBe(-32602);
    expect(body.error?.message).toBe("The bounded operation was rejected.");
  });

  it("keeps dedicated connector hosts from falling through to the beta SPA", async () => {
    const privateOperations = await agentWorker.fetch(
      new Request("https://mcp-beta.donatebymail.org/mcp", { method: "POST", headers: { authorization: "Bearer test-agent-key-16", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 50, method: "initialize" }) }),
      env,
      context,
    );
    expect(privateOperations.status).toBe(404);
    expect(await privateOperations.json()).toMatchObject({ code: "connector_path_not_found" });

    const unrelatedPath = await agentWorker.fetch(
      new Request("https://mcp-operations-connector-beta.donatebymail.org/", { headers: { authorization: "Bearer test-agent-key-16" } }),
      env,
      context,
    );
    expect(unrelatedPath.status).toBe(404);
    expect(await unrelatedPath.json()).toMatchObject({ code: "connector_path_not_found" });

    const articleUnrelatedPath = await agentWorker.fetch(
      new Request("https://mcp-connector-beta.donatebymail.org/", { headers: { authorization: "Bearer test-article-bearer" } }),
      env,
      context,
    );
    expect(articleUnrelatedPath.status).toBe(404);
    expect(await articleUnrelatedPath.json()).toMatchObject({ code: "connector_path_not_found" });
  });

  it("requires a Cloudflare Access assertion on the article connector", async () => {
    const response = await articleMcp({ jsonrpc: "2.0", id: 3, method: "initialize" }, {});
    expect(response.status).toBe(401);
  });

  it("rejects a signed Access token with a tampered signature, wrong audience, expired, or future-issued claims", async () => {
    const valid = await accessToken();
    const signatureStart = valid.lastIndexOf(".") + 1;
    const signatureByte = valid[signatureStart] === "A" ? "B" : "A";
    const tampered = `${valid.slice(0, signatureStart)}${signatureByte}${valid.slice(signatureStart + 1)}`;
    const invalidSignature = await articleMcp({ jsonrpc: "2.0", id: 34, method: "initialize" }, { "cf-access-jwt-assertion": tampered });
    expect(invalidSignature.status).toBe(401);
    const wrongAudience = await articleMcp({ jsonrpc: "2.0", id: 35, method: "initialize" }, await accessHeaders("assertion", { aud: ["different-app"] }));
    expect(wrongAudience.status).toBe(401);
    const expired = await articleMcp({ jsonrpc: "2.0", id: 36, method: "initialize" }, await accessHeaders("assertion", { exp: Math.floor(Date.now() / 1000) - 300 }));
    expect(expired.status).toBe(401);
    const futureIssued = await articleMcp({ jsonrpc: "2.0", id: 37, method: "initialize" }, await accessHeaders("assertion", { iat: Math.floor(Date.now() / 1000) + 300 }));
    expect(futureIssued.status).toBe(401);
  });

  it("accepts only the dedicated bearer on the portal upstream hostname", async () => {
    const denied = await articlePortalUpstream({ jsonrpc: "2.0", id: 31, method: "initialize" }, "Bearer wrong-article-token");
    expect(denied.status).toBe(401);
    const allowed = await articlePortalUpstream({ jsonrpc: "2.0", id: 32, method: "initialize" });
    expect(allowed.status).toBe(200);
    const body = await allowed.json() as { result?: { serverInfo?: { name?: string } } };
    expect(body.result?.serverInfo?.name).toBe("donate-by-mail-article-publisher");
  });

  it("accepts the validated bearer forwarded by the managed OAuth hostname", async () => {
    const denied = await articleDirectOAuth({ jsonrpc: "2.0", id: 33, method: "initialize" }, {
      authorization: "Bearer not-a-jwt",
    });
    expect(denied.status).toBe(401);
    const allowed = await articleDirectOAuth({ jsonrpc: "2.0", id: 34, method: "initialize" }, await accessHeaders("authorization"));
    expect(allowed.status).toBe(200);
    const body = await allowed.json() as { result?: { serverInfo?: { name?: string } } };
    expect(body.result?.serverInfo?.name).toBe("donate-by-mail-article-publisher");
  });

  it("exposes only editorial tools on the article connector", async () => {
    const response = await articleMcp({ jsonrpc: "2.0", id: 4, method: "tools/list" }, {
      ...(await accessHeaders()),
      "MCP-Protocol-Version": "2025-11-25",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("MCP-Protocol-Version")).toBe("2025-11-25");
    const body = await response.json() as { result?: { tools?: Array<{ name: string; annotations?: { destructiveHint?: boolean } }> } };
    const names = body.result?.tools?.map((tool) => tool.name) ?? [];

    expect(names).toEqual(expect.arrayContaining([
      "list_articles", "get_article", "create_article_draft",
      "update_article_content", "schedule_article_publication", "publish_article",
    ]));
    expect(names).not.toContain("find_donations");
    expect(names).not.toContain("authorize_support_message");
    expect(names).not.toContain("evaluate_semantic_command");

    const createTool = body.result?.tools?.find((tool) => tool.name === "create_article_draft") as
      | { inputSchema?: { properties?: { contentBlocks?: { minItems?: number; items?: unknown } } }; outputSchema?: unknown; securitySchemes?: unknown }
      | undefined;
    expect(createTool?.inputSchema?.properties?.contentBlocks?.minItems).toBe(1);
    expect(createTool?.inputSchema?.properties?.contentBlocks?.items).toBeTruthy();
    const blockAlternatives = (createTool?.inputSchema?.properties?.contentBlocks?.items as { oneOf?: Array<{ properties?: { href?: { pattern?: string } } }> })?.oneOf;
    const linkPattern = blockAlternatives?.find((alternative) => alternative.properties?.href)?.properties?.href?.pattern;
    expect(linkPattern && new RegExp(linkPattern).test("/")).toBe(true);
    expect(createTool?.outputSchema).toBeTruthy();
    expect(createTool?.securitySchemes).toEqual([{ type: "oauth2", scopes: [] }]);
    expect(body.result?.tools?.find((tool) => tool.name === "create_article_draft")?.annotations?.destructiveHint).toBe(false);
    expect(body.result?.tools?.find((tool) => tool.name === "update_article_content")?.annotations?.destructiveHint).toBe(false);
    expect(body.result?.tools?.find((tool) => tool.name === "schedule_article_publication")?.annotations?.destructiveHint).toBe(true);
    expect(body.result?.tools?.find((tool) => tool.name === "publish_article")?.annotations?.destructiveHint).toBe(true);
  });
});

afterAll(() => {
  globalThis.fetch = realFetch;
});
