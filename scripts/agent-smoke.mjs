import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const contractSource = readFileSync(resolve("src/contractVersion.ts"), "utf8");
const REQUIRED_APPLICATION_CONTRACT_VERSION = contractSource.match(/APPLICATION_CONTRACT_VERSION = "([0-9]{14})"/)?.[1];
const REQUIRED_AGENT_CONTRACT_VERSION = contractSource.match(/BETA_AGENT_CONTRACT_VERSION = "([0-9]{14})"/)?.[1];
if (!REQUIRED_APPLICATION_CONTRACT_VERSION || !REQUIRED_AGENT_CONTRACT_VERSION)
  throw new Error("Agent connector contract versions are not configured.");

const OPERATIONS_ORIGIN = "https://mcp-operations-connector-beta.donatebymail.org";
const ARTICLE_ORIGIN = "https://mcp-connector-beta.donatebymail.org";
const PRIVATE_ARTICLE_ORIGIN = "https://mcp-beta.donatebymail.org";
const OAUTH_ARTICLE_ORIGIN = "https://mcp-oauth-beta.donatebymail.org";
const MCP_PATH = "/mcp";
// Streamable HTTP clients must advertise both response forms, even when this
// Worker currently returns one JSON response per request rather than SSE.
const MCP_ACCEPT = "application/json, text/event-stream";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const SUPPORTED_PROTOCOL_VERSIONS = new Set(["2025-11-25", "2025-06-18", "2025-03-26"]);
const REQUIRED_OPERATIONS_TOOLS = [
  "support_capabilities",
  "find_donations",
  "get_donation_support_snapshot",
  "get_partner_support_snapshot",
  "get_operations_overview",
  "record_inbound_message",
  "authorize_support_message",
  "record_outbound_message",
  "record_message_failure",
  "create_partner_lead",
  "set_communication_thread_status",
  "evaluate_semantic_command",
];
const ARTICLE_TOOLS = [
  "list_articles",
  "get_article",
  "create_article_draft",
  "update_article_content",
  "schedule_article_publication",
  "publish_article",
];

async function fetchWithTimeout(fetchImpl, input, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("agent_smoke_timeout"), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(input, { redirect: "manual", ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function boundedText(response) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_RESPONSE_BYTES)
      throw new Error("response exceeded the agent smoke size limit");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES)
      throw new Error("response exceeded the agent smoke size limit");
    return text;
  }
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error("response exceeded the agent smoke size limit");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel(error instanceof Error ? error.message : "response_read_failed").catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function assertToken(token, name) {
  if (typeof token !== "string" || token.length < 16 || token.length > 8_192)
    throw new Error(`${name} is required and must be 16-8192 characters.`);
  return token;
}

