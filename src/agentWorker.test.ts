import { afterAll, describe, expect, it } from "vitest";
import agentWorker from "./agentWorker";

const env = {
  DEPLOYMENT_ENVIRONMENT: "beta",
  AGENT_API_KEY: "test-agent-key",
  MCP_ARTICLE_BEARER_TOKEN: "test-article-bearer",
  CF_ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
  CF_ACCESS_AUDIENCE: "test-access-audience",
} as unknown as Env;

const context = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

async function mcp(body: Record<string, unknown>, authorization = "Bearer test-agent-key") {
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
  it("requires the agent bearer secret", async () => {
    const response = await mcp({ jsonrpc: "2.0", id: 1, method: "initialize" }, "Bearer wrong-key");
    expect(response.status).toBe(401);
  });

  it("accepts a remote MCP origin after bearer authentication", async () => {
    const response = await mcp({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(response.status).toBe(200);
    expect(response.headers.get("MCP-Protocol-Version")).toBe("2025-06-18");
    const body = await response.json() as { result?: { protocolVersion?: string; serverInfo?: { name?: string } } };
    expect(body.result?.protocolVersion).toBe("2025-06-18");
    expect(body.result?.serverInfo?.name).toBe("donate-by-mail-operations");
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

  it("exposes only bounded coworker tools", async () => {
    const response = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const body = await response.json() as { result?: { tools?: Array<{ name: string; outputSchema?: unknown; securitySchemes?: unknown }> } };
    const names = body.result?.tools?.map((tool) => tool.name) ?? [];

    expect(names).toContain("authorize_support_message");
    expect(names).toContain("record_outbound_message");
    expect(names).toContain("get_donation_support_snapshot");
    expect(names).toContain("create_article_draft");
    expect(names).toContain("schedule_article_publication");
    expect(names).toContain("publish_article");
    expect(names).not.toContain("arbitrary_database_query");
    expect(names).not.toContain("execute_disbursement");
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
    const body = await response.json() as { result?: { tools?: Array<{ name: string }> } };
    const names = body.result?.tools?.map((tool) => tool.name) ?? [];

    expect(names).toEqual(expect.arrayContaining([
      "list_articles", "get_article", "create_article_draft",
      "update_article_content", "schedule_article_publication", "publish_article",
    ]));
    expect(names).not.toContain("find_donations");
    expect(names).not.toContain("authorize_support_message");
    expect(names).not.toContain("evaluate_semantic_command");

    const createTool = body.result?.tools?.find((tool) => tool.name === "create_article_draft") as
      | { inputSchema?: { properties?: { contentBlocks?: { items?: unknown } } }; outputSchema?: unknown; securitySchemes?: unknown }
      | undefined;
    expect(createTool?.inputSchema?.properties?.contentBlocks?.items).toBeTruthy();
    expect(createTool?.outputSchema).toBeTruthy();
    expect(createTool?.securitySchemes).toEqual([{ type: "oauth2", scopes: [] }]);
  });
});

afterAll(() => {
  globalThis.fetch = realFetch;
});
