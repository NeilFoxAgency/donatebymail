import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_ORIGIN = "https://donatebymail.org";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const contractSource = readFileSync(resolve("src/contractVersion.ts"), "utf8");
const REQUIRED_APPLICATION_CONTRACT_VERSION = contractSource.match(/APPLICATION_CONTRACT_VERSION = "([0-9]{14})"/)?.[1];
if (!REQUIRED_APPLICATION_CONTRACT_VERSION) throw new Error("Application contract version is not configured.");

function normalizeOrigin(value) {
  const origin = String(value || DEFAULT_ORIGIN).replace(/\/+$/, "");
  const url = new URL(origin);
  if (url.protocol !== "https:"
    || !new Set(["donatebymail.org", "www.donatebymail.org"]).has(url.hostname)
    || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash)
    throw new Error("Production smoke requires the canonical Donate by Mail HTTPS origin.");
  return url.origin;
}

async function fetchWithTimeout(input, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("production_smoke_timeout"), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { redirect: "manual", ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function boundedText(response) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_RESPONSE_BYTES)
      throw new Error("response exceeded the production smoke size limit");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES)
      throw new Error("response exceeded the production smoke size limit");
    return text;
  }
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error("response exceeded the production smoke size limit");
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

function cspHasSource(policy, source) {
  return policy.split(/\s+/).some((token) => token.replace(/;$/, "") === source);
}

