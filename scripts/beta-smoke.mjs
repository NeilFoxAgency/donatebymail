import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const configuredOrigin = process.env.BETA_ORIGIN || "https://beta.donatebymail.org";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
let origin;
try {
  const parsedOrigin = new URL(configuredOrigin);
  if (parsedOrigin.protocol !== "https:" || parsedOrigin.hostname !== "beta.donatebymail.org" || parsedOrigin.username || parsedOrigin.password)
    throw new Error("BETA_ORIGIN must be exactly https://beta.donatebymail.org.");
  origin = parsedOrigin.origin;
} catch (error) {
  console.error(error instanceof Error ? error.message : "BETA_ORIGIN is invalid.");
  process.exit(2);
}
const contractSource = readFileSync(resolve("src/contractVersion.ts"), "utf8");
const REQUIRED_APPLICATION_CONTRACT_VERSION = contractSource.match(/APPLICATION_CONTRACT_VERSION = "([0-9]{14})"/)?.[1];
const REQUIRED_AGENT_CONTRACT_VERSION = contractSource.match(/BETA_AGENT_CONTRACT_VERSION = "([0-9]{14})"/)?.[1];
if (!REQUIRED_APPLICATION_CONTRACT_VERSION || !REQUIRED_AGENT_CONTRACT_VERSION)
  throw new Error("Agent contract versions are not configured.");
const clientId = process.env.CF_ACCESS_CLIENT_ID;
const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Cloudflare Access service-token environment is required.");
  process.exit(2);
}

async function fetchWithTimeout(input, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("beta_smoke_timeout"), REQUEST_TIMEOUT_MS);
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
      throw new Error("response exceeded the beta smoke size limit");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES)
      throw new Error("response exceeded the beta smoke size limit");
    return text;
  }
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error("response exceeded the beta smoke size limit");
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

const httpOrigin = origin.replace(/^https:/, "http:");
const httpResponse = await fetchWithTimeout(`${httpOrigin}/`, { redirect: "manual" });
const redirectLocation = httpResponse.headers.get("location");
let redirect = null;
try { redirect = redirectLocation ? new URL(redirectLocation, httpOrigin) : null; } catch { redirect = null; }
if (![301, 302, 307, 308].includes(httpResponse.status)
  || redirect?.origin !== origin || redirect?.pathname !== "/"
  || redirect?.search || redirect?.hash || redirect?.username || redirect?.password) {
  console.error(`Beta HTTP origin does not redirect to the canonical HTTPS origin: HTTP ${httpResponse.status}.`);
  process.exit(1);
}

const response = await fetchWithTimeout(origin, { headers: {
  "CF-Access-Client-Id": clientId,
  "CF-Access-Client-Secret": clientSecret,
}});
if (!response.ok) {
  console.error(`Beta smoke failed with HTTP ${response.status}.`);
  process.exit(1);
}
const contentSecurityPolicy = response.headers.get("content-security-policy") || "";
if (response.headers.get("x-dbm-application-contract-version") !== REQUIRED_APPLICATION_CONTRACT_VERSION
  || !contentSecurityPolicy.includes("default-src 'self'")
  || !contentSecurityPolicy.includes("frame-ancestors 'none'")
  || !contentSecurityPolicy.includes("https://staging.pledge.to")
  || !contentSecurityPolicy.includes("https://api-staging.pledge.to")
  || contentSecurityPolicy.includes("https://api.pledge.to")
  || response.headers.get("x-content-type-options")?.toLowerCase() !== "nosniff"
  || response.headers.get("x-frame-options")?.toUpperCase() !== "DENY"
  || response.headers.get("referrer-policy")?.toLowerCase() !== "strict-origin-when-cross-origin"
  || response.headers.get("cross-origin-resource-policy")?.toLowerCase() !== "same-origin"
  || !(await boundedText(response)).includes("Donate by Mail")) {
  console.error("Beta smoke did not receive the expected application.");
  process.exit(1);
}

async function jsonEndpoint(path) {
  const endpoint = await fetchWithTimeout(`${origin}${path}`, { headers: {
    "CF-Access-Client-Id": clientId,
    "CF-Access-Client-Secret": clientSecret,
  }});
  const contentType = endpoint.headers.get("content-type") || "";
  const raw = await boundedText(endpoint);
  if (endpoint.headers.get("x-dbm-application-contract-version") !== REQUIRED_APPLICATION_CONTRACT_VERSION)
    throw new Error(`${path} did not come from the current Worker deployment.`);
  if (contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new Error(`${path} returned ${endpoint.status} ${contentType || "without a content type"}, not JSON.`);
  }
  let body;
  try { body = JSON.parse(raw); } catch { throw new Error(`${path} returned invalid JSON.`); }
  return { response: endpoint, body };
}

try {
  const health = await jsonEndpoint("/healthz");
  const healthNoStore = (health.response.headers.get("cache-control") || "").toLowerCase().includes("no-store");
  if (health.response.status !== 200 || health.body?.ok !== true || health.body?.environment !== "beta" || !healthNoStore)
    throw new Error("/healthz did not return the beta Worker health contract.");
  const ready = await jsonEndpoint("/readyz");
  const readyNoStore = (ready.response.headers.get("cache-control") || "").toLowerCase().includes("no-store");
  if (ready.response.status !== 200 || ready.body?.ok !== true || ready.body?.ready !== true || !readyNoStore
    || ready.body?.applicationContractVersion !== REQUIRED_APPLICATION_CONTRACT_VERSION
    || ready.body?.agentContractVersion !== REQUIRED_AGENT_CONTRACT_VERSION)
    throw new Error(`/readyz is not ready: HTTP ${ready.response.status}.`);
} catch (error) {
  console.error(`Beta readiness smoke failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
}

console.log("Beta Access, Worker health, and agent-contract readiness smoke passed.");
