import { describe, expect, it } from "vitest";
import agentWorker from "./agentWorker";

const env = {
  DEPLOYMENT_ENVIRONMENT: "beta",
  AGENT_API_KEY: "test-agent-key",
  MCP_ARTICLE_BEARER_TOKEN: "test-article-bearer",
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

async function articleMcp(body: Record<string, unknown>, headers: Record<string, string> = { "cf-access-jwt-assertion": "test-access-jwt" }) {
  return agentWorker.fetch(
    new Request("https://mcp-beta.donatebymail.org/mcp/articles", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
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

async function articleDirectOAuth(body: Record<string, unknown>, headers: Record<string, string> = {
  "cf-access-jwt-assertion": "test-access-jwt",
}) {
  return agentWorker.fetch(
    new Request("https://mcp-oauth-beta.donatebymail.org/mcp", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
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

  it("accepts only the dedicated bearer on the portal upstream hostname", async () => {
    const denied = await articlePortalUpstream({ jsonrpc: "2.0", id: 31, method: "initialize" }, "Bearer wrong-article-token");
    expect(denied.status).toBe(401);
    const allowed = await articlePortalUpstream({ jsonrpc: "2.0", id: 32, method: "initialize" });
    expect(allowed.status).toBe(200);
    const body = await allowed.json() as { result?: { serverInfo?: { name?: string } } };
    expect(body.result?.serverInfo?.name).toBe("donate-by-mail-article-publisher");
  });

  it("accepts the validated bearer forwarded by the managed OAuth hostname", async () => {
    const denied = await articleDirectOAuth({ jsonrpc: "2.0", id: 33, method: "initialize" }, {});
    expect(denied.status).toBe(401);
    const allowed = await articleDirectOAuth({ jsonrpc: "2.0", id: 34, method: "initialize" }, {
      authorization: "Bearer access-validated-by-cloudflare",
    });
    expect(allowed.status).toBe(200);
    const body = await allowed.json() as { result?: { serverInfo?: { name?: string } } };
    expect(body.result?.serverInfo?.name).toBe("donate-by-mail-article-publisher");
  });

  it("exposes only editorial tools on the article connector", async () => {
    const response = await articleMcp({ jsonrpc: "2.0", id: 4, method: "tools/list" }, {
      "cf-access-jwt-assertion": "test-access-jwt",
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
