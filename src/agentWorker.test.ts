import { describe, expect, it } from "vitest";
import agentWorker from "./agentWorker";

const env = {
  DEPLOYMENT_ENVIRONMENT: "beta",
  AGENT_API_KEY: "test-agent-key",
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

describe("Donate by Mail agent MCP wrapper", () => {
  it("requires the agent bearer secret", async () => {
    const response = await mcp({ jsonrpc: "2.0", id: 1, method: "initialize" }, "Bearer wrong-key");
    expect(response.status).toBe(401);
  });

  it("accepts a remote MCP origin after bearer authentication", async () => {
    const response = await mcp({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(response.status).toBe(200);
    const body = await response.json() as { result?: { serverInfo?: { name?: string } } };
    expect(body.result?.serverInfo?.name).toBe("donate-by-mail-operations");
  });

  it("exposes only bounded coworker tools", async () => {
    const response = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const body = await response.json() as { result?: { tools?: Array<{ name: string }> } };
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
});
