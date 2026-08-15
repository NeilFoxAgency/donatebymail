import { describe, expect, it, vi } from "vitest";
// @ts-expect-error TypeScript's bundler resolver does not load declarations for imported .mjs scripts.
import { checkAgentConnectors } from "../scripts/agent-smoke.mjs";

const operationsTools = [
  "support_capabilities", "find_donations", "get_donation_support_snapshot", "get_partner_support_snapshot", "get_operations_overview",
  "record_inbound_message", "authorize_support_message", "record_outbound_message", "record_message_failure", "create_partner_lead",
  "set_communication_thread_status", "evaluate_semantic_command",
];
const articleTools = ["list_articles", "get_article", "create_article_draft", "update_article_content", "schedule_article_publication", "publish_article"];
function toolRecord(name: string) {
  const writeTool = [
    "record_inbound_message", "authorize_support_message", "record_outbound_message",
    "record_message_failure", "create_partner_lead", "set_communication_thread_status",
    "evaluate_semantic_command", "create_article_draft", "update_article_content",
    "schedule_article_publication", "publish_article",
  ].includes(name);
  const consequentialTool = ["authorize_support_message", "evaluate_semantic_command", "schedule_article_publication", "publish_article"].includes(name);
  return {
    name,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: ["create_article_draft", "update_article_content"].includes(name)
        ? { contentBlocks: { items: { type: "object" } } }
        : name === "record_outbound_message"
          ? { senderIdentity: { pattern: "^[A-Za-z0-9._%+-]+@donatebymail\\.org$" } }
          : {},
    },
    ...(writeTool ? { outputSchema: { type: "object" } } : {}),
    annotations: { readOnlyHint: !writeTool, destructiveHint: consequentialTool, idempotentHint: true, openWorldHint: false },
  };
}

function response(body: unknown, status = 200, overrides: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
      "MCP-Protocol-Version": "2025-06-18",
      "referrer-policy": "no-referrer",
      "strict-transport-security": "max-age=31536000; includeSubDomains",
      "x-dbm-application-contract-version": "20260808144611",
      "x-dbm-agent-contract-version": "20260808150002",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "x-robots-tag": "noindex, nofollow, noarchive",
      ...overrides,
    },
  });
}

describe("agent connector smoke", () => {
  it("checks both connector identities and their separated tool surfaces", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("http://")) {
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).has("authorization")).toBe(false);
        expect(new Headers(init?.headers).get("accept")).toBe("application/json, text/event-stream");
        return new Response(null, { status: 308, headers: { location: url.replace(/^http:/, "https:") } });
      }
      expect(new Headers(init?.headers).get("accept")).toBe("application/json, text/event-stream");
      const article = url.includes("mcp-connector-beta");
      const initialize = JSON.parse(String(init?.body)).method === "initialize";
      const serverName = article ? "donate-by-mail-article-publisher" : "donate-by-mail-operations";
      if (initialize) {
        return response({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", serverInfo: { name: serverName } } });
      }
      if (JSON.parse(String(init?.body)).method === "tools/call") {
        return response({ jsonrpc: "2.0", id: 5, result: { content: [{ type: "text", text: "{}" }], structuredContent: {} } });
      }
      return response({ jsonrpc: "2.0", id: 2, result: { tools: (article ? articleTools : operationsTools).map(toolRecord) } });
    });
    await expect(checkAgentConnectors({ operationsToken: "o".repeat(16), articleToken: "a".repeat(16), fetchImpl })).resolves.toMatchObject({
      operations: { toolCount: operationsTools.length }, article: { toolCount: articleTools.length },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(10);
  });

  it("fails closed for missing or weak credentials", async () => {
    await expect(checkAgentConnectors({ operationsToken: "short", articleToken: "a".repeat(16), fetchImpl: vi.fn() })).rejects.toThrow(/AGENT_API_KEY/);
    await expect(checkAgentConnectors({ operationsToken: "o".repeat(16), articleToken: "a".repeat(8), fetchImpl: vi.fn() })).rejects.toThrow(/MCP_ARTICLE_BEARER_TOKEN/);
  });

  it("rejects an article connector that exposes operations tools", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const article = String(input).includes("mcp-connector-beta");
      if (String(input).startsWith("http://")) return new Response(null, { status: 308, headers: { location: String(input).replace(/^http:/, "https:") } });
      const request = JSON.parse(String(init?.body));
      const serverName = article ? "donate-by-mail-article-publisher" : "donate-by-mail-operations";
      if (request.method === "initialize") return response({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: serverName } } });
      if (request.method === "tools/call") return response({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "{}" }], structuredContent: {} } });
      return response({ jsonrpc: "2.0", id: request.id, result: { tools: (article ? [toolRecord("support_capabilities")] : operationsTools.map(toolRecord)) } });
    });
    await expect(checkAgentConnectors({ operationsToken: "o".repeat(16), articleToken: "a".repeat(16), fetchImpl })).rejects.toThrow(/unexpected tool surface|operations tool/);
  });

  it("rejects connector redirects that add URL credentials", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("http://")) return new Response(null, {
        status: 308,
        headers: { location: `https://user:password@${url.slice("http://".length)}` },
      });
      return response({ jsonrpc: "2.0", id: 1, result: {} });
    });
    await expect(checkAgentConnectors({ operationsToken: "o".repeat(16), articleToken: "a".repeat(16), fetchImpl })).rejects.toThrow(/does not redirect/);
  });

  it("rejects method-changing connector redirects", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("http://")) return new Response(null, {
        status: 302,
        headers: { location: url.replace(/^http:/, "https:") },
      });
      return response({ jsonrpc: "2.0", id: 1, result: {} });
    });
    await expect(checkAgentConnectors({ operationsToken: "o".repeat(16), articleToken: "a".repeat(16), fetchImpl })).rejects.toThrow(/does not redirect/);
  });

  it("rejects a connector response from an older agent deployment", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("http:")) return new Response(null, { status: 308, headers: { location: url.replace(/^http:/, "https:") } });
      const request = JSON.parse(String(init?.body));
      const article = url.includes("mcp-connector-beta");
      const serverName = article ? "donate-by-mail-article-publisher" : "donate-by-mail-operations";
      if (request.method === "initialize")
        return response({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: serverName } } }, 200, { "x-dbm-agent-contract-version": "stale" });
      if (request.method === "tools/call") return response({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "{}" }] } }, 200, { "x-dbm-agent-contract-version": "stale" });
      return response({ jsonrpc: "2.0", id: request.id, result: { tools: (article ? articleTools : operationsTools).map(toolRecord) } }, 200, { "x-dbm-agent-contract-version": "stale" });
    });
    await expect(checkAgentConnectors({ operationsToken: "o".repeat(16), articleToken: "a".repeat(16), fetchImpl })).rejects.toThrow(/current agent deployment/);
  });
});