async function jsonEndpoint(origin, path, init = {}) {
  const response = await fetchWithTimeout(`${origin}${path}`, init);
  const contentType = response.headers.get("content-type") || "";
  const raw = await boundedText(response);
  if (contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json")
    throw new Error(`${path} returned ${response.status} ${contentType || "without a content type"}, not JSON.`);
  let body;
  try { body = JSON.parse(raw); } catch { throw new Error(`${path} returned invalid JSON.`); }
  return { response, body };
}

export async function checkProductionEndpoints(originValue = DEFAULT_ORIGIN) {
  const origin = normalizeOrigin(originValue);
  const httpOrigin = origin.replace(/^https:/, "http:");
  const httpResponse = await fetchWithTimeout(`${httpOrigin}/`, { redirect: "manual" });
  const redirectLocation = httpResponse.headers.get("location");
  let redirect = null;
  try { redirect = redirectLocation ? new URL(redirectLocation, httpOrigin) : null; } catch { redirect = null; }
  if (![301, 302, 307, 308].includes(httpResponse.status)
    || redirect?.origin !== origin || redirect?.pathname !== "/"
    || redirect?.search || redirect?.hash || redirect?.username || redirect?.password)
    throw new Error(`HTTP origin does not redirect to the canonical HTTPS origin: HTTP ${httpResponse.status}.`);
  const health = await jsonEndpoint(origin, "/healthz");
  const healthNoStore = (health.response.headers.get("cache-control") || "").toLowerCase().includes("no-store");
  if (health.response.status !== 200 || health.body?.ok !== true || health.body?.environment !== "production" || !healthNoStore)
    throw new Error(`/healthz is not a healthy production Worker response: HTTP ${health.response.status}.`);

  const ready = await jsonEndpoint(origin, "/readyz");
  const readyNoStore = (ready.response.headers.get("cache-control") || "").toLowerCase().includes("no-store");
  if (ready.response.status !== 200 || ready.body?.ok !== true || ready.body?.ready !== true || !readyNoStore
    || ready.body?.applicationContractVersion !== REQUIRED_APPLICATION_CONTRACT_VERSION)
    throw new Error(`/readyz is not ready: HTTP ${ready.response.status} ${JSON.stringify(ready.body)}.`);

  const homepage = await fetchWithTimeout(`${origin}/`);
  const homepageContentType = homepage.headers.get("content-type") || "";
  const homepageBody = await boundedText(homepage);
  const hsts = homepage.headers.get("strict-transport-security") || "";
  const csp = homepage.headers.get("content-security-policy") || "";
  if (homepage.status !== 200 || !homepageContentType.toLowerCase().includes("text/html")
    || homepage.headers.get("x-dbm-application-contract-version") !== REQUIRED_APPLICATION_CONTRACT_VERSION
    || !/^max-age=31536000;\s*includeSubDomains$/i.test(hsts.trim())
    || !csp.includes("default-src 'self'") || !csp.includes("frame-ancestors 'none'")
    || !cspHasSource(csp, "https://www.pledge.to") || !cspHasSource(csp, "https://api.pledge.to")
    || cspHasSource(csp, "https://staging.pledge.to") || cspHasSource(csp, "https://api-staging.pledge.to")
    || homepage.headers.get("x-content-type-options")?.toLowerCase() !== "nosniff"
    || homepage.headers.get("x-frame-options")?.toUpperCase() !== "DENY"
    || homepage.headers.get("referrer-policy")?.toLowerCase() !== "strict-origin-when-cross-origin"
    || homepage.headers.get("cross-origin-resource-policy")?.toLowerCase() !== "same-origin"
    || !homepageBody.toLowerCase().includes("<html"))
    throw new Error("/ did not return the current Worker-served HTML shell.");

  const ads = await fetchWithTimeout(`${origin}/ads.txt`, { redirect: "manual" });
  const adsContentType = ads.headers.get("content-type") || "";
  const adsBody = await boundedText(ads);
  if (ads.status !== 404 || adsContentType.toLowerCase().includes("text/html")
    || !(ads.headers.get("x-robots-tag") || "").toLowerCase().includes("noindex")
    || !(ads.headers.get("cache-control") || "").toLowerCase().includes("no-store") || adsBody.trim() !== "")
    throw new Error("/ads.txt is not explicitly disabled for this non-ad-supported site.");

  const mcpResponse = await fetchWithTimeout(`${origin}/mcp`, {
    method: "POST",
    headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
  });
  const mcpContentType = mcpResponse.headers.get("content-type") || "";
  const mcpRaw = await boundedText(mcpResponse);
  let mcpBody;
  try { mcpBody = mcpRaw ? JSON.parse(mcpRaw) : null; } catch { mcpBody = null; }
  if (mcpResponse.status !== 404 || mcpContentType.split(";", 1)[0].trim().toLowerCase() !== "application/json"
    || mcpBody?.error?.code !== -32003)
    throw new Error(`/mcp is not explicitly disabled in production: HTTP ${mcpResponse.status}.`);

  const agentResponse = await fetchWithTimeout(`${origin}/api/agent/v1/queries`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ kind: "campaign" }),
  });
  const agentContentType = agentResponse.headers.get("content-type") || "";
  const agentRaw = await boundedText(agentResponse);
  let agentBody;
  try { agentBody = agentRaw ? JSON.parse(agentRaw) : null; } catch { agentBody = null; }
  if (agentResponse.status !== 404 || agentContentType.split(";", 1)[0].trim().toLowerCase() !== "application/json"
    || agentBody?.code !== "agent_disabled_in_production")
    throw new Error(`/api/agent/v1/queries is not explicitly disabled in production: HTTP ${agentResponse.status}.`);

  return { origin, health: health.body, ready: ready.body, mcp: mcpBody, agent: agentBody };
}

export async function checkProductionHosts(originValue = DEFAULT_ORIGIN) {
  const origin = normalizeOrigin(originValue);
  const hosts = [origin];
  const hostname = new URL(origin).hostname;
  if (hostname === "donatebymail.org") hosts.push("https://www.donatebymail.org");
  if (hostname === "www.donatebymail.org") hosts.push("https://donatebymail.org");
  const results = [];
  for (const host of [...new Set(hosts)]) results.push(await checkProductionEndpoints(host));
  return results;
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname) {
  try {
    const results = await checkProductionHosts(process.env.PRODUCTION_ORIGIN || DEFAULT_ORIGIN);
    console.log(`Production endpoint smoke passed for ${results.map((result) => result.origin).join(", ")}: Worker health, readiness, and MCP-disabled boundaries are live.`);
  } catch (error) {
    console.error(`Production endpoint smoke failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}