function assertConnectorResponse(body, response, origin, expectedServerName) {
  const protocolVersion = response.headers.get("MCP-Protocol-Version");
  if (!SUPPORTED_PROTOCOL_VERSIONS.has(protocolVersion || ""))
    throw new Error(`${origin}${MCP_PATH} returned an unsupported MCP protocol version.`);
  const contentType = response.headers.get("content-type") || "";
  if (response.status !== 200 || contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json")
    throw new Error(`${origin}${MCP_PATH} returned an unexpected MCP response.`);
  if (!(response.headers.get("cache-control") || "").toLowerCase().includes("no-store")
    || !(response.headers.get("x-robots-tag") || "").toLowerCase().includes("noindex")
    || response.headers.get("x-content-type-options")?.toLowerCase() !== "nosniff"
    || response.headers.get("x-frame-options")?.toUpperCase() !== "DENY"
    || !/^max-age=31536000;\s*includeSubDomains$/i.test((response.headers.get("strict-transport-security") || "").trim()))
    throw new Error(`${origin}${MCP_PATH} returned incomplete connector security headers.`);
  if (response.headers.get("x-dbm-application-contract-version") !== REQUIRED_APPLICATION_CONTRACT_VERSION
    || response.headers.get("x-dbm-agent-contract-version") !== REQUIRED_AGENT_CONTRACT_VERSION)
    throw new Error(`${origin}${MCP_PATH} did not come from the current agent deployment.`);
  if (!body || body.jsonrpc !== "2.0" || body.error || !body.result)
    throw new Error(`${origin}${MCP_PATH} returned an invalid MCP result.`);
  if (expectedServerName && body.result.serverInfo?.name !== expectedServerName)
    throw new Error(`${origin}${MCP_PATH} returned the wrong connector identity.`);
}

async function mcpRequest({ fetchImpl, origin, token, id, method, params, expectedServerName }) {
  const response = await fetchWithTimeout(fetchImpl, `${origin}${MCP_PATH}`, {
    method: "POST",
    headers: {
      accept: MCP_ACCEPT,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "MCP-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }),
  });
  const raw = await boundedText(response);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(`${origin}${MCP_PATH} returned invalid JSON.`);
  }
  assertConnectorResponse(body, response, origin, expectedServerName);
  return body;
}

async function mcpToolCall({ fetchImpl, origin, token, id, name, arguments: toolArguments = {} }) {
  const body = await mcpRequest({
    fetchImpl,
    origin,
    token,
    id,
    method: "tools/call",
    params: { name, arguments: toolArguments },
  });
  const result = body.result;
  if (!result || result.isError === true || !Array.isArray(result.content)
    || result.content.length < 1 || result.content.length > 16
    || result.content.some((item) => !item || item.type !== "text" || typeof item.text !== "string"))
    throw new Error(`${origin}${MCP_PATH} rejected the safe ${name} read operation.`);
  return body;
}

function toolRecords(body, origin) {
  const tools = body.result?.tools;
  if (!Array.isArray(tools) || tools.length < 1 || tools.length > 64)
    throw new Error(`${origin}${MCP_PATH} returned an invalid tool list.`);
  const names = tools.map((tool) => tool?.name).filter((name) => typeof name === "string");
  if (names.length !== tools.length || new Set(names).size !== names.length)
    throw new Error(`${origin}${MCP_PATH} returned duplicate or malformed tool names.`);
  return tools;
}

function toolNames(body, origin) {
  return toolRecords(body, origin).map((tool) => tool.name);
}

function toolByName(body, origin, name) {
  const tool = toolRecords(body, origin).find((candidate) => candidate.name === name);
  if (!tool || typeof tool.inputSchema !== "object" || !tool.inputSchema || Array.isArray(tool.inputSchema))
    throw new Error(`${origin}${MCP_PATH} returned an invalid schema for ${name}.`);
  return tool;
}

async function assertHttpsConnector(fetchImpl, origin, path = MCP_PATH) {
  const httpOrigin = origin.replace(/^https:/, "http:");
  // Probe the same POST transport an MCP client uses. Do not send a bearer
  // credential on the plaintext probe; the request must redirect before any
  // authentication material is needed.
  const response = await fetchWithTimeout(fetchImpl, `${httpOrigin}${path}`, {
    method: "POST",
    headers: { accept: MCP_ACCEPT, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize" }),
  });
  const location = response.headers.get("location");
  let redirect = null;
  try { redirect = location ? new URL(location, httpOrigin) : null; } catch { redirect = null; }
  // MCP uses a POST body. 301/302 are not safe here because clients and
  // intermediaries may rewrite the redirected request as GET. Require a
  // method-preserving redirect before any bearer credential is sent.
  if (![307, 308].includes(response.status)
    || redirect?.origin !== origin || redirect?.pathname !== path
    || redirect?.search || redirect?.hash || redirect?.username || redirect?.password)
    throw new Error(`${origin}${path} does not redirect plaintext HTTP to its HTTPS connector.`);
}

export async function checkAgentConnectors({
  operationsToken,
  articleToken,
  fetchImpl = globalThis.fetch,
} = {}) {
  const operations = assertToken(operationsToken, "AGENT_API_KEY");
  const article = assertToken(articleToken, "MCP_ARTICLE_BEARER_TOKEN");
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable.");
  await assertHttpsConnector(fetchImpl, OPERATIONS_ORIGIN);
  await assertHttpsConnector(fetchImpl, ARTICLE_ORIGIN);
  // These hosts are separate deployment surfaces even though the smoke uses
  // the portal credential for the authenticated contract. Probe their
  // plaintext transport independently so an Access or managed-OAuth route
  // cannot downgrade a POST before authentication is attempted.
  await assertHttpsConnector(fetchImpl, PRIVATE_ARTICLE_ORIGIN, "/mcp/articles");
  await assertHttpsConnector(fetchImpl, OAUTH_ARTICLE_ORIGIN);

  const operationsInitialize = await mcpRequest({
    fetchImpl,
    origin: OPERATIONS_ORIGIN,
    token: operations,
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "donate-by-mail-smoke", version: "1.0.0" } },
    expectedServerName: "donate-by-mail-operations",
  });
  const negotiatedOperationsVersion = operationsInitialize.result.protocolVersion;
  if (!SUPPORTED_PROTOCOL_VERSIONS.has(negotiatedOperationsVersion))
    throw new Error("Operations connector negotiated an unsupported MCP protocol version.");
  const operationsList = await mcpRequest({
    fetchImpl,
    origin: OPERATIONS_ORIGIN,
    token: operations,
    id: 2,
    method: "tools/list",
    expectedServerName: undefined,
  });
  const operationsTools = toolNames(operationsList, OPERATIONS_ORIGIN);
  const expectedOperationsTools = new Set(REQUIRED_OPERATIONS_TOOLS);
  const missingOperationsTools = [...expectedOperationsTools].filter((name) => !operationsTools.includes(name));
  const unexpectedOperationsTools = operationsTools.filter((name) => !expectedOperationsTools.has(name));
  if (missingOperationsTools.length || unexpectedOperationsTools.length)
    throw new Error(`Operations connector tool contract mismatch (missing ${missingOperationsTools.join(",") || "none"}; unexpected ${unexpectedOperationsTools.join(",") || "none"}).`);
  for (const name of expectedOperationsTools) toolByName(operationsList, OPERATIONS_ORIGIN, name);
  for (const name of ["record_inbound_message", "authorize_support_message", "record_outbound_message", "record_message_failure", "create_partner_lead", "set_communication_thread_status", "evaluate_semantic_command"]) {
    if (!toolByName(operationsList, OPERATIONS_ORIGIN, name).outputSchema)
      throw new Error(`Operations connector is missing the output schema for ${name}.`);
  }
  const senderIdentitySchema = toolByName(operationsList, OPERATIONS_ORIGIN, "record_outbound_message")
    .inputSchema?.properties?.senderIdentity;
  if (senderIdentitySchema?.pattern !== "^[A-Za-z0-9._%+-]+@donatebymail\\.org$")
    throw new Error("Operations connector is missing the canonical outbound sender-identity schema.");
  for (const name of ["authorize_support_message", "evaluate_semantic_command"]) {
    if (toolByName(operationsList, OPERATIONS_ORIGIN, name).annotations?.destructiveHint !== true)
      throw new Error(`Operations connector is missing the consequential-action annotation for ${name}.`);
  }
  await mcpToolCall({
    fetchImpl, origin: OPERATIONS_ORIGIN, token: operations, id: 3, name: "support_capabilities",
  });

  const articleInitialize = await mcpRequest({
    fetchImpl,
    origin: ARTICLE_ORIGIN,
    token: article,
    id: 4,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "donate-by-mail-smoke", version: "1.0.0" } },
    expectedServerName: "donate-by-mail-article-publisher",
  });
  const negotiatedArticleVersion = articleInitialize.result.protocolVersion;
  if (!SUPPORTED_PROTOCOL_VERSIONS.has(negotiatedArticleVersion))
    throw new Error("Article connector negotiated an unsupported MCP protocol version.");
  const articleList = await mcpRequest({
    fetchImpl,
    origin: ARTICLE_ORIGIN,
    token: article,
    id: 5,
    method: "tools/list",
  });
  const articleTools = toolNames(articleList, ARTICLE_ORIGIN);
  if (articleTools.length !== ARTICLE_TOOLS.length || ARTICLE_TOOLS.some((name) => !articleTools.includes(name)))
    throw new Error("Article connector exposed an unexpected tool surface.");
  if (articleTools.some((name) => REQUIRED_OPERATIONS_TOOLS.includes(name)))
    throw new Error("Article connector exposed an operations tool.");
  const articleCreate = toolByName(articleList, ARTICLE_ORIGIN, "create_article_draft");
  const articleUpdate = toolByName(articleList, ARTICLE_ORIGIN, "update_article_content");
  const contentBlocks = (tool) => tool.inputSchema?.properties?.contentBlocks;
  if (!contentBlocks(articleCreate)?.items || !contentBlocks(articleUpdate)?.items)
    throw new Error("Article connector did not expose the typed content-block schema.");
  for (const name of ["create_article_draft", "update_article_content", "schedule_article_publication", "publish_article"]) {
    if (!toolByName(articleList, ARTICLE_ORIGIN, name).outputSchema)
      throw new Error(`Article connector is missing the output schema for ${name}.`);
  }
  for (const name of ["schedule_article_publication", "publish_article"]) {
    if (toolByName(articleList, ARTICLE_ORIGIN, name).annotations?.destructiveHint !== true)
      throw new Error(`Article connector is missing the consequential-action annotation for ${name}.`);
  }
  await mcpToolCall({
    fetchImpl, origin: ARTICLE_ORIGIN, token: article, id: 6, name: "list_articles",
  });

  return {
    operations: { origin: OPERATIONS_ORIGIN, protocolVersion: negotiatedOperationsVersion, toolCount: operationsTools.length },
    article: { origin: ARTICLE_ORIGIN, protocolVersion: negotiatedArticleVersion, toolCount: articleTools.length },
  };
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  try {
    const result = await checkAgentConnectors({
      operationsToken: process.env.AGENT_API_KEY,
      articleToken: process.env.MCP_ARTICLE_BEARER_TOKEN,
    });
    console.log(`Agent connector smoke passed: operations (${result.operations.toolCount} tools), article (${result.article.toolCount} tools).`);
  } catch (error) {
    console.error(`Agent connector smoke failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}
