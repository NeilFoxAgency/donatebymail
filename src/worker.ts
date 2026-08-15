import {
  buildRedactedAdministratorNotification,
  buildDonorConfirmation,
  donorFullName,
  validateDonationSubmission,
  type DonationSubmission,
} from "./submission";
import type { SelectedCharity } from "./pledge";
import {
  claimUrl,
  createClaimToken,
  createTrackingToken,
  trackingUrl,
  verifyTrackingToken,
  verifyClaimToken,
} from "./gen2/tracking";
import { createClient } from "@supabase/supabase-js";
import { clearSessionCookie, constantTimeEqual, cookieValue, openSession, sealSession, sessionCookie, SESSION_MAX_AGE_SECONDS, type BffSession } from "./gen2/bffSession";
import { isRiskLevel, isSemanticCommand, RISK_LEVELS } from "./gen2/commandRegistry";
import { canonicalAuthorizationInput } from "./gen2/authorizationFingerprint";
import { safeJsonLdText } from "./gen2/jsonLd";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, sanitizeImageUpload } from "./gen2/imageSanitizer";
import { APPLICATION_CONTRACT_VERSION, BETA_AGENT_CONTRACT_VERSION } from "./contractVersion";
import QRCode from "qrcode";

type BrevoRecipient = { email: string; name?: string };

type WorkerEnv = Omit<Env, "DEPLOYMENT_ENVIRONMENT"> & {
  PLEDGE_API_KEY?: string;
  DEPLOYMENT_ENVIRONMENT?: "production" | "beta";
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_HOSTNAMES?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  DONATION_TRACKING_SECRET?: string;
  AGENT_API_KEY?: string;
  MCP_ARTICLE_BEARER_TOKEN?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUDIENCE?: string;
  BFF_SESSION_SECRET?: string;
  /** Test-only override for a deterministic local Brevo-compatible server. */
  BREVO_API_URL?: string;
};

type PersistedDonation = {
  created: boolean;
  donationId: string;
  publicId: string;
  createdAt: string;
  outboxEventId: string | null;
};
type CanonicalDonationCharity = Pick<SelectedCharity, "pledgeId" | "name"> & { ein?: string };

type TrackingMaterial = { donationId: string; trackingNonce: string; claimNonce?: string };
type SupabaseFactor = { id: string; factor_type?: string; status?: string; friendly_name?: string };
type SupabaseUser = { id: string; email?: string; factors?: SupabaseFactor[] };
export type AuthTokenResponse = { access_token: string; refresh_token: string; expires_in: number };
export type StaffRole = "staff" | "admin";
type StaffUser = SupabaseUser & { role: StaffRole };
type NotificationPayload = {
  donationId: string;
  publicId: string;
  status: string;
  createdAt: string;
  trackingNonce: string;
  claimNonce: string;
  charityName: string;
  charityPledgeId: string;
  donor: DonationSubmission["donor"];
  devices: DonationSubmission["devices"];
};

type BrevoMessage = {
  to: BrevoRecipient[];
  subject: string;
  textContent: string;
  htmlContent: string;
  tag: string;
  idempotencyKey: string;
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

// Logical row limits protect the database contract; these byte ceilings also
// protect the Worker if a provider, proxy, or malformed response ignores that
// contract before JSON parsing begins.
const MAX_RPC_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_SMALL_PROVIDER_RESPONSE_BYTES = 512 * 1024;
const MAX_HTML_RESPONSE_BYTES = 1 * 1024 * 1024;
const MAX_LEGACY_AGENT_TOOL_RESULT_BYTES = 2 * 1024 * 1024;
// This is the repository's known beta/test project. Production must never
// become an accidental alias for the synthetic-data database while a separate
// production project is being provisioned.
const KNOWN_BETA_SUPABASE_HOST = "ccgvxlpvljydbvxnzhjp.supabase.co";

const requestSessions = new WeakMap<Request, BffSession>();
const refreshedCookies = new WeakMap<Request, string>();
const anonymousCookies = new WeakMap<Request, string>();
const PENDING_CLAIM_COOKIE = "__Host-dbm_pending_claim";
const ANONYMOUS_COOKIE = "__Host-dbm_anon";
const REST_AGENT_IDENTITY = "workspace-agent-beta";
const REQUIRED_APPLICATION_CONTRACT_VERSION = APPLICATION_CONTRACT_VERSION;
// This is the database contract required by the deployed operations MCP. A
// beta Worker must not advertise readiness when the hosted database is still
// on an older migration head that lacks the current authorization guards.
const REQUIRED_BETA_AGENT_CONTRACT_VERSION = BETA_AGENT_CONTRACT_VERSION;
const PUBLIC_ASSET_PATH = /^\/api\/(?:campaign-assets|nonprofit-assets)\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function pendingClaimCookie(value: string, maxAge = 1200): string {
  return `${PENDING_CLAIM_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function anonymousSessionKey(request: Request, env: WorkerEnv): Promise<string> {
  if (!env.DONATION_TRACKING_SECRET) throw new Error("anonymous_session_unavailable");
  const raw = request.headers.get("cookie")?.split(";").map((item) => item.trim())
    .find((item) => item.startsWith(`${ANONYMOUS_COOKIE}=`))?.slice(ANONYMOUS_COOKIE.length + 1);
  let decoded = "";
  try {
    decoded = raw ? decodeURIComponent(raw) : "";
  } catch {
    // Treat a malformed attacker-controlled cookie as an anonymous miss and
    // issue a fresh signed nonce instead of turning an analytics/application
    // request into a platform error.
    decoded = "";
  }
  const [candidateNonce, candidateSignature] = decoded.split(".");
  let nonce = "";
  if (/^[a-f0-9]{32}$/.test(candidateNonce || "") && /^[a-f0-9]{64}$/.test(candidateSignature || "")) {
    const expected = await hmacHex(env.DONATION_TRACKING_SECRET, `anonymous:${candidateNonce}`);
    if (constantTimeEqual(candidateSignature, expected)) nonce = candidateNonce;
  }
  if (!nonce) {
    nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const signature = await hmacHex(env.DONATION_TRACKING_SECRET, `anonymous:${nonce}`);
    anonymousCookies.set(request, `${ANONYMOUS_COOKIE}=${nonce}.${signature}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
  }
  const day = new Date().toISOString().slice(0, 10);
  return sha256Hex(`${env.DONATION_TRACKING_SECRET}:anonymous:${nonce}:${day}`);
}

class PkceStorage {
  values: Record<string, string>;
  constructor(values: Record<string, string> = {}) { this.values = { ...values }; }
  getItem(key: string) { return Promise.resolve(this.values[key] ?? null); }
  setItem(key: string, value: string) { this.values[key] = value; return Promise.resolve(); }
  removeItem(key: string) { delete this.values[key]; return Promise.resolve(); }
}

export type AuthDestination = "/staff" | "/account" | "/partner";

export function isValidAuthDestination(value: unknown): value is AuthDestination {
  return value === "/staff" || value === "/account" || value === "/partner";
}

/** Bound the provider PKCE cache restored from the service-only login-attempt row. */
export function boundedPkceStorage(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 32) return null;
  const result: Record<string, string> = {};
  let totalBytes = 0;
  for (const [key, candidate] of entries) {
    if (!/^[A-Za-z0-9._:-]{1,256}$/.test(key) || typeof candidate !== "string" || candidate.length > 4_096)
      return null;
    totalBytes += new TextEncoder().encode(key).byteLength + new TextEncoder().encode(candidate).byteLength;
    if (totalBytes > 32 * 1024) return null;
    result[key] = candidate;
  }
  return result;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function isJsonContentType(value: string | null): boolean {
  return value?.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

/** Preserve client errors while making provider/database outages retryable. */
export function requestFailureStatus(error: unknown): 400 | 503 {
  const upstreamStatus = error instanceof Error && "upstreamStatus" in error
    && typeof error.upstreamStatus === "number" ? error.upstreamStatus : 0;
  const transientMessage = error instanceof Error
    && /fetch failed|network|timeout|temporarily unavailable|service unavailable|response_read_timeout/i.test(error.message);
  return transientMessage || upstreamStatus >= 500 || upstreamStatus === 401 || upstreamStatus === 403 || upstreamStatus === 429
    ? 503 : 400;
}

function requestFailure(error: unknown, message: string): Response {
  const status = requestFailureStatus(error);
  return json({ ok: false, ...(status === 503 ? { code: "operational_data_unavailable" } : {}), message }, status);
}

function operationalDataConfigured(env: WorkerEnv): boolean {
  return Boolean(
    supabaseBaseUrl(env) && env.SUPABASE_PUBLISHABLE_KEY &&
      env.SUPABASE_SECRET_KEY && typeof env.DONATION_TRACKING_SECRET === "string" &&
      env.DONATION_TRACKING_SECRET.trim().length >= 32 &&
      typeof env.BFF_SESSION_SECRET === "string" && env.BFF_SESSION_SECRET.trim().length >= 32,
  );
}

/**
 * Normalize the Supabase origin before any key-bearing request. Production and
 * hosted beta must use HTTPS; plaintext is permitted only for the loopback
 * endpoint used by local integration tests.
 */
export function supabaseBaseUrl(env: Pick<WorkerEnv, "SUPABASE_URL" | "DEPLOYMENT_ENVIRONMENT">): string | null {
  const raw = env.SUPABASE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    const localHttp = env.DEPLOYMENT_ENVIRONMENT === "beta" && localHost && url.protocol === "http:";
    const hostedSupabase = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.supabase\.co$/i.test(url.hostname);
    // SUPABASE_URL is an origin, not a reverse-proxy base path. Allowing an
    // attacker-controlled path would make every service-key RPC target a
    // different upstream route and can hide a misbound project behind a
    // superficially valid hostname.
    const hasUnexpectedPath = url.pathname.replace(/\/+$/, "") !== "";
    if ((!localHttp && (!hostedSupabase || url.protocol !== "https:" || Boolean(url.port)))
      || hasUnexpectedPath
      || url.username || url.password || url.search || url.hash)
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The integration harness uses synthetic beta data against a loopback
 * Supabase instance. Keep its HTTP requests available without weakening the
 * hosted beta transport boundary.
 */
const LOCAL_BETA_HARNESS_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "integration.test"]);

export function isLocalBetaHarness(
  env: Pick<WorkerEnv, "SUPABASE_URL" | "DEPLOYMENT_ENVIRONMENT">,
  requestHostname?: string,
): boolean {
  if (env.DEPLOYMENT_ENVIRONMENT !== "beta" || !env.SUPABASE_URL) return false;
  if (requestHostname && !LOCAL_BETA_HARNESS_HOSTS.has(requestHostname.toLowerCase())) return false;
  try {
    const url = new URL(env.SUPABASE_URL);
    return url.protocol === "http:"
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

export function applicationOrigin(environment: WorkerEnv["DEPLOYMENT_ENVIRONMENT"]): string {
  return environment === "beta" ? "https://beta.donatebymail.org" : "https://donatebymail.org";
}

const DEFAULT_BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

/** Keep sandbox credentials and beneficiary data on Pledge's sandbox API. */
export function pledgeApiOrigin(environment: WorkerEnv["DEPLOYMENT_ENVIRONMENT"]): string {
  return environment === "beta" ? "https://api-staging.pledge.to" : "https://api.pledge.to";
}

/**
 * Keep the Brevo API key and message payload on the intended provider origin.
 * A loopback HTTP endpoint is permitted only for the local beta integration
 * harness; hosted beta and production must use Brevo's canonical HTTPS API.
 */
export function brevoApiUrl(env: Pick<WorkerEnv, "BREVO_API_URL" | "DEPLOYMENT_ENVIRONMENT">): string | null {
  const raw = env.BREVO_API_URL?.trim();
  if (!raw) return DEFAULT_BREVO_API_URL;
  try {
    const url = new URL(raw);
    const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    const localBeta = env.DEPLOYMENT_ENVIRONMENT === "beta" && localHost && url.protocol === "http:";
    const canonical = url.protocol === "https:" && url.hostname === "api.brevo.com"
      && url.pathname === "/v3/smtp/email" && !url.port;
    if ((!canonical && !localBeta) || url.username || url.password || url.search || url.hash)
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function productionConfigurationErrors(env: WorkerEnv): string[] {
  const required: Array<keyof WorkerEnv> = [
    "BREVO_API_KEY",
    "PLEDGE_API_KEY",
    "BREVO_SENDER_EMAIL",
    "BREVO_SENDER_NAME",
    "ADMIN_NOTIFICATION_TO",
    "REPLY_TO_EMAIL",
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "DONATION_TRACKING_SECRET",
    "BFF_SESSION_SECRET",
  ];
  if (env.DEPLOYMENT_ENVIRONMENT === "beta") {
    required.push("AGENT_API_KEY", "MCP_ARTICLE_BEARER_TOKEN", "CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUDIENCE");
  } else {
    required.push("TURNSTILE_SECRET_KEY");
  }
  const errors = required.filter((name) => typeof env[name] !== "string" || !env[name].trim());
  if (!errors.includes("BFF_SESSION_SECRET") && (env.BFF_SESSION_SECRET?.trim().length || 0) < 32)
    errors.push("BFF_SESSION_SECRET");
  if (!errors.includes("DONATION_TRACKING_SECRET") && (env.DONATION_TRACKING_SECRET?.trim().length || 0) < 32)
    errors.push("DONATION_TRACKING_SECRET");
  const providerSecrets = ["BREVO_API_KEY", "PLEDGE_API_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"] as const;
  for (const name of providerSecrets) {
    if (!errors.includes(name) && (env[name]?.trim().length || 0) < 8) errors.push(name);
  }
  if (env.DEPLOYMENT_ENVIRONMENT !== "beta" && !errors.includes("TURNSTILE_SECRET_KEY")
    && (env.TURNSTILE_SECRET_KEY?.trim().length || 0) < 8) errors.push("TURNSTILE_SECRET_KEY");
  if (env.DEPLOYMENT_ENVIRONMENT === "beta") {
    if (!errors.includes("AGENT_API_KEY") && (env.AGENT_API_KEY?.trim().length || 0) < 16) errors.push("AGENT_API_KEY");
    if (!errors.includes("MCP_ARTICLE_BEARER_TOKEN") && (env.MCP_ARTICLE_BEARER_TOKEN?.trim().length || 0) < 16)
      errors.push("MCP_ARTICLE_BEARER_TOKEN");
    if (!errors.includes("CF_ACCESS_TEAM_DOMAIN") && !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/i.test(env.CF_ACCESS_TEAM_DOMAIN || ""))
      errors.push("CF_ACCESS_TEAM_DOMAIN");
    if (!errors.includes("CF_ACCESS_AUDIENCE") && (env.CF_ACCESS_AUDIENCE?.trim().length || 0) < 16)
      errors.push("CF_ACCESS_AUDIENCE");
  }
  if (!errors.includes("SUPABASE_URL") && !supabaseBaseUrl(env)) errors.push("SUPABASE_URL");
  if (env.DEPLOYMENT_ENVIRONMENT !== "beta" && !errors.includes("SUPABASE_URL")) {
    try {
      if (new URL(env.SUPABASE_URL!).hostname.toLowerCase() === KNOWN_BETA_SUPABASE_HOST)
        errors.push("SUPABASE_URL");
    } catch { /* The generic URL validation above reports malformed values. */ }
  }
  if (env.BREVO_API_URL && !brevoApiUrl(env)) errors.push("BREVO_API_URL");
  if (env.DEPLOYMENT_ENVIRONMENT !== "beta" && env.TURNSTILE_HOSTNAMES) {
    const configuredHostnames = env.TURNSTILE_HOSTNAMES.split(",").map((hostname) => hostname.trim().toLowerCase()).filter(Boolean);
    if (!configuredHostnames.length || configuredHostnames.some((hostname) => !DEFAULT_TURNSTILE_HOSTNAMES.has(hostname)))
      errors.push("TURNSTILE_HOSTNAMES");
  }
  const mailAddress = (value: unknown) => typeof value === "string"
    && /^[^\s@]+@donatebymail\.org$/i.test(value.trim())
    && value.length <= 320;
  for (const name of ["BREVO_SENDER_EMAIL", "ADMIN_NOTIFICATION_TO", "REPLY_TO_EMAIL"] as const) {
    if (!errors.includes(name) && !mailAddress(env[name])) errors.push(name);
  }
  if (!errors.includes("BREVO_SENDER_NAME")
    && (typeof env.BREVO_SENDER_NAME !== "string" || env.BREVO_SENDER_NAME.trim().length < 1
      || env.BREVO_SENDER_NAME.length > 160 || /[\u0000-\u001f\u007f]/.test(env.BREVO_SENDER_NAME)))
    errors.push("BREVO_SENDER_NAME");
  return errors;
}

/** Bound every provider call so a stalled dependency cannot consume a Worker invocation indefinitely. */
async function fetchWithTimeout(
  input: Request | string | URL,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("upstream_timeout"), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function supabaseRpc<T>(
  env: WorkerEnv,
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  const baseUrl = supabaseBaseUrl(env);
  if (!baseUrl || !env.SUPABASE_SECRET_KEY)
    throw new Error("Data service is not configured.");
  const headers: Record<string, string> = {
    apikey: env.SUPABASE_SECRET_KEY,
    "content-type": "application/json",
    accept: "application/json",
    "content-profile": "api",
    "accept-profile": "api",
  };
  const correlationId = crypto.randomUUID();
  // Legacy service-role JWTs require Authorization; modern sb_secret keys must
  // be sent only as apikey so the Supabase gateway assigns the service role.
  if (env.SUPABASE_SECRET_KEY.startsWith("eyJ"))
    headers.authorization = `Bearer ${env.SUPABASE_SECRET_KEY}`;
  const response = await fetchWithTimeout(
    `${baseUrl}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    console.error(JSON.stringify({
      event: "supabase_rpc_failed", functionName, status: response.status,
      correlationId,
    }));
    const failure = new Error("The data service rejected the request.");
    Object.assign(failure, { upstreamStatus: response.status });
    throw failure;
  }
  return readBoundedResponseJson<T>(response, MAX_RPC_RESPONSE_BYTES);
}

const CAMPAIGN_ASSET_MAX_BYTES = MAX_IMAGE_BYTES;
const CAMPAIGN_ASSET_MIME_TYPES = ALLOWED_IMAGE_TYPES;
const MAX_RESPONSE_READ_MS = 20_000;
const MAX_REQUEST_READ_MS = 20_000;

async function readChunkWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error("response_read_timeout"));
    }, timeoutMs);
    reader.read().then((result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }, (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

export function storageObjectPath(path: string): string {
  if (typeof path !== "string" || path.length < 3 || path.length > 500
    || path.startsWith("/") || path.endsWith("/") || path.includes("\\"))
    throw new Error("unsafe_storage_path");
  const segments = path.split("/");
  if (segments.length < 2 || segments.some((segment) => !segment || segment === "." || segment === ".."
    || /[\u0000-\u001f\u007f]/.test(segment)))
    throw new Error("unsafe_storage_path");
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}

function supabaseSecretHeaders(env: WorkerEnv, extra: Record<string, string> = {}): Record<string, string> {
  if (!env.SUPABASE_SECRET_KEY) throw new Error("Storage is not configured.");
  const headers: Record<string, string> = { apikey: env.SUPABASE_SECRET_KEY, ...extra };
  if (env.SUPABASE_SECRET_KEY.startsWith("eyJ")) headers.authorization = `Bearer ${env.SUPABASE_SECRET_KEY}`;
  return headers;
}

async function uploadPrivateAsset(env: WorkerEnv, bucket: "campaign-assets" | "partner-assets", path: string, bytes: Uint8Array, mimeType: string): Promise<void> {
  const baseUrl = supabaseBaseUrl(env);
  if (!baseUrl) throw new Error("Storage is not configured.");
  const response = await fetchWithTimeout(`${baseUrl}/storage/v1/object/${bucket}/${storageObjectPath(path)}`, {
    method: "POST",
    headers: supabaseSecretHeaders(env, {
      "cache-control": "3600",
      "content-type": mimeType,
      "x-upsert": "false",
    }),
    body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  });
  if (!response.ok) {
    console.error(JSON.stringify({ event: "campaign_asset_upload_failed", status: response.status }));
    throw new Error("The campaign image could not be uploaded.");
  }
}

async function deletePrivateAssetObject(env: WorkerEnv, bucket: "campaign-assets" | "partner-assets", path: string): Promise<void> {
  const baseUrl = supabaseBaseUrl(env);
  if (!baseUrl) return;
  await fetchWithTimeout(`${baseUrl}/storage/v1/object/${bucket}/${storageObjectPath(path)}`, {
    method: "DELETE",
    headers: supabaseSecretHeaders(env),
  }).catch(() => undefined);
}

async function getPrivateAssetObject(env: WorkerEnv, bucket: "campaign-assets" | "partner-assets", path: string): Promise<Response> {
  const baseUrl = supabaseBaseUrl(env);
  if (!baseUrl) throw new Error("Storage is not configured.");
  return fetchWithTimeout(`${baseUrl}/storage/v1/object/${bucket}/${storageObjectPath(path)}`, {
    headers: supabaseSecretHeaders(env, { accept: "*/*" }),
  });
}

/**
 * Read a storage object without trusting the provider's metadata or allowing
 * an unexpectedly large object to consume the Worker invocation's memory.
 * Uploads are already capped, but this protects every read path against stale
 * or manually altered objects as well.
 */
export async function readBoundedResponseBytes(
  response: Response,
  maximumBytes = MAX_IMAGE_BYTES,
  tooLargeError = "asset_too_large",
  missingBodyError = "asset_body_missing",
): Promise<Uint8Array> {
  if (!response.body) throw new Error(missingBodyError);
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > maximumBytes) {
      await response.body.cancel(tooLargeError);
      throw new Error(tooLargeError);
    }
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  const deadline = Date.now() + MAX_RESPONSE_READ_MS;
  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("response_read_timeout");
      const { done, value } = await readChunkWithTimeout(reader, remaining);
      if (done) break;
      received += value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel(tooLargeError);
        throw new Error(tooLargeError);
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel(error instanceof Error ? error.message : "response_read_failed").catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readBoundedResponseText(
  response: Response,
  maximumBytes = MAX_HTML_RESPONSE_BYTES,
  tooLargeError = "response_too_large",
  missingBodyError = "response_body_missing",
): Promise<string> {
  return new TextDecoder().decode(await readBoundedResponseBytes(response, maximumBytes, tooLargeError, missingBodyError));
}

export async function readBoundedResponseJson<T>(response: Response, maximumBytes = MAX_RPC_RESPONSE_BYTES): Promise<T> {
  try {
    return JSON.parse(await readBoundedResponseText(response, maximumBytes)) as T;
  } catch (error) {
    if (error instanceof Error && (error.message === "response_too_large" || error.message === "response_body_missing"))
      throw error;
    throw new Error("response_json_invalid");
  }
}

async function authenticatedUser(request: Request, env: WorkerEnv, allowMfaPending = false): Promise<SupabaseUser | null> {
  const baseUrl = supabaseBaseUrl(env);
  if (!baseUrl || !env.SUPABASE_PUBLISHABLE_KEY || !env.BFF_SESSION_SECRET)
    return null;
  const sealed = cookieValue(request.headers.get("cookie"));
  if (!sealed) return null;
  let session = await openSession(sealed, env.BFF_SESSION_SECRET);
  if (!session) return null;
  if (session.expiresAt <= Date.now() + 60_000) {
    const refresh = await fetchWithTimeout(`${baseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
    if (!refresh.ok) return null;
    const refreshed = await readBoundedResponseJson<unknown>(refresh, MAX_SMALL_PROVIDER_RESPONSE_BYTES);
    if (!isValidAuthTokenResponse(refreshed)) return null;
    const refreshedExpiresAt = Math.min(
      Date.now() + refreshed.expires_in * 1000,
      session.absoluteExpiresAt - 1_000,
    );
    if (refreshedExpiresAt <= Date.now()) return null;
    session = { ...session, accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token, expiresAt: refreshedExpiresAt };
    refreshedCookies.set(request, sessionCookie(await sealSession(session, env.BFF_SESSION_SECRET)));
  }
  const response = await fetchWithTimeout(`${baseUrl}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${session.accessToken}`,
      accept: "application/json",
    },
  });
  if (!response.ok) return null;
  const user = await readBoundedResponseJson<SupabaseUser>(response, MAX_SMALL_PROVIDER_RESPONSE_BYTES);
  if (!user?.id) return null;
  requestSessions.set(request, session);
  if (session.mfaPending && !allowMfaPending) return null;
  return user;
}

export function accessTokenAssuranceLevel(accessToken: string): "aal1" | "aal2" | null {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - payload.length % 4) % 4);
    const value = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)))) as { aal?: unknown };
    return value.aal === "aal1" || value.aal === "aal2" ? value.aal : null;
  } catch {
    return null;
  }
}

async function userAuthClient(request: Request, env: WorkerEnv, allowMfaPending = false) {
  const user = await authenticatedUser(request, env, allowMfaPending);
  const session = requestSessions.get(request);
  const baseUrl = supabaseBaseUrl(env);
  if (!user || !session || !baseUrl || !env.SUPABASE_PUBLISHABLE_KEY) return null;
  const client = createClient(baseUrl, env.SUPABASE_PUBLISHABLE_KEY, { auth: {
    flowType: "pkce", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
  }});
  const { error } = await client.auth.setSession({ access_token: session.accessToken, refresh_token: session.refreshToken });
  return error ? null : { client, session, user };
}

async function elevatedSessionResponse(
  env: WorkerEnv,
  previous: BffSession,
  tokens: { access_token: string; refresh_token: string; expires_in: number },
  redirect: string,
): Promise<Response> {
  if (!env.BFF_SESSION_SECRET) return json({ ok: false, message: "Secure sign-in is unavailable." }, 503);
  if (!isValidAuthTokenResponse(tokens)) return json({ ok: false, message: "Secure sign-in is temporarily unavailable." }, 503);
  const expiresAt = Math.min(Date.now() + tokens.expires_in * 1000, previous.absoluteExpiresAt - 1_000);
  if (expiresAt <= Date.now()) return json({ ok: false, message: "Secure sign-in has expired. Request a new link." }, 401);
  const next: BffSession = {
    accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
    expiresAt,
    absoluteExpiresAt: previous.absoluteExpiresAt, csrf: bytesToToken(32),
  };
  const response = json({ ok: true, redirect });
  response.headers.append("set-cookie", sessionCookie(await sealSession(next, env.BFF_SESSION_SECRET)));
  return response;
}

/** Keep provider-issued session material from entering the sealed cookie unless
 * its runtime shape and lifetime are both bounded. */
export function isValidAuthTokenResponse(value: unknown): value is AuthTokenResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<AuthTokenResponse>;
  return typeof candidate.access_token === "string" && candidate.access_token.trim().length > 0
    && candidate.access_token.length <= 8_192
    && typeof candidate.refresh_token === "string" && candidate.refresh_token.trim().length > 0
    && candidate.refresh_token.length <= 8_192
    && Number.isSafeInteger(candidate.expires_in)
    && (candidate.expires_in as number) >= 1
    && (candidate.expires_in as number) <= SESSION_MAX_AGE_SECONDS;
}

function csrfAllowed(request: Request): boolean {
  const session = requestSessions.get(request);
  return Boolean(session && browserMutationOriginAllowed(request) && constantTimeEqual(request.headers.get("x-csrf-token"), session.csrf));
}

type PreviewAsset = { storagePath?: string; contentSha256?: string };
type RevisionPreview = { revision?: { heroAsset?: PreviewAsset | null; supportingAsset?: PreviewAsset | null } };

/** Verify the bytes in private Storage at the human approval boundary. */
export async function verifyCampaignRevisionAssets(env: WorkerEnv, preview: RevisionPreview): Promise<void> {
  for (const asset of [preview.revision?.heroAsset, preview.revision?.supportingAsset]) {
    if (!asset) continue;
    if (!asset.storagePath || !asset.contentSha256 || !/^[a-f0-9]{64}$/.test(asset.contentSha256))
      throw new Error("campaign_asset_digest_missing");
    const response = await getPrivateAssetObject(env, "campaign-assets", asset.storagePath);
    if (!response.ok || !response.body) throw new Error("campaign_asset_missing");
    const digest = await sha256BytesHex(await readBoundedResponseBytes(response));
    if (digest !== asset.contentSha256) throw new Error("campaign_asset_digest_mismatch");
  }
}

async function supabaseUser(request: Request, env: WorkerEnv): Promise<StaffUser | null> {
  const user = await authenticatedUser(request, env);
  if (!user) return null;
  const context = await supabaseRpc<{ active?: boolean; role?: string }>(env, "staff_session_context", {
    actor_user_id: user.id,
  });
  if (!context.active || (context.role !== "staff" && context.role !== "admin")) return null;
  const session = requestSessions.get(request);
  if (!session || accessTokenAssuranceLevel(session.accessToken) !== "aal2")
    throw new Error("staff_mfa_required");
  return { ...user, role: context.role };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Brevo accepts UUID-shaped idempotency keys. Deriving one from the durable
 * outbox event and recipient keeps retries for the same recipient stable while
 * keeping donor and administrator deliveries independent.
 */
export async function brevoIdempotencyKey(eventId: string, recipient: string): Promise<string> {
  const hex = await sha256Hex(`donate-by-mail:brevo:${eventId}:${recipient}`);
  const bytes = hex.match(/../g)!.slice(0, 16).map((value) => Number.parseInt(value, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const encoded = bytes.map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${encoded.slice(0, 8)}-${encoded.slice(8, 12)}-${encoded.slice(12, 16)}-${encoded.slice(16, 20)}-${encoded.slice(20)}`;
}

export async function sha256BytesHex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hasValidCampaignImageSignature(mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index]);
  if (mimeType === "image/webp") return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  return false;
}

async function safeSecretEqual(actual: string | null, expected?: string): Promise<boolean> {
  if (!actual || !expected || actual.length < 16 || expected.length < 16
    || actual.length > 8_192 || expected.length > 8_192) return false;
  const [a, b] = await Promise.all([sha256Hex(actual), sha256Hex(expected)]);
  return constantTimeEqual(a, b);
}

async function outboxReceiptExists(env: WorkerEnv, eventId: string, recipient: string): Promise<boolean> {
  return supabaseRpc<boolean>(env, "outbox_handler_receipt_exists", {
    p_event_id: eventId, p_handler_name: recipient,
  });
}

async function recordOutboxReceipt(env: WorkerEnv, eventId: string, recipient: string): Promise<void> {
  await supabaseRpc(env, "record_outbox_handler_receipt", {
    p_event_id: eventId, p_handler_name: recipient,
    p_result_metadata: { provider: "brevo", recipient },
  });
}

async function deliverOutboxRecipient(
  env: WorkerEnv,
  eventId: string,
  recipient: string,
  message: Omit<BrevoMessage, "idempotencyKey">,
): Promise<void> {
  if (await outboxReceiptExists(env, eventId, recipient)) return;
  await sendBrevoEmail(env, { ...message, idempotencyKey: await brevoIdempotencyKey(eventId, recipient) });
  await recordOutboxReceipt(env, eventId, recipient);
}

async function anonymousRateAllowed(request: Request, env: WorkerEnv, action: string, maximum: number, windowSeconds: number): Promise<boolean> {
  if (!env.DONATION_TRACKING_SECRET) return false;
  const address = request.headers.get("cf-connecting-ip") || "unknown";
  const bucket = await sha256Hex(`rate:${env.DONATION_TRACKING_SECRET}:${action}:${address}`);
  return supabaseRpc<boolean>(env, "consume_anonymous_rate_limit", {
    bucket_hash_value: bucket, action_value: action, maximum_requests: maximum, window_seconds: windowSeconds,
  });
}

export async function readJson(request: Request, maximumBytes = 100_000, timeoutMs = MAX_REQUEST_READ_MS): Promise<unknown> {
  if (!isJsonContentType(request.headers.get("content-type")))
    throw new Error("Expected a JSON request.");
  const length = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(length) || length < 0 || length > maximumBytes)
    throw new Error("Request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Expected a JSON request.");
  const chunks: Uint8Array[] = [];
  let received = 0;
  const deadline = Date.now() + timeoutMs;
  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("request_read_timeout");
      const { done, value } = await readChunkWithTimeout(reader, remaining);
      if (done) break;
      received += value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel("Request is too large.");
        throw new Error("Request is too large.");
      }
      chunks.push(value);
    }
  } catch (error) {
    const failure = error instanceof Error && error.message === "response_read_timeout"
      ? new Error("request_read_timeout") : error;
    await reader.cancel(failure instanceof Error ? failure.message : "request_read_failed").catch(() => undefined);
    throw failure;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) return origin === new URL(request.url).origin;
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  // Browser GET requests commonly omit Origin, but a browser that supplies
  // Sec-Fetch-Site must identify the request as same-origin. Otherwise a
  // cross-site page could cause a credentialed read or provider lookup.
  return !fetchSite || fetchSite === "same-origin";
}

export function browserMutationOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) return origin === new URL(request.url).origin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Quote every exported cell and neutralize spreadsheet formula prefixes. */
export function csvCell(value: unknown): string {
  const raw = String(value ?? "");
  const safe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character]!,
  );
}

function textEmailHtml(text: string): string {
  return `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#17324d;max-width:680px;margin:auto"><div style="border-top:6px solid #123b66;padding:24px"><div style="font-size:22px;font-weight:700;margin-bottom:20px">Donate by Mail</div><div>${escapeHtml(text).replace(/\n/g, "<br>")}</div></div></div>`;
}

async function sendBrevoEmail(
  env: WorkerEnv,
  message: BrevoMessage,
): Promise<void> {
  const endpoint = brevoApiUrl(env);
  if (!endpoint) throw new Error("Brevo endpoint is not configured safely.");
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": env.BREVO_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: {
        email: env.BREVO_SENDER_EMAIL,
        name: env.BREVO_SENDER_NAME,
      },
      to: message.to,
      replyTo: {
        email: env.REPLY_TO_EMAIL,
        name: env.BREVO_SENDER_NAME,
      },
      subject: message.subject,
      textContent: message.textContent,
      htmlContent: message.htmlContent,
      tags: [message.tag],
      headers: { "Idempotency-Key": message.idempotencyKey },
    }),
  });

  if (!response.ok) {
    console.error(
      JSON.stringify({
        event: "brevo_send_failed",
        status: response.status,
        tag: message.tag,
      }),
    );
    throw new Error("Brevo rejected the transactional email request.");
  }
}

function statusMessage(payload: NotificationPayload, link: string): string {
  const statusCopy: Record<string, string> = {
    submitted: "Your donation packet has been created.",
    in_transit: "Your donation is marked as in transit.",
    received: "Your package has arrived at Donate by Mail and is awaiting inspection.",
    inspecting: "Your donated devices are being inspected.",
    processing: "Your donated devices are being processed.",
    completed: "Processing for your donated devices is complete.",
    exception: "Your donation needs attention from our team.",
    cancelled: "This donation record has been cancelled.",
  };
  return [
    `Hello ${payload.donor.firstName},`,
    "",
    statusCopy[payload.status] ?? "Your donation status has been updated.",
    `Donation ID: ${payload.publicId}`,
    `Selected charity: ${payload.charityName}`,
    "",
    `View the latest status: ${link}`,
    "",
    "Donate by Mail will never ask for your phone passcode.",
  ].join("\n");
}

async function notificationPayload(
  env: WorkerEnv,
  donationId: string,
): Promise<NotificationPayload> {
  return supabaseRpc<NotificationPayload>(env, "get_donation_notification_payload", {
    candidate_donation_id: donationId,
  });
}

async function deliverDonationNotification(
  env: WorkerEnv,
  eventId: string,
  eventType: string,
  donationId: string,
  origin: string,
): Promise<void> {
  if (!env.DONATION_TRACKING_SECRET) throw new Error("Tracking is not configured.");
  const payload = await notificationPayload(env, donationId);
  const token = await createTrackingToken(
    env.DONATION_TRACKING_SECRET,
    payload.donationId,
    payload.trackingNonce,
  );
  const link = trackingUrl(origin, payload.publicId, token);
  if (eventType === "donation.created") {
    const record: DonationSubmission = {
      id: payload.publicId,
      clientSubmissionKey: "00000000-0000-4000-8000-000000000000",
      createdAt: payload.createdAt,
      donor: payload.donor,
      shippingMethod: "label",
      devices: payload.devices,
      charity: { pledgeId: payload.charityPledgeId, name: payload.charityName },
    };
    const claimToken = await createClaimToken(env.DONATION_TRACKING_SECRET, payload.donationId, payload.claimNonce);
    const donorText = `${buildDonorConfirmation(record)}\n\nTrack this donation securely:\n${link}\n\nClaim it in your donor account (one-time link):\n${claimUrl(origin, payload.publicId, claimToken)}`;
    const administratorText = buildRedactedAdministratorNotification(record, `${origin}/staff`);
    await deliverOutboxRecipient(env, eventId, "donation_donor_confirmation", {
        to: [{ email: payload.donor.email, name: donorFullName(payload.donor) }],
        subject: `Your Donate by Mail packet ${payload.publicId}`,
        textContent: donorText,
        htmlContent: textEmailHtml(donorText),
        tag: "donation-donor-confirmation",
      });
    await deliverOutboxRecipient(env, eventId, "donation_admin_notification", {
        to: [{ email: env.ADMIN_NOTIFICATION_TO, name: "Donate by Mail" }],
        subject: `Phone donation ${payload.publicId} for ${payload.charityName}`,
        textContent: administratorText,
        htmlContent: textEmailHtml(administratorText),
        tag: "donation-admin-notification",
      });
  } else {
    const donorText = statusMessage(payload, link);
    await deliverOutboxRecipient(env, eventId, "donation_status_notification", {
      to: [{ email: payload.donor.email, name: donorFullName(payload.donor) }],
      subject: `Donation status: ${payload.publicId}`,
      textContent: donorText,
      htmlContent: textEmailHtml(donorText),
      tag: "donation-status-update",
    });
  }
}

async function completeInlineOutbox(env: WorkerEnv, eventId: string): Promise<void> {
  await supabaseRpc<boolean>(env, "complete_inline_outbox_event", {
    event_id: eventId,
    handler_name: "donation_notifications",
  });
}

async function deliverPartnerInvitation(
  env: WorkerEnv,
  eventId: string,
  invitationId: string,
  origin: string,
): Promise<void> {
  const payload = await supabaseRpc<{
    invitationId: string;
    email: string;
    organizationName: string;
    loginPath: string;
  } | null>(env, "get_partner_invitation_email_payload", {
    candidate_invitation_id: invitationId,
  });
  if (!payload) throw new Error("invitation_not_active");
  const text = [
    `You have been invited to manage ${payload.organizationName}'s Donate by Mail phone-drive workspace.`,
    "",
    "Sign in with the invited email address using a one-time secure link:",
    `${origin}${payload.loginPath}?account=partner`,
    "",
    "If you were not expecting this invitation, you can ignore this message.",
  ].join("\n");
  await deliverOutboxRecipient(env, eventId, "partner_invitation_email", {
    to: [{ email: payload.email }],
    subject: `Donate by Mail partnership invitation for ${payload.organizationName}`,
    textContent: text,
    htmlContent: textEmailHtml(text),
    tag: "partner-invitation",
  });
}

async function deliverPartnerApplicationAcknowledgment(
  env: WorkerEnv,
  eventId: string,
  applicationId: string,
): Promise<void> {
  const payload = await supabaseRpc<{
    applicationId: string;
    contactName: string;
    email: string;
    organizationName: string;
    status: string;
  } | null>(env, "get_partner_application_notification", {
    candidate_application_id: applicationId,
  });
  if (!payload) throw new Error("partner_application_not_found");
  const text = [
    `Hello ${payload.contactName},`,
    "",
    `Thank you for applying to run a Donate by Mail campaign for ${payload.organizationName}.`,
    "Our team will verify the organization and its nonprofit record before creating a workspace or publishing a campaign.",
    "",
    "We will reply to this email if we need any additional information.",
  ].join("\n");
  await deliverOutboxRecipient(env, eventId, "partner_application_acknowledgment", {
    to: [{ email: payload.email, name: payload.contactName }],
    subject: `We received ${payload.organizationName}'s Donate by Mail application`,
    textContent: text,
    htmlContent: textEmailHtml(text),
    tag: "partner-application-acknowledgment",
  });
}

async function dispatchOutboxEvent(env: WorkerEnv, event: OutboxEvent, origin: string): Promise<void> {
  if (event.handler_key === "donation_notifications" && event.payload.donationId) {
    await deliverDonationNotification(env, event.id, event.event_type, event.payload.donationId, origin);
    return;
  }
  if (event.handler_key === "partner_invitation_email" && event.payload.invitationId) {
    await deliverPartnerInvitation(env, event.id, event.payload.invitationId, origin);
    return;
  }
  if (event.handler_key === "partner_application_acknowledgment" && event.payload.applicationId) {
    await deliverPartnerApplicationAcknowledgment(env, event.id, event.payload.applicationId);
    return;
  }
  throw new Error("unsupported_handler");
}

function normalizeOrganization(
  value: Record<string, unknown>,
  pledgeId: string,
): SelectedCharity {
  const bounded = (candidate: unknown, maximum: number) => {
    const normalized = stringValue(candidate);
    return normalized && normalized.length <= maximum ? normalized : undefined;
  };
  const country = (candidate: unknown) => {
    const normalized = bounded(candidate, 2)?.toUpperCase();
    return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : undefined;
  };
  const secureUrl = (candidate: unknown) => {
    const normalized = bounded(candidate, 1000);
    if (!normalized) return undefined;
    try {
      const url = new URL(normalized);
      return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    pledgeId,
    name:
      bounded(value.name, 240) ??
      bounded(value.organization_name, 240) ??
      "Selected Pledge nonprofit",
    ein: bounded(value.ngo_id, 32) ?? bounded(value.ein, 32),
    city: bounded(value.city, 160),
    state: bounded(value.region, 160) ?? bounded(value.state, 160),
    country: country(value.country) ?? country(value.country_code),
    logoUrl: secureUrl(value.logo_url) ?? secureUrl(value.logo),
    websiteUrl: secureUrl(value.website_url) ?? secureUrl(value.website),
  };
}

async function lookupOrganization(
  pledgeId: string,
  env: WorkerEnv,
): Promise<SelectedCharity | null> {
  if (!env.PLEDGE_API_KEY) return null;
  const response = await fetchWithTimeout(
    `${pledgeApiOrigin(env.DEPLOYMENT_ENVIRONMENT)}/v1/organizations/${encodeURIComponent(pledgeId)}`,
    {
      headers: {
        authorization: `Bearer ${env.PLEDGE_API_KEY}`,
        accept: "application/json",
      },
    },
  );
  if (!response.ok) return null;
  const body = await readBoundedResponseJson<unknown>(response, MAX_SMALL_PROVIDER_RESPONSE_BYTES);
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return normalizeOrganization(body as Record<string, unknown>, pledgeId);
}

async function handleOrganizationLookup(
  request: Request,
  env: WorkerEnv,
  pledgeId: string,
): Promise<Response> {
  if (!sameOrigin(request))
    return json({ ok: false, message: "Request not allowed." }, 403);
  if (!/^[0-9a-f-]{36}$/i.test(pledgeId))
    return json({ ok: false, message: "Invalid organization ID." }, 400);
  if (!env.PLEDGE_API_KEY) {
    return json(
      {
        ok: false,
        code: "lookup_not_configured",
        message: "Organization details lookup is not configured.",
      },
      503,
    );
  }
  // This endpoint spends the server-side Pledge credential on behalf of an
  // otherwise anonymous browser. Keep a bounded per-address budget so a
  // same-origin script cannot turn arbitrary UUIDs into an unbounded provider
  // quota or cost sink. Missing tracking configuration fails closed through
  // anonymousRateAllowed rather than allowing an unmetered lookup.
  if (!(await anonymousRateAllowed(request, env, "pledge_lookup", 60, 3600)))
    return json({ ok: false, message: "Organization details lookup is temporarily limited." }, 429);
  try {
    const charity = await lookupOrganization(pledgeId, env);
    return charity
      ? json({ ok: true, charity })
      : json(
          { ok: false, message: "Organization details were not found." },
          404,
        );
  } catch {
    return json(
      { ok: false, message: "Organization details could not be loaded." },
      502,
    );
  }
}

const DEFAULT_TURNSTILE_HOSTNAMES = new Set([
  "donatebymail.org",
  "www.donatebymail.org",
]);

/** Validate the one-time Turnstile token at the server boundary. */
export async function verifyTurnstile(
  request: Request,
  env: WorkerEnv,
  token: string | undefined,
  expectedAction = "donation_submit",
): Promise<boolean> {
  if (env.DEPLOYMENT_ENVIRONMENT === "beta") return true;
  if (!env.TURNSTILE_SECRET_KEY || !token || token.length > 2048) return false;
  const configuredHostnames = new Set(
    (env.TURNSTILE_HOSTNAMES || "")
      .split(",")
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(Boolean),
  );
  if ([...configuredHostnames].some((hostname) => !DEFAULT_TURNSTILE_HOSTNAMES.has(hostname))) return false;
  const expectedHostnames = configuredHostnames.size
    ? configuredHostnames
    : DEFAULT_TURNSTILE_HOSTNAMES;
  try {
    const response = await fetchWithTimeout(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET_KEY,
          response: token,
          remoteip: request.headers.get("cf-connecting-ip") || "",
        }),
      },
    );
    if (!response.ok) return false;
    const result = await readBoundedResponseJson<{
      success?: boolean;
      action?: string;
      hostname?: string;
    }>(response, 64 * 1024);
    return result.success === true
      && result.action === expectedAction
      && typeof result.hostname === "string"
      && expectedHostnames.has(result.hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function handleDonationSubmission(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  // Donation intake must never fall back to an email-only path. Without the
  // durable database, idempotency key, tracking capability, audit event, and
  // outbox transaction, a donor could receive an acknowledgement for a
  // record the operations system cannot reconcile.
  if (!operationalDataConfigured(env) || productionConfigurationErrors(env).length > 0) {
    return json({ ok: false, code: "operational_data_unavailable", message: "Donation intake is temporarily unavailable." }, 503);
  }
  if (!browserMutationOriginAllowed(request))
    return json({ ok: false, message: "Request not allowed." }, 403);
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return json({ ok: false, message: "Expected a JSON request." }, 415);
  }
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 100_000)
    return json({ ok: false, message: "Submission is too large." }, 413);

  let payload: unknown;
  try {
    payload = await readJson(request, 100_000);
  } catch {
    return json(
      { ok: false, message: "The submission could not be read." },
      400,
    );
  }
  const rawRecord = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  const turnstileToken = stringValue(rawRecord?.turnstileToken);
  if (rawRecord) {
    const { turnstileToken: _ignoredTurnstileToken, ...submissionPayload } = rawRecord;
    payload = submissionPayload;
  }
  if (!validateDonationSubmission(payload)) {
    return json(
      {
        ok: false,
        message: "Please review the donation information and try again.",
      },
      400,
    );
  }
  if (env.DEPLOYMENT_ENVIRONMENT !== "beta" && !(await verifyTurnstile(request, env, turnstileToken)))
    return json({ ok: false, message: "Security verification could not be completed. Please try again." }, 403);
  // The checkbox is client-controlled, but the timestamp is an audit fact.
  // Hash the consent decision, not an attacker-supplied clock value, and write
  // the server's receipt time into the durable donation record.
  const validatedPayload = payload as DonationSubmission;
  const donorForHash = { ...validatedPayload.donor };
  delete donorForHash.marketingConsentAt;
  if (donorForHash.marketingEmailConsent) donorForHash.marketingConsentAt = "server-recorded";
  const submittedRequestHash = await sha256Hex(stableJson({
    ...validatedPayload,
    donor: donorForHash,
  }));
  if (operationalDataConfigured(env) && !(await anonymousRateAllowed(request, env, "donation_submit", 10, 3600)))
    return json({ ok: false, message: "Too many submissions. Please try again later." }, 429);
  const serverConsentAt = validatedPayload.donor.marketingEmailConsent
    ? new Date().toISOString()
    : undefined;
  let record: DonationSubmission = {
    ...validatedPayload,
    donor: { ...validatedPayload.donor, marketingConsentAt: serverConsentAt },
  };
  let verifiedCharity: SelectedCharity | null = null;
  try {
    verifiedCharity = await lookupOrganization(record.charity.pledgeId, env);
    if (verifiedCharity) record = { ...record, charity: verifiedCharity };
  } catch {
    // Production remains fail-closed when the beneficiary cannot be re-verified.
  }
  if (env.DEPLOYMENT_ENVIRONMENT !== "beta" && !verifiedCharity)
    return json({ ok: false, code: "charity_verification_unavailable", message: "The selected nonprofit could not be verified right now. Please try again." }, 503);

  const persisted = await supabaseRpc<PersistedDonation>(env, "create_donation", {
    payload: record,
    tracking_nonce: crypto.randomUUID(), claim_nonce: crypto.randomUUID(),
    request_hash_value: submittedRequestHash, campaign_slug: record.campaignSlug || null,
  });
  const canonicalCharity = await supabaseRpc<CanonicalDonationCharity | null>(env, "get_donation_charity", {
    candidate_donation_id: persisted.donationId,
  }).catch(() => null);
  const { ein: _untrustedEin, ...publicCharityMetadata } = record.charity;
  const responseCharity = canonicalCharity
    ? { ...publicCharityMetadata, pledgeId: canonicalCharity.pledgeId, name: canonicalCharity.name,
      ...(canonicalCharity.ein ? { ein: canonicalCharity.ein } : {}) }
    : record.charity;
  const material = await supabaseRpc<TrackingMaterial>(env, "get_donation_tracking_material", {
    candidate_public_id: persisted.publicId,
  });
  const token = await createTrackingToken(
    env.DONATION_TRACKING_SECRET!,
    persisted.donationId,
    material.trackingNonce,
  );
  const origin = applicationOrigin(env.DEPLOYMENT_ENVIRONMENT);
  const link = trackingUrl(origin, persisted.publicId, token);
  const claimToken = await createClaimToken(env.DONATION_TRACKING_SECRET!, persisted.donationId, material.claimNonce!);
  let notificationEventId = persisted.outboxEventId;
  if (!notificationEventId && !persisted.created) {
    const existingEvent = await supabaseRpc<{ eventId?: string } | null>(env, "get_donation_notification_event", {
      candidate_donation_id: persisted.donationId,
    }).catch(() => null);
    notificationEventId = existingEvent?.eventId || null;
  }
  // Missing event linkage is itself an operational failure; surface it to
  // the donor instead of claiming that notification delivery is complete.
  let notificationPending = !notificationEventId;
  if (notificationEventId) {
    try {
      await deliverDonationNotification(
        env,
        notificationEventId,
        "donation.created",
        persisted.donationId,
        origin,
      );
      await completeInlineOutbox(env, notificationEventId);
      notificationPending = false;
    } catch {
      notificationPending = true;
    }
  }
  return json({
    ok: true, replayed: !persisted.created,
    donationId: persisted.publicId,
    createdAt: persisted.createdAt,
    charity: responseCharity,
    trackingUrl: link,
    claimUrl: claimUrl(origin, persisted.publicId, claimToken),
    notificationPending,
  }, persisted.created ? 201 : 200);
}

async function handleTrackingStatus(request: Request, env: WorkerEnv): Promise<Response> {
  if (!browserMutationOriginAllowed(request)) return json({ ok: false, message: "Request not allowed." }, 403);
  // Tracking URLs carry an HMAC, but public IDs are intentionally visible in
  // donor emails. Keep guessed-ID probes and repeated status refreshes from
  // becoming an unbounded service-role database lookup surface.
  if (!(await anonymousRateAllowed(request, env, "tracking_status", 120, 3600)))
    return json({ ok: false, message: "Donation status is temporarily limited." }, 429);
  try {
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    const publicId = stringValue(body.publicId);
    const token = stringValue(body.token);
    if (!publicId || !AGENT_PUBLIC_ID_PATTERN.test(publicId) || !token || token.length !== 43 || !env.DONATION_TRACKING_SECRET)
      return json({ ok: false, message: "This tracking link is invalid." }, 400);
    const material = await supabaseRpc<TrackingMaterial | null>(env, "get_donation_tracking_material", {
      candidate_public_id: publicId,
    });
    if (!material || !(await verifyTrackingToken(
      env.DONATION_TRACKING_SECRET, material.donationId, material.trackingNonce, token,
    ))) return json({ ok: false, message: "This tracking link is invalid or expired." }, 404);
    const status = await supabaseRpc<Record<string, unknown> | null>(env, "get_donation_status", {
      candidate_public_id: publicId,
    });
    return status ? json({ ok: true, donation: status }) : json({ ok: false, message: "Not found." }, 404);
  } catch {
    return json({ ok: false, message: "The donation status could not be loaded." }, 400);
  }
}

async function requireStaff(request: Request, env: WorkerEnv): Promise<StaffUser | Response> {
  try {
    const user = await supabaseUser(request, env);
    return user ?? json({ ok: false, message: "Staff sign-in is required." }, 401);
  } catch (error) {
    if (error instanceof Error && error.message === "staff_mfa_required")
      return json({ ok: false, code: "mfa_required", redirect: "/settings?mfa=required",
        message: "Two-step verification is required for staff access." }, 403);
    return json({ ok: false, message: "Staff sign-in could not be verified." }, 401);
  }
}

/** Paths whose mutations are reserved for active administrators. */
export function isAdminOnlyStaffPath(pathname: string): boolean {
  return pathname === "/api/staff/campaigns/publish"
    || /^\/api\/staff\/campaigns\/[0-9a-f-]{36}\/revisions\/[0-9a-f-]{36}\/review$/i.test(pathname)
    || /^\/api\/staff\/campaigns\/[0-9a-f-]{36}\/alias$/i.test(pathname)
    || /^\/api\/staff\/partner-applications\/[0-9a-f-]{36}\/review$/i.test(pathname)
    || /^\/api\/staff\/partners\/organizations\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}\/review$/i.test(pathname)
    || /^\/api\/staff\/partners\/organizations\/[0-9a-f-]{36}\/profiles\/[0-9a-f-]{36}\/publish$/i.test(pathname)
    || pathname === "/api/staff/partners/organizations"
    || /^\/api\/staff\/partners\/organizations\/[0-9a-f-]{36}\/(charities|invitations|status)$/i.test(pathname)
    || /^\/api\/staff\/partners\/organizations\/[0-9a-f-]{36}\/members\/[0-9a-f-]{36}\/status$/i.test(pathname)
    || pathname === "/api/staff/finance/disbursements/prepare"
    || /^\/api\/staff\/finance\/disbursements\/[0-9a-f-]{36}\/(decision|complete)$/i.test(pathname);
}

function requireAdmin(staff: StaffUser): StaffUser | Response {
  return staff.role === "admin"
    ? staff
    : json({ ok: false, message: "Administrator access is required for this action." }, 403);
}

export function authorizeStaffPath(role: StaffRole, pathname: string): Response | null {
  if (!isAdminOnlyStaffPath(pathname)) return null;
  const staff = { id: "policy-check", role } satisfies StaffUser;
  const result = requireAdmin(staff);
  return result instanceof Response ? result : null;
}

async function sendMagicLink(request: Request, env: WorkerEnv, destination: "/staff" | "/account" | "/partner", staffOnly = false): Promise<Response> {
  if (!browserMutationOriginAllowed(request)) return json({ ok: false, message: "Request not allowed." }, 403);
  const generic = json({ ok: true, message: "If the address can sign in, a secure link is on its way." }, 202);
  try {
    if (!(await anonymousRateAllowed(request, env, "auth_magic_link", 5, 900))) return generic;
    const body = (await readJson(request, 4_000)) as Record<string, unknown>;
    const email = stringValue(body.email)?.toLowerCase();
    const turnstileToken = stringValue(body.turnstileToken);
    const baseUrl = supabaseBaseUrl(env);
    if (!email || !baseUrl || !env.SUPABASE_PUBLISHABLE_KEY) return generic;
    if (env.DEPLOYMENT_ENVIRONMENT !== "beta" && !(await verifyTurnstile(request, env, turnstileToken, "auth_magic_link")))
      return generic;
    if (staffOnly && !(await supabaseRpc<boolean>(env, "is_active_staff_email", { candidate_email: email }))) return generic;
    const state = crypto.randomUUID();
    const storage = new PkceStorage();
    const client = createClient(baseUrl, env.SUPABASE_PUBLISHABLE_KEY, { auth: {
      flowType: "pkce", storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
    }});
    const callback = new URL("/auth/confirm", applicationOrigin(env.DEPLOYMENT_ENVIRONMENT));
    callback.searchParams.set("state", state);
    const allowInvitedPartnerSignup = destination === "/partner"
      && await supabaseRpc<boolean>(env, "is_invited_partner_email", { candidate_email: email });
    const { error } = await client.auth.signInWithOtp({ email, options: {
      emailRedirectTo: callback.toString(),
      // Donor accounts may be created from the public gateway. Partner and
      // staff access must remain invitation/allowlist controlled. A pending
      // partner invitation is the only exception: it bootstraps the invited
      // identity so the invitation can be accepted on first sign-in.
      shouldCreateUser: (destination === "/account" && !staffOnly) || allowInvitedPartnerSignup,
    }});
    if (error) return generic;
    await supabaseRpc(env, "create_auth_login_attempt", {
      state_hash_value: await sha256Hex(state), destination_value: destination,
      storage_value: storage.values, expires_at_value: new Date(Date.now() + 15 * 60_000).toISOString(),
      pending_claim_value: destination === "/account"
        ? cookieValue(request.headers.get("cookie"), PENDING_CLAIM_COOKIE)
        : null,
    });
    return generic;
  } catch {
    return generic;
  }
}

async function handleAuthConfirmation(request: Request, env: WorkerEnv): Promise<Response> {
  if (!browserMutationOriginAllowed(request)) return json({ ok: false, message: "Request not allowed." }, 403);
  let body: Record<string, unknown>;
  try {
    const parsed = await readJson(request, 4_000);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_auth_confirmation");
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ ok: false, message: "This sign-in link is invalid or incomplete." }, 400);
  }
  const state = stringValue(body.state), code = stringValue(body.code), tokenHash = stringValue(body.tokenHash);
  const baseUrl = supabaseBaseUrl(env);
  if (!state || (!code && !tokenHash) || !baseUrl || !env.SUPABASE_PUBLISHABLE_KEY || !env.BFF_SESSION_SECRET)
    return json({ ok: false, message: "This sign-in link is invalid or incomplete." }, 400);
  const attempt = await supabaseRpc<{ destination: unknown; storage: unknown; pendingClaimId?: unknown } | null>(env, "consume_auth_login_attempt", {
    state_hash_value: await sha256Hex(state),
  });
  const storageValues = boundedPkceStorage(attempt?.storage);
  if (!attempt || !isValidAuthDestination(attempt.destination) || !storageValues)
    return json({ ok: false, message: "This sign-in link has expired or was already used." }, 400);
  const storage = new PkceStorage(storageValues);
  const client = createClient(baseUrl, env.SUPABASE_PUBLISHABLE_KEY, { auth: {
    flowType: "pkce", storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
  }});
  const { data, error } = code
    ? await client.auth.exchangeCodeForSession(code)
    : await client.auth.verifyOtp({ token_hash: tokenHash as string, type: "email" });
  if (error || !data.session || !data.user) return json({ ok: false, message: "This sign-in link is invalid or expired." }, 400);
  if (attempt.destination === "/staff" && !(await supabaseRpc<boolean>(env, "is_active_staff_user", { candidate_user_id: data.user.id }))) {
    await client.auth.signOut();
    return json({ ok: false, message: "This address is not authorized for staff access." }, 403);
  }
  if (attempt.destination === "/partner" && data.user.email) {
    await supabaseRpc(env, "activate_partner_invitations", {
      actor_user_id: data.user.id, verified_email: data.user.email,
    });
  }
  let claimCompleted = false;
  const pendingClaimId = typeof attempt.pendingClaimId === "string" && AGENT_UUID_PATTERN.test(attempt.pendingClaimId)
    ? attempt.pendingClaimId : null;
  if (attempt.destination === "/account" && pendingClaimId && data.user.email) {
    try {
      await supabaseRpc(env, "complete_pending_donation_claim", {
        actor_user_id: data.user.id, pending_claim_value: pendingClaimId,
        verified_email: data.user.email,
      });
      claimCompleted = true;
    } catch { /* Fail closed; the account page explains that the claim was not completed. */ }
  }
  // Read factors from the authenticated MFA endpoint rather than relying on
  // the shape of the user object returned by the email-link exchange. The
  // latter is not guaranteed to include the current factor inventory, which
  // could otherwise turn an existing staff factor into an accidental bypass.
  const { data: listedFactors, error: factorsError } = await client.auth.mfa.listFactors();
  if (factorsError) {
    await client.auth.signOut();
    return json({ ok: false, message: "Security verification is temporarily unavailable. Request a new sign-in link." }, 503);
  }
  const verifiedTotpFactors = (listedFactors?.totp || []).filter((factor) =>
    factor.factor_type === "totp" && factor.status === "verified");
  const now = Date.now();
  const session: BffSession = {
    accessToken: data.session.access_token, refreshToken: data.session.refresh_token,
    expiresAt: (data.session.expires_at || Math.floor(now / 1000) + 3600) * 1000,
    absoluteExpiresAt: now + 7 * 24 * 60 * 60_000,
    csrf: bytesToToken(32),
  };
  const destination = attempt.destination === "/account"
    ? `/account?claim=${claimCompleted ? "complete" : pendingClaimId ? "failed" : "none"}`
    : attempt.destination;
  if (verifiedTotpFactors.length) {
    session.mfaPending = true;
    session.mfaDestination = destination;
  } else if (attempt.destination === "/staff") {
    session.mfaEnrollmentRequired = true;
    session.mfaDestination = destination;
  }
  const response = json({ ok: true, redirect: verifiedTotpFactors.length
    ? "/auth/mfa"
    : attempt.destination === "/staff" ? "/settings?mfa=required" : destination });
  response.headers.append("set-cookie", sessionCookie(await sealSession(session, env.BFF_SESSION_SECRET)));
  response.headers.append("set-cookie", pendingClaimCookie("", 0));
  return response;
}

async function handleMfaApi(request: Request, env: WorkerEnv, url: URL): Promise<Response> {
  if (request.method !== "GET" && !browserMutationOriginAllowed(request)) return json({ ok: false, message: "Request not allowed." }, 403);
  if (request.method === "GET" && !sameOrigin(request)) return json({ ok: false, message: "Request not allowed." }, 403);
  const pendingAction = url.pathname === "/api/auth/mfa/challenge" || url.pathname === "/api/auth/mfa/verify";
  const context = await userAuthClient(request, env, pendingAction);
  if (!context) return json({ ok: false, message: "Secure sign-in is required." }, 401);
  const { client, session } = context;
  if (request.method !== "GET" && !csrfAllowed(request))
    return json({ ok: false, message: "Request not allowed." }, 403);

  if (request.method === "GET" && url.pathname === "/api/auth/mfa/status") {
    if (session.mfaPending) return json({ ok: false, message: "Complete the security challenge first." }, 403);
    const { data, error } = await client.auth.mfa.listFactors();
    if (error) return json({ ok: false, message: "Security settings could not be loaded." }, 400);
    return json({ ok: true, enrollmentRequired: session.mfaEnrollmentRequired === true,
      factors: data.totp.filter((factor) => factor.status === "verified")
      .map((factor) => ({ id: factor.id, friendlyName: factor.friendly_name || "Authenticator app" })) });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/mfa/enroll") {
    if (session.mfaPending) return json({ ok: false, message: "Complete the security challenge first." }, 403);
    const body = (await readJson(request, 2_000)) as Record<string, unknown>;
    const friendlyName = stringValue(body.friendlyName)?.slice(0, 100) || "Donate by Mail";
    const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName });
    if (error || data.type !== "totp") return json({ ok: false, message: "Authenticator enrollment could not start." }, 400);
    return json({ ok: true, enrollment: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret } });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/mfa/enroll/verify") {
    if (session.mfaPending) return json({ ok: false, message: "Complete the security challenge first." }, 403);
    const body = (await readJson(request, 2_000)) as Record<string, unknown>;
    const factorId = stringValue(body.factorId), code = stringValue(body.code);
    if (!factorId || !/^\d{6}$/.test(code || "")) return json({ ok: false, message: "Enter the six-digit authenticator code." }, 400);
    const { data, error } = await client.auth.mfa.challengeAndVerify({ factorId, code: code! });
    if (error || !data) return json({ ok: false, message: "The authenticator code was not accepted." }, 400);
    return elevatedSessionResponse(env, session, data, session.mfaDestination || "/settings?mfa=enrolled");
  }

  if (request.method === "POST" && url.pathname === "/api/auth/mfa/unenroll") {
    if (session.mfaPending) return json({ ok: false, message: "Complete the security challenge first." }, 403);
    const body = (await readJson(request, 2_000)) as Record<string, unknown>;
    const factorId = stringValue(body.factorId);
    if (!factorId) return json({ ok: false, message: "Authenticator not found." }, 400);
    const { data: factors } = await client.auth.mfa.listFactors();
    if (!factors?.totp.some((factor) => factor.id === factorId && factor.status === "verified"))
      return json({ ok: false, message: "Authenticator not found." }, 404);
    const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error || assurance.data.currentLevel !== "aal2")
      return json({ ok: false, message: "Verify with your authenticator before removing it." }, 403);
    const { error } = await client.auth.mfa.unenroll({ factorId });
    if (error) return json({ ok: false, message: "Authenticator removal was not accepted." }, 400);
    const response = json({ ok: true, redirect: "/login", signInRequired: true });
    response.headers.append("set-cookie", clearSessionCookie());
    return response;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/mfa/challenge") {
    if (!session.mfaPending) return json({ ok: false, message: "No security challenge is pending." }, 409);
    const { data, error } = await client.auth.mfa.listFactors();
    const factor = data?.totp.find((candidate) => candidate.status === "verified");
    if (error || !factor) return json({ ok: false, message: "No verified authenticator is available." }, 400);
    const challenge = await client.auth.mfa.challenge({ factorId: factor.id });
    if (challenge.error || !challenge.data) return json({ ok: false, message: "The security challenge could not start." }, 400);
    return json({ ok: true, factorId: factor.id, challengeId: challenge.data.id });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/mfa/verify") {
    if (!session.mfaPending) return json({ ok: false, message: "No security challenge is pending." }, 409);
    const body = (await readJson(request, 2_000)) as Record<string, unknown>;
    const factorId = stringValue(body.factorId), challengeId = stringValue(body.challengeId), code = stringValue(body.code);
    if (!factorId || !challengeId || !/^\d{6}$/.test(code || ""))
      return json({ ok: false, message: "Enter the six-digit authenticator code." }, 400);
    const { data: factors } = await client.auth.mfa.listFactors();
    if (!factors?.totp.some((factor) => factor.id === factorId && factor.status === "verified"))
      return json({ ok: false, message: "The security challenge is invalid." }, 403);
    const { data, error } = await client.auth.mfa.verify({ factorId, challengeId, code: code! });
    if (error || !data) return json({ ok: false, message: "The authenticator code was not accepted." }, 400);
    const redirect = session.mfaDestination || "/login";
    return elevatedSessionResponse(env, session, data, redirect);
  }
  return json({ ok: false, message: "Not found." }, 404);
}

export function redirectLegacyAuthCallback(request: Request, env: WorkerEnv): Response {
  const source = new URL(request.url), destination = new URL("/auth/confirm", applicationOrigin(env.DEPLOYMENT_ENVIRONMENT));
  const state = source.searchParams.get("state"), code = source.searchParams.get("code");
  if (state) destination.searchParams.set("state", state);
  // Never reflect a one-time auth code when the state is absent.  The
  // confirmation endpoint cannot consume that pair, and keeping the code out
  // of the browser URL/history reduces credential exposure on malformed links.
  if (state && code) destination.hash = new URLSearchParams({ code }).toString();
  if (!state || !code) destination.searchParams.set("error", "invalid");
  return Response.redirect(destination.toString(), 303);
}

async function handleClaimHandoff(request: Request, env: WorkerEnv): Promise<Response> {
  if (!browserMutationOriginAllowed(request)) return json({ ok: false, message: "Request not allowed." }, 403);
  if (!(await anonymousRateAllowed(request, env, "claim_intent", 10, 900)))
    return json({ ok: false, message: "Too many claim attempts. Please try again later." }, 429);
  let body: Record<string, unknown>;
  try {
    const parsed = await readJson(request, 8_000);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_claim_intent");
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ ok: false, message: "The claim reference is invalid." }, 400);
  }
  const publicId = stringValue(body.publicId), token = stringValue(body.claimToken);
  if (!publicId || !AGENT_PUBLIC_ID_PATTERN.test(publicId) || !token || token.length !== 43 || !env.DONATION_TRACKING_SECRET)
    return json({ ok: false, message: "The claim reference is invalid." }, 400);
  const material = await supabaseRpc<TrackingMaterial | null>(env, "get_donation_claim_material", {
    candidate_public_id: publicId,
  });
  if (!material?.claimNonce || !(await verifyClaimToken(
    env.DONATION_TRACKING_SECRET, material.donationId, material.claimNonce, token,
  ))) return json({ ok: false, message: "The claim reference is invalid or expired." }, 404);
  const user = await authenticatedUser(request, env);
  if (user?.email) {
    const result = await supabaseRpc(env, "claim_donation", {
      actor_user_id: user.id, candidate_donation_id: material.donationId, verified_email: user.email,
    });
    return json({ ok: true, claimed: true, result });
  }
  const pendingId = await supabaseRpc<string>(env, "create_pending_donation_claim", {
    candidate_donation_id: material.donationId,
  });
  const response = json({ ok: true, claimed: false, pending: true });
  response.headers.append("set-cookie", pendingClaimCookie(pendingId));
  return response;
}

function bytesToToken(size: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function handleLogout(request: Request, env: WorkerEnv): Promise<Response> {
  const user = await authenticatedUser(request, env, true);
  if (!user || !csrfAllowed(request)) return json({ ok: false, message: "Request not allowed." }, 403);
  const session = requestSessions.get(request)!;
  const baseUrl = supabaseBaseUrl(env);
  if (baseUrl && env.SUPABASE_PUBLISHABLE_KEY) await fetchWithTimeout(`${baseUrl}/auth/v1/logout?scope=local`, {
    method: "POST", headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${session.accessToken}` },
  });
  refreshedCookies.delete(request);
  const response = json({ ok: true });
  response.headers.append("set-cookie", clearSessionCookie());
  return response;
}

async function handleCsrf(request: Request, env: WorkerEnv): Promise<Response> {
  if (request.method !== "GET" || !sameOrigin(request))
    return json({ ok: false, message: "Request not allowed." }, 403);
  const user = await authenticatedUser(request, env, true), session = requestSessions.get(request);
  return user && session ? json({ ok: true, csrfToken: session.csrf }) : json({ ok: false, message: "Secure sign-in is required." }, 401);
}

async function handleAuthSessionContext(request: Request, env: WorkerEnv): Promise<Response> {
  if (request.method !== "GET" || !sameOrigin(request))
    return json({ ok: false, message: "Request not allowed." }, 403);
  try {
    const user = await authenticatedUser(request, env);
    if (!user) return json({ ok: true, authenticated: false });
    const context = await supabaseRpc<Record<string, unknown>>(env, "account_context", {
      actor_user_id: user.id,
    });
    return json({ ok: true, authenticated: true, context });
  } catch {
    return json({ ok: true, authenticated: false });
  }
}

async function handleStaffApi(request: Request, env: WorkerEnv, url: URL): Promise<Response> {
  if (request.method === "GET" && !sameOrigin(request))
    return json({ ok: false, message: "Request not allowed." }, 403);
  const staff = await requireStaff(request, env);
  if (staff instanceof Response) return staff;
  if (request.method !== "GET" && !csrfAllowed(request))
    return json({ ok: false, message: "Request not allowed." }, 403);
  if (request.method !== "GET") {
    const authorization = authorizeStaffPath(staff.role, url.pathname);
    if (authorization) return authorization;
  }
  if (request.method === "GET" && url.pathname === "/api/staff/session")
    return json({ ok: true, user: { id: staff.id, role: staff.role } });
  if (request.method === "GET" && url.pathname === "/api/staff/finance") {
    return json({ ok: true, finance: await supabaseRpc(env, "staff_financial_overview", { actor_user_id: staff.id }) });
  }
  if (request.method === "POST" && url.pathname === "/api/staff/finance/sales") {
    const body = (await readJson(request, 12_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env, "staff_record_sale_and_allocation", {
      actor_user_id: staff.id, candidate_device_id: body.deviceId,
      gross_value_cents: body.grossAmountCents, sale_channel: body.channel,
      external_ref: body.externalReference || null, sold_time: body.soldAt || new Date().toISOString(),
    }) });
  }
  if (request.method === "POST" && url.pathname === "/api/staff/finance/costs") {
    const body = (await readJson(request, 12_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env, "staff_record_cost", {
      actor_user_id: staff.id, candidate_donation_id: body.donationId,
      candidate_device_id: body.deviceId || null, cost_category: body.category,
      cost_amount_cents: body.amountCents, evidence_ref: body.evidenceReference || null,
      incurred_time: body.incurredAt || new Date().toISOString(),
    }) });
  }
  if (request.method === "POST" && url.pathname === "/api/staff/finance/finalize") {
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env, "staff_finalize_donation_financials", {
      actor_user_id: staff.id, candidate_donation_id: body.donationId,
    }) });
  }
  if (request.method === "POST" && url.pathname === "/api/staff/finance/reopen") {
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env, "staff_reopen_donation_financials", {
      actor_user_id: staff.id, candidate_donation_id: body.donationId, reason_value: body.reason,
    }) });
  }
  const correction = url.pathname.match(/^\/api\/staff\/finance\/(sales|costs)\/([0-9a-f-]{36})\/reverse$/i);
  if (request.method === "POST" && correction) {
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env,
      correction[1] === "sales" ? "staff_reverse_sale" : "staff_reverse_cost", {
        actor_user_id: staff.id,
        [correction[1] === "sales" ? "candidate_sale_id" : "candidate_cost_id"]: correction[2],
        reason_value: body.reason,
      }) });
  }
  if (request.method === "POST" && url.pathname === "/api/staff/finance/disbursements/prepare") {
    const body = (await readJson(request, 12_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env, "staff_prepare_disbursement", {
      actor_user_id: staff.id, candidate_allocation_id: body.allocationId,
      amount_value_cents: body.amountCents, payment_memo_value: body.paymentMemo || null,
      evidence_value: body.evidence || {},
    }) });
  }
  const disbursementAction = url.pathname.match(/^\/api\/staff\/finance\/disbursements\/([0-9a-f-]{36})\/(decision|complete)$/i);
  if (request.method === "POST" && disbursementAction) {
    const body = (await readJson(request, 12_000)) as Record<string, unknown>;
    const result = disbursementAction[2] === "decision"
      ? await supabaseRpc(env, "staff_decide_disbursement", {
        actor_user_id: staff.id, candidate_preparation_id: disbursementAction[1],
        decision_value: body.outcome, reason_value: body.reason || null,
      })
      : await supabaseRpc(env, "staff_record_disbursement_completion", {
        actor_user_id: staff.id, candidate_preparation_id: disbursementAction[1],
        external_ref: body.externalReference,
      });
    return json({ ok: true, result });
  }
  if (request.method === "GET" && url.pathname === "/api/staff/partner-applications")
    return json({ ok: true, applications: await supabaseRpc(env, "staff_partner_application_queue", { actor_user_id: staff.id }) });
  if (request.method === "GET" && url.pathname === "/api/staff/partner-reviews")
    return json({ ok: true, queue: await supabaseRpc(env, "staff_partner_review_queue", { actor_user_id: staff.id }) });
  const applicationReview = url.pathname.match(/^\/api\/staff\/partner-applications\/([0-9a-f-]{36})\/review$/i);
  if (request.method === "POST" && applicationReview) {
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env, "staff_review_partner_application", {
      actor_user_id: staff.id, candidate_application_id: applicationReview[1], status_value: body.status,
      candidate_organization_id: body.organizationId || null,
    }) });
  }
  const profilePreview = url.pathname.match(/^\/api\/staff\/partners\/organizations\/([0-9a-f-]{36})\/profiles\/([0-9a-f-]{36})\/preview$/i);
  if (request.method === "GET" && profilePreview) {
    return json({ ok: true, preview: await supabaseRpc(env, "staff_profile_revision_preview", {
      actor_user_id: staff.id, candidate_organization_id: profilePreview[1], candidate_revision_id: profilePreview[2],
    }) });
  }
  const profileReview = url.pathname.match(/^\/api\/staff\/partners\/organizations\/([0-9a-f-]{36})\/profiles\/([0-9a-f-]{36})\/(review|publish)$/i);
  if (request.method === "POST" && profileReview) {
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    const result = profileReview[3] === "publish"
      ? await supabaseRpc(env, "staff_publish_profile_revision", {
        actor_user_id: staff.id, candidate_organization_id: profileReview[1], candidate_revision_id: profileReview[2],
      })
      : await supabaseRpc(env, "staff_review_profile_revision", {
        actor_user_id: staff.id, candidate_organization_id: profileReview[1], candidate_revision_id: profileReview[2],
        outcome_value: body.outcome, feedback_value: body.feedback || null,
      });
    return json({ ok: true, result });
  }
  const staffOrganizationAsset = url.pathname.match(/^\/api\/staff\/organization-assets\/([0-9a-f-]{36})$/i);
  if (request.method === "GET" && staffOrganizationAsset) {
    const asset = await supabaseRpc<{ storagePath: string; mimeType: string; contentSha256: string }>(env,
      "staff_organization_profile_revision_asset", {
        actor_user_id: staff.id, candidate_asset_id: staffOrganizationAsset[1],
      });
    const stored = await getPrivateAssetObject(env, "partner-assets", asset.storagePath);
    if (!stored.ok) return json({ ok: false, message: "Organization asset unavailable." }, 404);
    const bytes = await readBoundedResponseBytes(stored);
    if (await sha256BytesHex(bytes) !== asset.contentSha256)
      return json({ ok: false, message: "Asset verification failed." }, 409);
    return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { headers: {
      "cache-control": "private, no-store", "content-type": asset.mimeType, "x-content-type-options": "nosniff",
    } });
  }
  const exactCampaignReview = url.pathname.match(/^\/api\/staff\/campaigns\/([0-9a-f-]{36})\/revisions\/([0-9a-f-]{36})\/review$/i);
  if (request.method === "POST" && exactCampaignReview) {
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env, "staff_review_campaign_revision", {
      actor_user_id: staff.id, candidate_campaign_id: exactCampaignReview[1], candidate_revision_id: exactCampaignReview[2],
      outcome_value: body.outcome, feedback_value: body.feedback || null,
    }) });
  }
  const campaignAlias = url.pathname.match(/^\/api\/staff\/campaigns\/([0-9a-f-]{36})\/alias$/i);
  if (request.method === "POST" && campaignAlias) {
    const body = (await readJson(request, 4_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env, "staff_set_campaign_alias", {
      actor_user_id: staff.id, candidate_campaign_id: campaignAlias[1], alias_slug_value: body.slug,
      behavior_value: body.behavior || "redirect",
    }) });
  }
  if (request.method === "GET" && url.pathname === "/api/staff/campaigns") {
    return json({ ok: true, campaigns: await supabaseRpc(env, "staff_campaign_overview", { actor_user_id: staff.id }) });
  }
  const campaignPreview = url.pathname.match(/^\/api\/staff\/campaigns\/([0-9a-f-]{36})\/revisions\/([0-9a-f-]{36})\/preview$/i);
  if (request.method === "GET" && campaignPreview) {
    const preview = await supabaseRpc<Record<string, unknown>>(env, "staff_campaign_revision_preview", {
      actor_user_id: staff.id, candidate_campaign_id: campaignPreview[1], candidate_revision_id: campaignPreview[2],
    });
    const verifiedCharity = (preview.charity as Record<string, unknown> | undefined);
    const pledged = verifiedCharity?.pledgeId ? await lookupOrganization(String(verifiedCharity.pledgeId), env).catch(() => null) : null;
    return json({ ok: true, preview: pledged ? { ...preview, charity: { ...verifiedCharity, ...pledged } } : preview });
  }
  const staffAsset = url.pathname.match(/^\/api\/staff\/campaign-assets\/([0-9a-f-]{36})$/i);
  if (request.method === "GET" && staffAsset) {
    const asset = await supabaseRpc<{ id: string; storagePath: string; mimeType: string; contentSha256: string }>(env, "staff_campaign_revision_asset", {
      actor_user_id: staff.id, candidate_asset_id: staffAsset[1],
    });
    const stored = await getPrivateAssetObject(env, "campaign-assets", asset.storagePath);
    if (!stored.ok) return json({ ok: false, message: "Campaign asset unavailable." }, 404);
    const bytes = await readBoundedResponseBytes(stored);
    if (await sha256BytesHex(bytes) !== asset.contentSha256) return json({ ok: false, message: "Asset verification failed." }, 409);
    return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { headers: { "cache-control": "private, no-store", "content-type": asset.mimeType, "x-content-type-options": "nosniff" } });
  }
  if (request.method === "GET" && url.pathname === "/api/staff/partners") {
    return json({ ok: true, partners: await supabaseRpc(env, "staff_partner_overview", { actor_user_id: staff.id }) });
  }
  if (request.method === "POST" && url.pathname === "/api/staff/partners/organizations") {
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env, "staff_create_partner_organization", {
      actor_user_id: staff.id, name_value: body.name, slug_value: body.slug,
    }) });
  }
  const partnerOrgAction = url.pathname.match(/^\/api\/staff\/partners\/organizations\/([0-9a-f-]{36})\/(charities|invitations|status)$/i);
  if (request.method === "POST" && partnerOrgAction) {
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    if (partnerOrgAction[2] === "charities") {
      const pledgeId = stringValue(body.pledgeId);
      if (!pledgeId) return json({ ok: false, message: "A Pledge nonprofit ID is required." }, 400);
      const charity = await lookupOrganization(pledgeId, env);
      if (!charity) return json({ ok: false, message: "The nonprofit could not be verified with Pledge." }, 404);
      const verified = await supabaseRpc<{ charityId: string }>(env, "staff_verify_partner_charity", {
        actor_user_id: staff.id, pledge_id_value: charity.pledgeId,
        canonical_name_value: charity.name, ein_value: charity.ein || null,
      });
      return json({ ok: true, result: await supabaseRpc(env, "staff_associate_partner_charity", {
        actor_user_id: staff.id, candidate_organization_id: partnerOrgAction[1],
        candidate_charity_id: verified.charityId,
      }) });
    }
    const result = await supabaseRpc<Record<string, unknown>>(env,
      partnerOrgAction[2] === "invitations" ? "staff_invite_partner_admin" : "staff_set_partner_organization_status", {
        actor_user_id: staff.id, candidate_organization_id: partnerOrgAction[1],
        ...(partnerOrgAction[2] === "invitations" ? { email_value: body.email } : { status_value: body.status }),
      });
    const invitationOutbox = stringValue(result.outboxEventId);
    const invitationId = stringValue(result.invitationId);
    if (partnerOrgAction[2] === "invitations" && invitationOutbox && invitationId) {
      try {
        await deliverPartnerInvitation(env, invitationOutbox, invitationId, applicationOrigin(env.DEPLOYMENT_ENVIRONMENT));
        await supabaseRpc(env, "complete_inline_outbox_event", {
          event_id: invitationOutbox, handler_name: "partner_invitation_email",
        });
      } catch {
        // The transactional outbox remains pending/retryable if the provider is unavailable.
      }
    }
    return json({ ok: true, result });
  }
  const partnerMember = url.pathname.match(/^\/api\/staff\/partners\/organizations\/([0-9a-f-]{36})\/members\/([0-9a-f-]{36})\/status$/i);
  if (request.method === "POST" && partnerMember) {
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env, "staff_set_partner_member_status", {
      actor_user_id: staff.id, candidate_organization_id: partnerMember[1],
      candidate_user_id: partnerMember[2], status_value: body.status,
    }) });
  }
  if (request.method === "POST" && url.pathname === "/api/staff/campaigns/publish") {
    const body = (await readJson(request, 10_000)) as Record<string, unknown>;
    const campaignId = stringValue(body.campaignId), revisionId = stringValue(body.revisionId);
    if (!campaignId || !revisionId) return json({ ok: false, message: "An exact campaign revision is required." }, 400);
    const preview = await supabaseRpc<Record<string, unknown>>(env, "staff_campaign_revision_preview", {
      actor_user_id: staff.id, candidate_campaign_id: campaignId, candidate_revision_id: revisionId,
    });
    await verifyCampaignRevisionAssets(env, preview);
    return json({ ok: true, result: await supabaseRpc(env, "staff_publish_campaign_revision", {
      actor_user_id: staff.id, candidate_campaign_id: campaignId, candidate_revision_id: revisionId,
    }) });
  }
  if (request.method === "GET" && url.pathname === "/api/staff/donations") {
    const donations = await supabaseRpc<unknown[]>(env, "staff_search_donations", {
      actor_user_id: staff.id, search_term: (url.searchParams.get("q") || "").slice(0, 160), result_limit: 25,
    });
    return json({ ok: true, donations });
  }
  const match = url.pathname.match(/^\/api\/staff\/donations\/([0-9a-f-]{36})(?:\/(.*))?$/i);
  if (!match) return json({ ok: false, message: "Not found." }, 404);
  const donationId = match[1], action = match[2] || "";
  if (request.method === "GET" && !action) {
    const donation = await supabaseRpc<Record<string, unknown> | null>(env, "staff_get_donation", {
      actor_user_id: staff.id, candidate_donation_id: donationId,
    });
    return donation ? json({ ok: true, donation }) : json({ ok: false, message: "Not found." }, 404);
  }
  if (request.method === "GET" && action === "financials") {
    const financials = await supabaseRpc<Record<string, unknown> | null>(env, "staff_get_donation_financials", {
      actor_user_id: staff.id, candidate_donation_id: donationId,
    });
    return financials ? json({ ok: true, financials }) : json({ ok: false, message: "Not found." }, 404);
  }
  let body: Record<string, unknown>;
  try { body = (await readJson(request, 30_000)) as Record<string, unknown>; }
  catch { return json({ ok: false, message: "Invalid request." }, 400); }
  let result: Record<string, unknown>;
  if (request.method === "POST" && action === "receipt") {
    result = await supabaseRpc(env, "staff_record_receipt", {
      actor_user_id: staff.id, candidate_donation_id: donationId,
      receipt_time: body.receiptTime, package_condition: body.packageCondition,
      device_receipts: body.deviceReceipts,
    });
  } else if (request.method === "POST" && action === "status") {
    result = await supabaseRpc(env, "staff_change_donation_status", {
      actor_user_id: staff.id, candidate_donation_id: donationId,
      new_status: body.status, public_message: body.publicMessage || null,
    });
  } else if (request.method === "POST" && action === "notes") {
    result = await supabaseRpc(env, "staff_add_internal_note", {
      actor_user_id: staff.id, candidate_donation_id: donationId, note_body: body.note,
    });
  } else if (request.method === "POST" && action === "unexpected-devices") {
    result = await supabaseRpc(env, "staff_add_unexpected_device", {
      actor_user_id: staff.id, candidate_donation_id: donationId,
      actual_brand: body.actualBrand, actual_model: body.actualModel,
    });
  } else {
    const device = action.match(/^devices\/([0-9a-f-]{36})$/i);
    if (request.method !== "POST" || !device) return json({ ok: false, message: "Not found." }, 404);
    result = await supabaseRpc(env, "staff_update_device", {
      actor_user_id: staff.id, candidate_donation_id: donationId,
      candidate_device_id: device[1], patch: body,
    });
  }
  const outboxId = stringValue(result.outboxEventId);
  if (outboxId) {
    try {
      await deliverDonationNotification(env, outboxId, action === "receipt" ? "donation.received" : "donation.status_changed", donationId, applicationOrigin(env.DEPLOYMENT_ENVIRONMENT));
      await completeInlineOutbox(env, outboxId);
    } catch { /* The persisted outbox safely retries notification delivery. */ }
  }
  return json({ ok: true, result });
}

async function requireAuthenticated(request: Request, env: WorkerEnv): Promise<SupabaseUser | Response> {
  const user = await authenticatedUser(request, env);
  return user ?? json({ ok: false, message: "Secure sign-in is required." }, 401);
}

async function handleAccountApi(request: Request, env: WorkerEnv, url: URL): Promise<Response> {
  if (request.method === "GET" && !sameOrigin(request)) return json({ ok: false, message: "Request not allowed." }, 403);
  const user = await requireAuthenticated(request, env);
  if (user instanceof Response) return user;
  if (!user.email) return json({ ok: false, message: "A verified email is required." }, 403);
  if (request.method !== "GET" && !csrfAllowed(request)) return json({ ok: false, message: "Request not allowed." }, 403);
  if (request.method === "GET" && url.pathname === "/api/account/session")
    return json({ ok: true, user: { id: user.id, email: user.email } });
  if (request.method === "GET" && url.pathname === "/api/account/profile")
    return json({ ok: true, profile: await supabaseRpc(env, "account_profile", { actor_user_id: user.id }) });
  if (request.method === "POST" && url.pathname === "/api/account/profile") {
    const body = (await readJson(request, 4_000)) as Record<string, unknown>;
    return json({ ok: true, profile: await supabaseRpc(env, "update_account_profile", {
      actor_user_id: user.id, display_name_value: body.displayName || null,
    }) });
  }
  if (request.method === "GET" && url.pathname === "/api/account/donations") {
    const account = await supabaseRpc(env, "donor_account_overview", {
      actor_user_id: user.id,
    });
    return json({ ok: true, account });
  }
  if (request.method === "POST" && url.pathname === "/api/account/claims") {
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    const publicId = stringValue(body.publicId), token = stringValue(body.claimToken);
    if (!publicId || !AGENT_PUBLIC_ID_PATTERN.test(publicId) || !token || token.length !== 43 || !env.DONATION_TRACKING_SECRET) return json({ ok: false, message: "The claim reference is invalid." }, 400);
    const material = await supabaseRpc<TrackingMaterial | null>(env, "get_donation_claim_material", { candidate_public_id: publicId });
    if (!material?.claimNonce || !(await verifyClaimToken(env.DONATION_TRACKING_SECRET, material.donationId, material.claimNonce, token)))
      return json({ ok: false, message: "The claim reference is invalid or expired." }, 404);
    return json({ ok: true, result: await supabaseRpc(env, "claim_donation", {
      actor_user_id: user.id, candidate_donation_id: material.donationId, verified_email: user.email,
    }) });
  }
  const mailed = url.pathname.match(/^\/api\/account\/donations\/([0-9a-f-]{36})\/mailed$/i);
  if (request.method === "POST" && mailed) {
    const body = (await readJson(request, 8_000)) as Record<string, unknown>;
    const result = await supabaseRpc(env, "donor_mark_donation_mailed", {
      actor_user_id: user.id,
      candidate_donation_id: mailed[1], carrier_name: body.carrier || null,
      tracking_value: body.trackingNumber || null,
    });
    return json({ ok: true, result });
  }
  return json({ ok: false, message: "Not found." }, 404);
}

async function handlePartnerApplication(request: Request, env: WorkerEnv): Promise<Response> {
  if (!operationalDataConfigured(env))
    return json({ ok: false, code: "operational_data_unavailable", message: "Partnership applications are temporarily unavailable." }, 503);
  if (!browserMutationOriginAllowed(request)) return json({ ok: false, message: "Request not allowed." }, 403);
  if (!(await anonymousRateAllowed(request, env, "partner_application", 5, 3600)))
    return json({ ok: false, message: "Too many applications were submitted. Please try again later." }, 429);
  if (!isJsonContentType(request.headers.get("content-type")))
    return json({ ok: false, message: "Expected a JSON request." }, 415);
  const length = Number(request.headers.get("content-length") || 0);
  if (!Number.isSafeInteger(length) || length < 0 || length > 18_000)
    return json({ ok: false, message: "The application is too large." }, 413);
  let body: Record<string, unknown>;
  try {
    const parsed = await readJson(request, 18_000);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_partner_application");
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ ok: false, message: "The application could not be read." }, 400);
  }
  const contactName = stringValue(body.contactName);
  const roleTitle = stringValue(body.role);
  const email = stringValue(body.email)?.toLowerCase();
  const organizationName = stringValue(body.organizationName);
  const website = stringValue(body.website);
  const audience = stringValue(body.audience);
  const goal = stringValue(body.goal);
  const timing = stringValue(body.timing);
  const idempotencyKey = stringValue(body.idempotencyKey);
  const consent = body.consent === true;
  const turnstileToken = stringValue(body.turnstileToken);
  let websiteUrl: URL | null = null;
  try { websiteUrl = website ? new URL(website) : null; } catch { websiteUrl = null; }
  const valid = contactName && contactName.length <= 160 && roleTitle && roleTitle.length <= 160
    && email && email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && organizationName && organizationName.length <= 200
    && websiteUrl?.protocol === "https:" && websiteUrl.username === "" && websiteUrl.password === ""
    && audience && audience.length <= 2000 && goal && goal.length <= 2000 && timing && timing.length <= 500
    && idempotencyKey && idempotencyKey.length >= 16 && idempotencyKey.length <= 200 && consent;
  if (!valid) return json({ ok: false, message: "Please complete every application field and try again." }, 400);
  if (env.DEPLOYMENT_ENVIRONMENT !== "beta" && !(await verifyTurnstile(request, env, turnstileToken, "partner_application")))
    return json({ ok: false, message: "Security verification could not be completed. Please try again." }, 403);
  const result = await supabaseRpc<Record<string, unknown>>(env, "submit_partner_application", {
    contact_name_value: contactName, role_title_value: roleTitle, email_value: email,
    organization_name_value: organizationName, website_value: websiteUrl!.toString(),
    audience_value: audience, goal_value: goal, timing_value: timing, consent_value: true,
    session_hash_value: await anonymousSessionKey(request, env), idempotency_value: idempotencyKey,
  });
  return json({ ok: true, application: result }, 202);
}

type PartnerAssetKind = "campaign" | "organization";

async function handlePartnerAssetUpload(
  request: Request,
  env: WorkerEnv,
  user: SupabaseUser,
  resourceId: string,
  resourceKind: PartnerAssetKind,
): Promise<Response> {
  const length = Number(request.headers.get("content-length") || 0);
  if (!Number.isSafeInteger(length) || length <= 0 || length > CAMPAIGN_ASSET_MAX_BYTES + 20_000)
    return json({ ok: false, message: "Use a JPG, PNG, or WebP image under 5 MB." }, 413);
  const form = await request.formData();
  const file = form.get("file");
  const altText = stringValue(form.get("altText")) || "";
  const decorative = form.get("decorative") === "true";
  const assetKind = stringValue(form.get("assetKind")) || (resourceKind === "campaign" ? "hero_image" : "hero_image");
  const allowedKinds = resourceKind === "campaign" ? ["hero_image", "supporting_image"] : ["logo", "hero_image"];
  if (!(file instanceof File) || !CAMPAIGN_ASSET_MIME_TYPES.has(file.type) || !allowedKinds.includes(assetKind)
    || file.size < 1 || file.size > CAMPAIGN_ASSET_MAX_BYTES || (!decorative && !altText) || altText.length > 300)
    return json({ ok: false, message: "Use a supported image with concise descriptive alt text." }, 400);
  const sanitized = sanitizeImageUpload(file.type, new Uint8Array(await file.arrayBuffer()));
  const extension = sanitized.mimeType === "image/jpeg" ? "jpg" : sanitized.mimeType === "image/png" ? "png" : "webp";
  const storagePath = `${resourceKind === "campaign" ? "campaigns" : "organizations"}/${resourceId}/${crypto.randomUUID()}.${extension}`;
  const bucket = resourceKind === "campaign" ? "campaign-assets" : "partner-assets";
  const preflightFunction = resourceKind === "campaign" ? "partner_campaign_workspace" : "partner_profile_detail";
  const preflightBody = resourceKind === "campaign"
    ? { actor_user_id: user.id, candidate_campaign_id: resourceId }
    : { actor_user_id: user.id, candidate_organization_id: resourceId };
  await supabaseRpc(env, preflightFunction, preflightBody);
  await uploadPrivateAsset(env, bucket, storagePath, sanitized.bytes, sanitized.mimeType);
  try {
    const asset = await supabaseRpc<{ id: string; previewUrl: string }>(env,
      resourceKind === "campaign" ? "partner_register_campaign_asset" : "partner_register_organization_asset", {
        actor_user_id: user.id,
        ...(resourceKind === "campaign" ? { candidate_campaign_id: resourceId } : { candidate_organization_id: resourceId }),
        asset_kind_value: assetKind, storage_path_value: storagePath, mime_type_value: sanitized.mimeType,
        byte_size_value: sanitized.bytes.length, width_value: sanitized.width, height_value: sanitized.height,
        alt_text_value: decorative ? "" : altText, decorative_value: decorative,
        content_sha256_value: await sha256BytesHex(sanitized.bytes),
      });
    return json({ ok: true, asset: { ...asset, assetKind, altText, decorative, width: sanitized.width, height: sanitized.height } }, 201);
  } catch (error) {
    await deletePrivateAssetObject(env, bucket, storagePath);
    throw error;
  }
}

async function servePartnerAsset(env: WorkerEnv, user: SupabaseUser, assetId: string, kind: PartnerAssetKind): Promise<Response> {
  const asset = await supabaseRpc<{ storagePath: string; mimeType: string; contentSha256: string } | null>(env,
    kind === "campaign" ? "partner_campaign_asset" : "partner_organization_asset",
    { actor_user_id: user.id, candidate_asset_id: assetId });
  if (!asset) return json({ ok: false, message: "Asset not found." }, 404);
  const stored = await getPrivateAssetObject(env, kind === "campaign" ? "campaign-assets" : "partner-assets", asset.storagePath);
  if (!stored.ok || !stored.body) return json({ ok: false, message: "Asset unavailable." }, 404);
  const bytes = await readBoundedResponseBytes(stored);
  if (await sha256BytesHex(bytes) !== asset.contentSha256) return json({ ok: false, message: "Asset verification failed." }, 409);
  return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { headers: { "content-type": asset.mimeType, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}

function withAbsoluteToolkit<T extends Record<string, any>>(workspace: T, origin: string): T {
  const toolkit = workspace?.toolkit;
  if (!toolkit || typeof toolkit !== "object") return workspace;
  const absolute = (value: unknown) => typeof value === "string" && value.startsWith("/") ? `${origin}${value}` : value;
  return { ...workspace, toolkit: { ...toolkit, canonicalUrl: absolute(toolkit.canonicalUrl),
    vanityUrl: absolute(toolkit.vanityUrl), sourceLinks: Object.fromEntries(Object.entries(toolkit.sourceLinks || {}).map(([key,value]) => [key,absolute(value)])) } };
}

async function handlePartnerApi(request: Request, env: WorkerEnv, url: URL): Promise<Response> {
  if (request.method === "GET" && !sameOrigin(request)) return json({ ok: false, message: "Request not allowed." }, 403);
  const user = await requireAuthenticated(request, env);
  if (user instanceof Response) return user;
  if (request.method !== "GET" && !csrfAllowed(request)) return json({ ok: false, message: "Request not allowed." }, 403);
  if (request.method === "GET" && url.pathname === "/api/partner/session")
    return json({ ok: true, user: { id: user.id } });
  if (request.method === "GET" && url.pathname === "/api/partner/overview")
    return json({ ok: true, partner: await supabaseRpc(env, "partner_workspace", { actor_user_id: user.id }) });

  const privateCampaignAsset = url.pathname.match(/^\/api\/partner\/campaign-assets\/([0-9a-f-]{36})$/i);
  if (request.method === "GET" && privateCampaignAsset) return servePartnerAsset(env, user, privateCampaignAsset[1], "campaign");
  const privateOrganizationAsset = url.pathname.match(/^\/api\/partner\/organization-assets\/([0-9a-f-]{36})$/i);
  if (request.method === "GET" && privateOrganizationAsset) return servePartnerAsset(env, user, privateOrganizationAsset[1], "organization");

  const profile = url.pathname.match(/^\/api\/partner\/organizations\/([0-9a-f-]{36})\/profile$/i);
  if (request.method === "GET" && profile)
    return json({ ok: true, profile: await supabaseRpc(env, "partner_profile_detail", { actor_user_id: user.id, candidate_organization_id: profile[1] }) });
  if (request.method === "PATCH" && profile) {
    const body = (await readJson(request, 24_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env, "partner_save_profile_draft", {
      actor_user_id: user.id, candidate_organization_id: profile[1], expected_lock_version: body.lockVersion,
      mission_value: body.mission, summary_value: body.summary, website_value: body.website,
      locality_value: body.locality || null, region_value: body.region || null,
      country_value: body.countryCode || "US", logo_asset_value: body.logoAssetId || null,
      hero_asset_value: body.heroAssetId || null,
    }) });
  }
  const profileReview = url.pathname.match(/^\/api\/partner\/organizations\/([0-9a-f-]{36})\/profile\/review$/i);
  if (request.method === "POST" && profileReview)
    return json({ ok: true, result: await supabaseRpc(env, "partner_submit_profile_review", { actor_user_id: user.id, candidate_organization_id: profileReview[1] }) }, 201);
  const organizationAssets = url.pathname.match(/^\/api\/partner\/organizations\/([0-9a-f-]{36})\/assets$/i);
  if (request.method === "POST" && organizationAssets) return handlePartnerAssetUpload(request, env, user, organizationAssets[1], "organization");
  const deleteOrganizationAsset = url.pathname.match(/^\/api\/partner\/organizations\/([0-9a-f-]{36})\/assets\/([0-9a-f-]{36})$/i);
  if (request.method === "DELETE" && deleteOrganizationAsset) {
    const result = await supabaseRpc<{ storagePath: string }>(env, "partner_delete_organization_asset", {
      actor_user_id: user.id, candidate_organization_id: deleteOrganizationAsset[1], candidate_asset_id: deleteOrganizationAsset[2],
    });
    await deletePrivateAssetObject(env, "partner-assets", result.storagePath);
    return json({ ok: true });
  }

  const invitations = url.pathname.match(/^\/api\/partner\/organizations\/([0-9a-f-]{36})\/invitations$/i);
  if (request.method === "POST" && invitations) {
    const body = (await readJson(request, 5_000)) as Record<string, unknown>;
    return json({ ok: true, invitation: await supabaseRpc(env, "partner_invite_member", {
      actor_user_id: user.id, candidate_organization_id: invitations[1], email_value: body.email, role_value: body.role,
    }) }, 201);
  }
  const invitation = url.pathname.match(/^\/api\/partner\/organizations\/([0-9a-f-]{36})\/invitations\/([0-9a-f-]{36})$/i);
  if (request.method === "DELETE" && invitation)
    return json({ ok: true, result: await supabaseRpc(env, "partner_revoke_invitation", {
      actor_user_id: user.id, candidate_organization_id: invitation[1], candidate_invitation_id: invitation[2],
    }) });
  const member = url.pathname.match(/^\/api\/partner\/organizations\/([0-9a-f-]{36})\/members\/([0-9a-f-]{36})$/i);
  if (request.method === "PATCH" && member) {
    const body = (await readJson(request, 3_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env, "partner_set_member_status", {
      actor_user_id: user.id, candidate_organization_id: member[1], candidate_user_id: member[2], status_value: body.status,
    }) });
  }

  if (request.method === "POST" && url.pathname === "/api/partner/campaigns") {
    const body = (await readJson(request, 45_000)) as Record<string, unknown>;
    const result = await supabaseRpc(env, "partner_create_campaign_v2", {
      actor_user_id: user.id, candidate_organization_id: body.organizationId,
      candidate_charity_id: body.charityId, campaign_slug: body.slug, campaign_name: body.name,
      headline_value: body.headline, summary_value: body.summary, story_value: body.story,
      cta_value: body.ctaLabel || "Donate a Phone", phone_goal_value: body.phoneGoal || null,
      starts_at_value: body.startsAt || null, ends_at_value: body.endsAt || null,
      timezone_value: body.timezone || "America/New_York", blocks_value: body.blocks || [], toolkit_value: body.toolkit || {},
    });
    return json({ ok: true, result }, 201);
  }

  const slugAvailability = url.pathname.match(/^\/api\/partner\/organizations\/([0-9a-f-]{36})\/campaign-slugs\/([a-z0-9-]+)$/i);
  if (request.method === "GET" && slugAvailability)
    return json({ ok: true, available: await supabaseRpc(env, "partner_campaign_slug_available", {
      actor_user_id: user.id, candidate_organization_id: slugAvailability[1], candidate_slug: slugAvailability[2],
    }) });
  const campaign = url.pathname.match(/^\/api\/partner\/campaigns\/([0-9a-f-]{36})$/i);
  if (request.method === "GET" && campaign) {
    const workspace = await supabaseRpc<Record<string, any>>(env, "partner_campaign_workspace", { actor_user_id: user.id, candidate_campaign_id: campaign[1] });
    return json({ ok: true, workspace: withAbsoluteToolkit(workspace, applicationOrigin(env.DEPLOYMENT_ENVIRONMENT)) });
  }
  if (request.method === "PATCH" && campaign) {
    const body = (await readJson(request, 45_000)) as Record<string, unknown>;
    return json({ ok: true, result: await supabaseRpc(env, "partner_save_campaign_draft", {
      actor_user_id: user.id, candidate_campaign_id: campaign[1], expected_lock_version: body.lockVersion,
      stage_value: body.stage, campaign_name_value: body.name, headline_value: body.headline,
      summary_value: body.summary, story_value: body.story, cta_value: body.ctaLabel,
      blocks_value: body.blocks || [], toolkit_value: body.toolkit || {},
      hero_asset_value: body.heroAssetId || null, supporting_asset_value: body.supportingAssetId || null,
      phone_goal_value: body.phoneGoal || null, starts_at_value: body.startsAt || null,
      ends_at_value: body.endsAt || null, timezone_value: body.timezone || "America/New_York",
    }) });
  }
  const campaignReady = url.pathname.match(/^\/api\/partner\/campaigns\/([0-9a-f-]{36})\/ready$/i);
  if (request.method === "POST" && campaignReady)
    return json({ ok: true, result: await supabaseRpc(env, "partner_mark_campaign_ready", { actor_user_id: user.id, candidate_campaign_id: campaignReady[1] }) });
  const campaignReview = url.pathname.match(/^\/api\/partner\/campaigns\/([0-9a-f-]{36})\/review$/i);
  if (request.method === "POST" && campaignReview)
    return json({ ok: true, result: await supabaseRpc(env, "partner_submit_campaign_review", { actor_user_id: user.id, candidate_campaign_id: campaignReview[1] }) }, 201);
  const restore = url.pathname.match(/^\/api\/partner\/campaigns\/([0-9a-f-]{36})\/revisions\/([0-9a-f-]{36})\/restore$/i);
  if (request.method === "POST" && restore)
    return json({ ok: true, result: await supabaseRpc(env, "partner_restore_campaign_revision", {
      actor_user_id: user.id, candidate_campaign_id: restore[1], candidate_revision_id: restore[2],
    }) });
  const campaignAssets = url.pathname.match(/^\/api\/partner\/campaigns\/([0-9a-f-]{36})\/assets$/i);
  if (request.method === "POST" && campaignAssets) return handlePartnerAssetUpload(request, env, user, campaignAssets[1], "campaign");
  const deleteCampaignAsset = url.pathname.match(/^\/api\/partner\/campaigns\/([0-9a-f-]{36})\/assets\/([0-9a-f-]{36})$/i);
  if (request.method === "DELETE" && deleteCampaignAsset) {
    const result = await supabaseRpc<{ storagePath: string }>(env, "partner_delete_unused_campaign_asset", {
      actor_user_id: user.id, candidate_campaign_id: deleteCampaignAsset[1], candidate_asset_id: deleteCampaignAsset[2],
    });
    await deletePrivateAssetObject(env, "campaign-assets", result.storagePath);
    return json({ ok: true });
  }
  const report = url.pathname.match(/^\/api\/partner\/campaigns\/([0-9a-f-]{36})\/report[.]csv$/i);
  if (request.method === "GET" && report) {
    const workspace = await supabaseRpc<{ campaign: { name: string }; metrics: Record<string, number>; financial: Record<string, number | boolean | string> }>(env,
      "partner_campaign_workspace", { actor_user_id: user.id, candidate_campaign_id: report[1] });
    const rows = [
      ["category", "metric", "value"].map(csvCell).join(","),
      ...Object.entries(workspace.metrics).filter(([,value]) => typeof value === "number")
        .map(([key,value]) => ["operations", key, value].map(csvCell).join(",")),
      ...Object.entries(workspace.financial)
        .filter(([,value]) => typeof value === "number" || typeof value === "boolean" || typeof value === "string")
        .map(([key,value]) => ["financial", key, value].map(csvCell).join(",")),
    ];
    return new Response(rows.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="campaign-${report[1]}.csv"`, "cache-control": "no-store" } });
  }
  const qr = url.pathname.match(/^\/api\/partner\/campaigns\/([0-9a-f-]{36})\/qr[.]svg$/i);
  if (request.method === "GET" && qr) {
    const rawWorkspace = await supabaseRpc<{ toolkit: { sourceLinks: { qr: string } } }>(env, "partner_campaign_workspace", {
      actor_user_id: user.id, candidate_campaign_id: qr[1],
    });
    const workspace = withAbsoluteToolkit(rawWorkspace, applicationOrigin(env.DEPLOYMENT_ENVIRONMENT));
    const svg = await QRCode.toString(workspace.toolkit.sourceLinks.qr, { type: "svg", errorCorrectionLevel: "M", margin: 2, width: 512 });
    return new Response(svg, { headers: { "content-type": "image/svg+xml; charset=utf-8", "content-disposition": `attachment; filename="campaign-${qr[1]}-qr.svg"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  }
  return json({ ok: false, message: "Not found." }, 404);
}

const AGENT_FACT_KEYS = new Set([
  "authenticated_sender", "partner_member", "campaign_status", "revision_hash",
  "reviewed", "recipient_kind", "source", "request_class", "data_class",
]);
const AGENT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT_PUBLIC_ID_PATTERN = /^DBM-[0-9]{8}-[A-F0-9]{8}$/;
const AGENT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Treat route values returned by the database as untrusted at the Worker
 * boundary. The table has the same constraint, but this guard keeps a stale
 * or misconfigured RPC from turning a public alias into an unexpected URL.
 */
export function isSafeCampaignSlug(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 120
    && AGENT_SLUG_PATTERN.test(value);
}

function boundedAgentObject(value: unknown, maximum = 50_000): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    return JSON.stringify(value).length <= maximum ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function boundedAgentString(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum
    ? value.trim() : null;
}

function optionalAgentUuid(value: unknown): string | null | false {
  if (value === undefined || value === null || value === "") return null;
  const candidate = boundedAgentString(value, 36);
  return candidate && AGENT_UUID_PATTERN.test(candidate) ? candidate : false;
}

function validAgentIdempotencyKey(value: unknown): string | null {
  const candidate = boundedAgentString(value, 200);
  return candidate && candidate.length >= 8 ? candidate : null;
}

function validateAgentArgumentKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function redactedAgentFacts(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!AGENT_FACT_KEYS.has(key)) continue;
    if (typeof item === "boolean" || typeof item === "number") result[key] = item;
    else if (typeof item === "string" && item.length <= 200) result[key] = item;
  }
  return result;
}

type AgentCommandInput = {
  command: string | undefined;
  risk: string;
  idempotencyKey: string | undefined;
  targetId: string | null;
  agentIdentity: string;
  targetType: string;
  facts: Record<string, unknown>;
  payload: Record<string, unknown>;
  correlationId: string;
};

async function evaluateAgentCommand(env: WorkerEnv, input: AgentCommandInput): Promise<Record<string, unknown>> {
  const { command, risk, idempotencyKey, targetId, agentIdentity, targetType, facts, payload, correlationId } = input;
  if (!isSemanticCommand(command) || !isRiskLevel(risk) || !idempotencyKey)
    throw new Error("Canonical command, risk, and idempotency key are required.");
  const inputHash = await sha256Hex(canonicalAuthorizationInput({
    agentIdentity, command, targetType, targetId, risk, facts, payload,
  }));
  return await supabaseRpc<Record<string, unknown>>(env, "evaluate_agent_command", {
    agent_identity: agentIdentity, command_value: command,
    target_kind: targetType, target_value: targetId, risk_value: risk,
    facts, input_hash_value: inputHash, correlation_value: correlationId,
    idempotency_value: idempotencyKey,
  });
}

async function executeAllowedAgentCommand(
  env: WorkerEnv,
  input: AgentCommandInput,
  decision: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (decision.replayed || decision.outcome !== "ALLOW_AUTOMATICALLY" || !decision.decisionId || !isSemanticCommand(input.command)) return null;
  if (["create_article_draft", "update_article_content", "schedule_article_publication", "publish_article"].includes(input.command)) {
    return await supabaseRpc<Record<string, unknown>>(env, "agent_execute_article_command", {
      decision_id_value: decision.decisionId, agent_identity: input.agentIdentity,
      command_value: input.command, target_id_value: input.targetId, payload_value: input.payload,
    });
  }
  return await supabaseRpc<Record<string, unknown>>(env, "agent_execute_command", {
    decision_id_value: decision.decisionId, agent_identity: input.agentIdentity,
    command_value: input.command, target_id_value: input.targetId, payload_value: input.payload,
  });
}

async function handleAgentCommand(request: Request, env: WorkerEnv): Promise<Response> {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  if (!(await safeSecretEqual(bearer, env.AGENT_API_KEY))) return json({ ok: false, message: "Unauthorized." }, 401);
  if (request.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405);
  const body = boundedAgentObject(await readJson(request, 40_000), 40_000);
  if (!body || !validateAgentArgumentKeys(body, ["agentIdentity", "command", "risk", "idempotencyKey", "targetId", "targetType", "facts", "payload", "correlationId"]))
    return json({ ok: false, message: "The semantic command was rejected." }, 400);
  const requestedAgentIdentity = body.agentIdentity === undefined ? null : boundedAgentString(body.agentIdentity, 80);
  if ((body.agentIdentity !== undefined && !requestedAgentIdentity) || requestedAgentIdentity && requestedAgentIdentity !== REST_AGENT_IDENTITY)
    return json({ ok: false, message: "Agent identity is not authorized for this endpoint." }, 403);
  const payload = body.payload === undefined ? {} : boundedAgentObject(body.payload);
  const targetId = optionalAgentUuid(body.targetId);
  const correlationId = optionalAgentUuid(body.correlationId);
  if (body.payload !== undefined && !payload || targetId === false || correlationId === false)
    return json({ ok: false, message: "The semantic command was rejected." }, 400);
  const input: AgentCommandInput = {
    command: boundedAgentString(body.command, 80) || undefined, risk: boundedAgentString(body.risk, 40) || "moderate",
    idempotencyKey: validAgentIdempotencyKey(body.idempotencyKey) || undefined, targetId: targetId || null,
    agentIdentity: REST_AGENT_IDENTITY,
    targetType: boundedAgentString(body.targetType, 80) || "unknown", facts: redactedAgentFacts(body.facts),
    payload: payload || {}, correlationId: correlationId || crypto.randomUUID(),
  };
  if (!isSemanticCommand(input.command) || !isRiskLevel(input.risk) || !input.idempotencyKey)
    return json({ ok: false, message: "Canonical command, risk, and idempotency key are required." }, 400);
  const decision = await evaluateAgentCommand(env, input);
  const execution = await executeAllowedAgentCommand(env, input, decision);
  return json({ ok: true, decision, execution });
}

async function handleAgentQuery(request: Request, env: WorkerEnv): Promise<Response> {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  if (!(await safeSecretEqual(bearer, env.AGENT_API_KEY))) return json({ ok: false, message: "Unauthorized." }, 401);
  if (request.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405);
  const body = boundedAgentObject(await readJson(request, 12_000), 12_000);
  if (!body || !validateAgentArgumentKeys(body, ["kind", "publicId", "id", "slug"]))
    return json({ ok: false, message: "The agent query was rejected." }, 400);
  const kind = boundedAgentString(body.kind, 40);
  try {
    if (kind === "donation_status" || kind === "donation_history") {
      const publicId = boundedAgentString(body.publicId, 21);
      if (!publicId || !AGENT_PUBLIC_ID_PATTERN.test(publicId)) return json({ ok: false, message: "A donation public ID is required." }, 400);
      const context = await supabaseRpc<Record<string, unknown> | null>(env, "agent_get_donation_context", { candidate_public_id: publicId });
      if (!context) return json({ ok: false, message: "Donation not found." }, 404);
      return json({ ok: true, data: kind === "donation_history" ? { publicId: context.publicId, history: context.history } : context });
    }
    // These compatibility reads accepted only an opaque UUID and therefore
    // had no way to bind a partner or campaign response to the requester's
    // verified identity. Keep the legacy route explicit and fail closed; the
    // identity-bound MCP support tools are the supported agent surface.
    if (kind === "campaign_metrics" || kind === "partner_context")
      return json({ ok: false, code: "legacy_agent_query_removed", message: "Use the identity-bound MCP support tools." }, 410);
    if (kind === "campaign") {
      const slug = boundedAgentString(body.slug, 120);
      if (!slug || slug.length < 3 || !AGENT_SLUG_PATTERN.test(slug)) return json({ ok: false, message: "A campaign slug is required." }, 400);
      const data = await supabaseRpc<Record<string, unknown> | null>(env, "get_public_campaign", { campaign_slug: slug });
      return data ? json({ ok: true, data }) : json({ ok: false, message: "Campaign not found." }, 404);
    }
    return json({ ok: false, message: "Unsupported agent query." }, 400);
  } catch {
    return json({ ok: false, message: "The agent query was rejected." }, 400);
  }
}

function mcpToolResult(id: unknown, data: unknown): Response {
  const serialized = JSON.stringify(data);
  if (typeof serialized !== "string")
    return json({ jsonrpc: "2.0", id, error: { code: -32003, message: "Tool result too large" } }, 400);
  const body = { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: serialized }], structuredContent: data } };
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > MAX_LEGACY_AGENT_TOOL_RESULT_BYTES)
    return json({ jsonrpc: "2.0", id, error: { code: -32003, message: "Tool result too large" } }, 400);
  return json(body);
}

async function handleMcp(request: Request, env: WorkerEnv): Promise<Response> {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  if (!(await safeSecretEqual(bearer, env.AGENT_API_KEY))) return json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }, 401);
  if (!sameOrigin(request)) return json({ jsonrpc: "2.0", error: { code: -32002, message: "Invalid Origin" }, id: null }, 403);
  if (request.method === "GET") return new Response(null, { status: 405, headers: { allow: "POST" } });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST, GET" } });
  let parsed: unknown;
  try {
    parsed = await readJson(request, 50_000);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "Request is too large.";
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: tooLarge ? "Request too large" : "Parse error" } }, tooLarge ? 413 : 400);
  }
  const rpc = boundedAgentObject(parsed, 50_000) as (Record<string, unknown> & { id?: unknown; method?: unknown; params?: unknown }) | null;
  const validId = !rpc || rpc.id === undefined || rpc.id === null || typeof rpc.id === "string" || typeof rpc.id === "number";
  const id = rpc && validId ? (rpc.id ?? null) : null;
  if (!rpc || !validId || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string")
    return json({ jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } }, 400);
  if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (rpc.method === "initialize") return json({ jsonrpc: "2.0", id, result: {
    protocolVersion: "2025-11-25", capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "donate-by-mail-beta", version: "0.3.0" },
    instructions: "Use redacted read tools and semantic commands only. Physical, credential, arbitrary SQL, disbursement execution, and production deployment actions are prohibited.",
  } });
  if (rpc.method === "tools/list") return json({ jsonrpc: "2.0", id, result: { tools: [
    { name: "get_donation_status", description: "Get donor-safe current donation status, shipment last four, devices, charity, and status history without donor contact details.", inputSchema: { type: "object", required: ["publicId"], properties: { publicId: { type: "string" } } }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: "get_donation_history", description: "Get the donor-visible status history for one donation without donor contact details.", inputSchema: { type: "object", required: ["publicId"], properties: { publicId: { type: "string" } } }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: "get_campaign", description: "Get the currently published public campaign content by canonical slug.", inputSchema: { type: "object", required: ["slug"], properties: { slug: { type: "string" } } }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: "list_articles", description: "List published articles without exposing drafts or internal workflow fields.", inputSchema: { type: "object", additionalProperties: false, properties: {} }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: "get_article", description: "Get one published article by canonical slug.", inputSchema: { type: "object", required: ["slug"], properties: { slug: { type: "string" } } }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: "evaluate_semantic_command", description: "Evaluate and, when policy allows, execute a bounded Donate by Mail command. This does not provide arbitrary database access. Support email must use the typed authorization and outbound-message tools on the operations connector.", inputSchema: { type: "object", additionalProperties: false, required: ["command", "targetType", "risk", "idempotencyKey"], properties: {
      command: { type: "string", enum: ["update_campaign_content","publish_campaign_revision","change_donation_status","create_partner_lead","create_internal_note","create_article_draft","update_article_content","schedule_article_publication","publish_article"] }, targetType: { type: "string" }, targetId: { type: "string", format: "uuid" }, risk: { type: "string", enum: RISK_LEVELS }, facts: { type: "object" }, payload: { type: "object" }, idempotencyKey: { type: "string", minLength: 8, maxLength: 200 }, correlationId: { type: "string", format: "uuid" },
    } }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  ] } });
  if (rpc.method === "tools/call") {
    const params = rpc.params && typeof rpc.params === "object" && !Array.isArray(rpc.params) ? rpc.params as Record<string, unknown> : null;
    const name = boundedAgentString(params?.name, 80);
    const args = params?.arguments === undefined ? {} : boundedAgentObject(params.arguments);
    if (!params || !name || !args)
      return json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid tool arguments" } });
    try {
      if (name === "get_donation_status" || name === "get_donation_history") {
        if (!validateAgentArgumentKeys(args, ["publicId"])) return json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid tool arguments" } });
        const publicId = boundedAgentString(args.publicId, 21);
        if (!publicId || !AGENT_PUBLIC_ID_PATTERN.test(publicId)) return json({ jsonrpc: "2.0", id, error: { code: -32602, message: "publicId is required" } });
        const context = await supabaseRpc<Record<string, unknown> | null>(env, "agent_get_donation_context", { candidate_public_id: publicId });
        if (!context) return json({ jsonrpc: "2.0", id, error: { code: -32004, message: "Donation not found" } });
        return mcpToolResult(id, name === "get_donation_history" ? { publicId: context.publicId, history: context.history } : context);
      }
      if (name === "get_campaign") {
        if (!validateAgentArgumentKeys(args, ["slug"])) return json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid tool arguments" } });
        const slug = boundedAgentString(args.slug, 120);
        if (!slug || slug.length < 3 || !AGENT_SLUG_PATTERN.test(slug)) return json({ jsonrpc: "2.0", id, error: { code: -32602, message: "slug is required" } });
        const data = await supabaseRpc<Record<string, unknown> | null>(env, "get_public_campaign", { campaign_slug: slug });
        return data ? mcpToolResult(id, data) : json({ jsonrpc: "2.0", id, error: { code: -32004, message: "Campaign not found" } });
      }
      if (name === "list_articles") {
        return mcpToolResult(id, await supabaseRpc(env, "get_published_articles", {}));
      }
      if (name === "get_article") {
        if (!validateAgentArgumentKeys(args, ["slug"])) return json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid tool arguments" } });
        const slug = boundedAgentString(args.slug, 120);
        if (!slug || slug.length < 3 || !AGENT_SLUG_PATTERN.test(slug)) return json({ jsonrpc: "2.0", id, error: { code: -32602, message: "slug is required" } });
        const data = await supabaseRpc<Record<string, unknown> | null>(env, "get_published_article", { candidate_slug: slug });
        return data ? mcpToolResult(id, data) : json({ jsonrpc: "2.0", id, error: { code: -32004, message: "Article not found" } });
      }
      if (name === "evaluate_semantic_command") {
        if (!validateAgentArgumentKeys(args, ["command", "targetType", "targetId", "risk", "facts", "payload", "idempotencyKey", "correlationId"]))
          return json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid tool arguments" } });
        const targetId = optionalAgentUuid(args.targetId);
        const correlationId = optionalAgentUuid(args.correlationId);
        const payload = args.payload === undefined ? {} : boundedAgentObject(args.payload);
        const targetType = boundedAgentString(args.targetType, 80);
        if (targetId === false || correlationId === false || !targetType || (args.payload !== undefined && !payload))
          return json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid tool arguments" } });
        const input: AgentCommandInput = {
          command: boundedAgentString(args.command, 80) || undefined, risk: boundedAgentString(args.risk, 40) || "moderate", idempotencyKey: validAgentIdempotencyKey(args.idempotencyKey) || undefined, targetId: targetId || null,
          agentIdentity: "workspace-agent-beta", targetType, facts: redactedAgentFacts(args.facts), payload: payload || {}, correlationId: correlationId || crypto.randomUUID(),
        };
        if (!isSemanticCommand(input.command) || input.command === "send_message" || !isRiskLevel(input.risk) || !input.idempotencyKey)
          return json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid tool arguments" } });
        const decision = await evaluateAgentCommand(env, input);
        const execution = await executeAllowedAgentCommand(env, input, decision);
        return mcpToolResult(id, { decision, execution });
      }
    } catch {
      return json({ jsonrpc: "2.0", id, error: { code: -32003, message: "Tool execution failed" } }, 400);
    }
  }
  return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
}

type OutboxEvent = { id: string; handler_key: string; event_type: string; payload: { donationId?: string; invitationId?: string; applicationId?: string } };
export const OUTBOX_BATCH_SIZE = 5;
export const OUTBOX_LEASE_SECONDS = 300;

export async function processOutbox(env: WorkerEnv): Promise<void> {
  // Do not claim durable work when a provider or release-control secret is
  // absent. Leaving the event pending lets an operator repair configuration
  // without creating a burst of avoidable failed attempts and leases.
  if (!operationalDataConfigured(env) || productionConfigurationErrors(env).length > 0) return;
  const workerId = `scheduled-${crypto.randomUUID()}`;
  // Each event can require multiple bounded provider calls. Keep the claim
  // small enough that a slow batch does not outlive its lease and get claimed
  // by a second scheduler while the first invocation is still sending.
  const events = await supabaseRpc<OutboxEvent[]>(env, "claim_outbox_events", {
    worker_id: workerId, batch_size: OUTBOX_BATCH_SIZE, lease_seconds: OUTBOX_LEASE_SECONDS,
  });
  for (const event of events) {
    try {
      await dispatchOutboxEvent(env, event, env.DEPLOYMENT_ENVIRONMENT === "production"
        ? "https://donatebymail.org" : "https://beta.donatebymail.org");
      await supabaseRpc(env, "complete_outbox_event", { event_id: event.id, worker_id: workerId });
    } catch (error) {
      try {
        const unsupported = error instanceof Error && error.message === "unsupported_handler";
        await supabaseRpc(env, "fail_outbox_event", {
          event_id: event.id, worker_id: workerId,
          retry_at: new Date(Date.now() + 5 * 60_000).toISOString(),
          error_code: unsupported ? "unsupported_handler" : "delivery_failed",
          retryable: !unsupported,
        });
      } catch (failureError) {
        // A transient failure while recording the retry state must not prevent
        // the remaining claimed events from being attempted. The lease will
        // expire and the next scheduler invocation can reclaim this event.
        console.error(JSON.stringify({
          event: "outbox_retry_record_failed",
          reason: failureError instanceof Error ? failureError.message : "unknown",
        }));
      }
    }
  }
}

export async function processScheduledArticles(env: WorkerEnv): Promise<void> {
  if (!supabaseBaseUrl(env) || !env.SUPABASE_SECRET_KEY) return;
  await supabaseRpc(env, "publish_due_articles", {});
}

const PUBLIC_SITEMAP_PATHS = [
  "/",
  "/articles",
  "/donate-phone.html",
  "/how-it-works.html",
  "/prepare-phone.html",
  "/receipts.html",
  "/data-security.html",
  "/for-nonprofits.html",
  "/about.html",
  "/team.html",
  "/get-involved.html",
  "/phone-drives.html",
  "/resources.html",
  "/transparency.html",
  "/contact.html",
  "/privacy.html",
  "/terms.html",
  "/accessibility.html",
] as const;

const NON_INDEXABLE_PATHS = new Set([
  "/login",
  "/account",
  "/settings",
  "/staff",
  "/partner",
  "/auth/confirm",
  "/auth/mfa",
  "/track",
]);

function normalizedPath(pathname: string): string {
  const value = pathname.replace(/\/+$/, "");
  return value || "/";
}

export function isKnownHtmlPath(pathname: string): boolean {
  const path = normalizedPath(pathname);
  if (path === "/index.html" || path === "/donate-phone" || path === "/donate-phone.html"
    || path === "/articles" || path === "/articles.html" || path === "/partner/apply" || path === "/auth/confirm") return true;
  if ((PUBLIC_SITEMAP_PATHS as readonly string[]).some((publicPath) =>
    publicPath === path || (publicPath.endsWith(".html") && publicPath.slice(0, -5) === path))) return true;
  return /^\/articles\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path)
    || /^\/c\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path)
    || /^\/nonprofits\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path)
    || /^\/partner\/campaigns\/[0-9a-f-]{36}\/flyer$/i.test(path)
    || NON_INDEXABLE_PATHS.has(path);
}

/** Public HTML shells contain no session-specific data and may be edge-cached. */
export function isPublicHtmlCachePath(pathname: string): boolean {
  const path = normalizedPath(pathname);
  return (PUBLIC_SITEMAP_PATHS as readonly string[]).includes(path)
    || path === "/partner/apply"
    || /^\/articles\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path)
    || /^\/c\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path)
    || /^\/nonprofits\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path);
}

export function escapeXml(value: string): string {
  return value.replace(/[<>&'\"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    "\"": "&quot;",
  })[character] ?? character);
}

export function buildRobotsTxt(environment: WorkerEnv["DEPLOYMENT_ENVIRONMENT"]): string {
  if (environment === "beta") return "User-agent: *\nDisallow: /\n";
  return [
    "User-agent: *",
    "Allow: /",
    "",
    "Sitemap: https://donatebymail.org/sitemap.xml",
    "",
  ].join("\n");
}

export async function buildSitemapXml(env: WorkerEnv): Promise<string> {
  const urls: Array<{ path: string; lastmod?: string }> = PUBLIC_SITEMAP_PATHS.map((path) => ({ path }));
  if (env.DEPLOYMENT_ENVIRONMENT !== "beta" && supabaseBaseUrl(env) && env.SUPABASE_SECRET_KEY) {
    try {
      const articles = await supabaseRpc<Array<{ slug?: unknown; publishedAt?: unknown; published_at?: unknown }>>(env, "get_published_articles", {});
      for (const article of articles) {
        const slug = typeof article.slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug)
          ? article.slug
          : null;
        if (!slug) continue;
        const rawDate = article.publishedAt ?? article.published_at;
        const publishedAt = typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(rawDate)
          ? rawDate.slice(0, 10)
          : undefined;
        urls.push({ path: `/articles/${slug}`, lastmod: publishedAt });
      }
      const [campaigns, nonprofits] = await Promise.all([
        supabaseRpc<Array<{ slug?: unknown; publishedAt?: unknown }>>(env, "get_public_campaigns", {}),
        supabaseRpc<Array<{ slug?: unknown; publishedAt?: unknown }>>(env, "get_public_nonprofits", {}),
      ]);
      for (const item of campaigns) if (typeof item.slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug))
        urls.push({ path: `/c/${item.slug}`, lastmod: typeof item.publishedAt === "string" ? item.publishedAt.slice(0, 10) : undefined });
      for (const item of nonprofits) if (typeof item.slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug))
        urls.push({ path: `/nonprofits/${item.slug}`, lastmod: typeof item.publishedAt === "string" ? item.publishedAt.slice(0, 10) : undefined });
    } catch {
      // The static sitemap remains valid if the optional article service is unavailable.
    }
  }
  const body = urls.map(({ path, lastmod }) => [
    "  <url>",
    `    <loc>${escapeXml(`https://donatebymail.org${path}`)}</loc>`,
    lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : "",
    "  </url>",
  ].filter(Boolean).join("\n")).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

type PublicMetadata = { title: string; description: string; canonical: string; image?: string | null; type?: "website" | "article"; structured: Record<string, unknown> };

async function injectPublicMetadata(
  response: Response,
  metadata: PublicMetadata | null,
  campaignAliasSlug?: string,
): Promise<Response> {
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("text/html")) return response;
  const safe = (value: string) => escapeHtml(value);
  let html = await readBoundedResponseText(response, MAX_HTML_RESPONSE_BYTES);
  if (metadata) {
    // The static shell already contains homepage Open Graph/Twitter tags.
    // Remove every route-sensitive instance before inserting the canonical
    // values; duplicate tags are ambiguous to crawlers and can make a
    // campaign or article share with the homepage title/image.
    const routeMeta = [
      ["property", "og:type"], ["property", "og:title"],
      ["property", "og:description"], ["property", "og:url"],
      ["property", "og:image"], ["property", "og:image:alt"],
      ["name", "twitter:card"], ["name", "twitter:title"],
      ["name", "twitter:description"], ["name", "twitter:image"],
      ["name", "twitter:image:alt"],
    ] as const;
    for (const [attribute, value] of routeMeta) {
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      html = html.replace(new RegExp(`<meta\\s+${attribute}=["']${escaped}["'][^>]*>`, "gi"), "");
    }
    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${safe(metadata.title)}</title>`)
      .replace(/<meta\s+name=["']description["'][^>]*>/i, `<meta name="description" content="${safe(metadata.description)}" />`)
      .replace(/<link\s+rel=["']canonical["'][^>]*>/i, "");
  }
  const imageAlt = metadata?.image ? "Donate by Mail phone donation" : "";
  const tags = [
    campaignAliasSlug ? `<meta name="dbm-campaign-slug" content="${safe(campaignAliasSlug)}" />` : "",
    metadata ? `<link rel="canonical" href="${safe(metadata.canonical)}" />` : "",
    metadata ? `<meta property="og:type" content="${metadata.type || "website"}" />` : "",
    metadata ? `<meta property="og:title" content="${safe(metadata.title)}" />` : "",
    metadata ? `<meta property="og:description" content="${safe(metadata.description)}" />` : "",
    metadata ? `<meta property="og:url" content="${safe(metadata.canonical)}" />` : "",
    metadata ? `<meta name="twitter:card" content="${metadata.image ? "summary_large_image" : "summary"}" />` : "",
    metadata?.image ? `<meta property="og:image" content="${safe(metadata.image)}" />` : "",
    imageAlt ? `<meta property="og:image:alt" content="${safe(imageAlt)}" />` : "",
    metadata ? `<meta name="twitter:title" content="${safe(metadata.title)}" />` : "",
    metadata ? `<meta name="twitter:description" content="${safe(metadata.description)}" />` : "",
    metadata?.image ? `<meta name="twitter:image" content="${safe(metadata.image)}" />` : "",
    imageAlt ? `<meta name="twitter:image:alt" content="${safe(imageAlt)}" />` : "",
    metadata ? `<script type="application/ld+json"${metadata.type === "article" ? ' data-article-structured-data="true"' : ""}>${safeJsonLdText(metadata.structured)}</script>` : "",
  ].filter(Boolean).join("");
  if (tags) html = html.replace("</head>", `${tags}</head>`);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  // The body has been read and rebuilt as plain HTML. Compression validators
  // from the original static asset no longer describe this representation.
  headers.delete("content-encoding");
  headers.delete("etag");
  headers.delete("content-md5");
  headers.delete("content-range");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

function publicAssetMetadataUrl(value: unknown, environment: WorkerEnv["DEPLOYMENT_ENVIRONMENT"], prefix: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const origin = applicationOrigin(environment);
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password || url.search || url.hash
      || !new RegExp(`^${prefix}[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, "i").test(url.pathname))
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

function metadataText(value: unknown, fallback: string, maximum: number): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : fallback;
}

function metadataHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export async function metadataForPublicPath(url: URL, env: WorkerEnv): Promise<PublicMetadata | null> {
  if (!operationalDataConfigured(env)) return null;
  const campaign = url.pathname.match(/^\/c\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
  if (campaign) {
    const value = await supabaseRpc<Record<string, unknown> | null>(env, "get_public_campaign", { campaign_slug: campaign[1] });
    if (!value) return null;
    const headline = metadataText(value.headline, "Phone donation campaign", 180);
    const title = `${headline} | Donate by Mail`;
    const description = metadataText(value.summary, "Donate a phone to support a nonprofit campaign.", 180);
    const charityName = metadataText(value.charityName, "a verified nonprofit", 240);
    const canonical = `https://donatebymail.org/c/${campaign[1]}`;
    const image = publicAssetMetadataUrl(value.heroImageUrl, env.DEPLOYMENT_ENVIRONMENT, "/api/campaign-assets/");
    return { title, description, canonical, image, structured: {
      "@context": "https://schema.org", "@type": "DonateAction", name: headline,
      description, target: canonical, recipient: { "@type": "NGO", name: charityName },
    } };
  }
  const article = url.pathname.match(/^\/articles\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
  if (article) {
    const value = await supabaseRpc<Record<string, unknown> | null>(env, "get_published_article", { candidate_slug: article[1] });
    if (!value) return null;
    const articleTitle = typeof value.title === "string" && value.title.trim() ? value.title.trim() : "Donate by Mail article";
    const title = typeof value.seoTitle === "string" && value.seoTitle.trim()
      ? value.seoTitle.trim() : `${articleTitle} | Donate by Mail`;
    const description = typeof value.seoDescription === "string" && value.seoDescription.trim()
      ? value.seoDescription.trim().slice(0, 180)
      : (typeof value.excerpt === "string" && value.excerpt.trim()
        ? value.excerpt.trim().slice(0, 180)
        : "Practical guidance for donors and nonprofit partners from Donate by Mail.");
    const canonical = `https://donatebymail.org/articles/${article[1]}`;
    const image = "https://donatebymail.org/resources/phone-donation-hero.png";
    const publishedAt = typeof value.publishedAt === "string" ? value.publishedAt : undefined;
    return { title, description, canonical, image, type: "article", structured: {
      "@context": "https://schema.org", "@type": "Article", headline: articleTitle,
      description, author: { "@type": "Organization", name: metadataText(value.authorName, "Donate by Mail", 120) },
      ...(publishedAt ? { datePublished: publishedAt, dateModified: publishedAt } : {}),
      image, mainEntityOfPage: canonical,
      publisher: { "@type": "Organization", name: "Donate by Mail", url: "https://donatebymail.org" },
    } };
  }
  const nonprofit = url.pathname.match(/^\/nonprofits\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
  if (nonprofit) {
    const value = await supabaseRpc<Record<string, unknown> | null>(env, "get_public_nonprofit", { profile_slug: nonprofit[1] });
    if (!value) return null;
    const nonprofitName = metadataText(value.name, "Verified nonprofit", 240);
    const title = `${nonprofitName} phone donation campaigns | Donate by Mail`;
    const description = metadataText(value.summary || value.mission, "Support a verified nonprofit through Donate by Mail.", 180);
    const canonical = `https://donatebymail.org/nonprofits/${nonprofit[1]}`;
    const image = publicAssetMetadataUrl(value.heroImageUrl, env.DEPLOYMENT_ENVIRONMENT, "/api/nonprofit-assets/");
    return { title, description, canonical, image, structured: {
      "@context": "https://schema.org", "@type": "NGO", name: nonprofitName, description,
      ...(metadataHttpsUrl(value.websiteUrl) ? { url: metadataHttpsUrl(value.websiteUrl) } : {}),
      address: { "@type": "PostalAddress", addressLocality: metadataText(value.locality, "", 160) || undefined,
        addressRegion: metadataText(value.region, "", 160) || undefined, addressCountry: metadataText(value.countryCode, "", 2) || undefined },
    } };
  }
  return null;
}

async function routeRequest(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    // Do not rely solely on the zone-level "Always Use HTTPS" switch. A
    // custom-domain misconfiguration must never serve a hosted shell or
    // connector over plaintext HTTP, and a 308 preserves POST bodies for API
    // callers. Local loopback HTTP remains available to the beta integration
    // harness only; it is not a hosted route.
    const loopbackHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if ((env.DEPLOYMENT_ENVIRONMENT === "production" || env.DEPLOYMENT_ENVIRONMENT === "beta")
      && url.protocol === "http:" && !loopbackHost && !isLocalBetaHarness(env, url.hostname)) {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 308);
    }
    const operationalDataEnabled = operationalDataConfigured(env);
    if (request.method === "GET" && url.pathname === "/healthz")
      return json({ ok: true, environment: env.DEPLOYMENT_ENVIRONMENT || "production" });
    if (request.method === "GET" && url.pathname === "/readyz") {
      const configurationErrors = productionConfigurationErrors(env);
      if (!operationalDataEnabled || configurationErrors.length)
        return json({ ok: false, ready: false, environment: env.DEPLOYMENT_ENVIRONMENT || "production",
          code: "configuration_unavailable" }, 503);
      try {
        await supabaseRpc(env, "get_public_nonprofits", {});
        const applicationContract = await supabaseRpc<{ contractVersion?: unknown }>(env, "application_contract_version", {});
        if (applicationContract.contractVersion !== REQUIRED_APPLICATION_CONTRACT_VERSION)
          throw new Error("application_contract_mismatch");
        if (env.DEPLOYMENT_ENVIRONMENT === "beta") {
          const contract = await supabaseRpc<{ contractVersion?: unknown }>(env, "agent_contract_version", {});
          if (contract.contractVersion !== REQUIRED_BETA_AGENT_CONTRACT_VERSION)
            throw new Error("agent_contract_mismatch");
        }
        return json({
          ok: true,
          ready: true,
          environment: env.DEPLOYMENT_ENVIRONMENT || "production",
          applicationContractVersion: REQUIRED_APPLICATION_CONTRACT_VERSION,
          ...(env.DEPLOYMENT_ENVIRONMENT === "beta"
            ? { agentContractVersion: REQUIRED_BETA_AGENT_CONTRACT_VERSION }
            : {}),
        });
      } catch { return json({ ok: false, ready: false }, 503); }
    }
    if (request.method === "GET" && url.pathname === "/ads.txt") {
      return new Response("", { status: 404, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
    }
    if (request.method === "GET" && url.pathname === "/robots.txt") {
      return new Response(buildRobotsTxt(env.DEPLOYMENT_ENVIRONMENT), {
        headers: { "cache-control": "public, max-age=3600", "content-type": "text/plain; charset=utf-8" },
      });
    }
    if (request.method === "GET" && url.pathname === "/sitemap.xml") {
      if (env.DEPLOYMENT_ENVIRONMENT === "beta") return new Response("Not found", { status: 404, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
      return new Response(await buildSitemapXml(env), {
        headers: { "cache-control": "public, max-age=3600", "content-type": "application/xml; charset=utf-8" },
      });
    }
    if (request.method === "POST" && url.pathname === "/api/donations") {
      return handleDonationSubmission(request, env);
    }
    if (operationalDataEnabled && request.method === "POST" && url.pathname === "/api/donations/status")
      return handleTrackingStatus(request, env);
    if (operationalDataEnabled && request.method === "POST" && url.pathname === "/api/staff/auth/magic-link")
      return sendMagicLink(request, env, "/staff", true);
    if (operationalDataEnabled && request.method === "POST" && url.pathname === "/api/account/auth/magic-link")
      return sendMagicLink(request, env, "/account");
    if (operationalDataEnabled && request.method === "POST" && url.pathname === "/api/account/claim-intents")
      return handleClaimHandoff(request, env);
    if (operationalDataEnabled && request.method === "POST" && url.pathname === "/api/partner/auth/magic-link")
      return sendMagicLink(request, env, "/partner");
    if (request.method === "POST" && url.pathname === "/api/partner/applications") {
      try { return await handlePartnerApplication(request, env); }
      catch (error) { return requestFailure(error, "The partnership application could not be submitted."); }
    }
    if (operationalDataEnabled && request.method === "POST" && url.pathname === "/api/auth/confirm")
      return handleAuthConfirmation(request, env);
    if (operationalDataEnabled && request.method === "GET" && url.pathname === "/api/auth/callback")
      return redirectLegacyAuthCallback(request, env);
    if (operationalDataEnabled && request.method === "GET" && url.pathname === "/api/auth/csrf")
      return handleCsrf(request, env);
    if (operationalDataEnabled && request.method === "GET" && url.pathname === "/api/auth/session")
      return handleAuthSessionContext(request, env);
    if (operationalDataEnabled && url.pathname.startsWith("/api/auth/mfa/")) {
      try { return await handleMfaApi(request, env, url); }
      catch (error) { return requestFailure(error, "The security request was rejected."); }
    }
    if (operationalDataEnabled && request.method === "POST" && url.pathname === "/api/auth/logout")
      return handleLogout(request, env);
    if (operationalDataEnabled && url.pathname.startsWith("/api/account/")) {
      try { return await handleAccountApi(request, env, url); }
      catch (error) { return requestFailure(error, "The donor account request was rejected."); }
    }
    if (operationalDataEnabled && url.pathname.startsWith("/api/partner/")) {
      try { return await handlePartnerApi(request, env, url); }
      catch (error) { return requestFailure(error, "The partner request was rejected."); }
    }
    if (url.pathname.startsWith("/api/agent/v1/") && env.DEPLOYMENT_ENVIRONMENT !== "beta")
      return json({ ok: false, code: "agent_disabled_in_production", message: "Agent surface disabled in production." }, 404);
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && operationalDataEnabled && url.pathname === "/api/agent/v1/queries") {
      try { return await handleAgentQuery(request, env); }
      catch { return json({ ok: false, message: "The agent query was rejected." }, 400); }
    }
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && operationalDataEnabled && url.pathname === "/api/agent/v1/commands") {
      try { return await handleAgentCommand(request, env); }
      catch { return json({ ok: false, message: "The semantic command was rejected." }, 400); }
    }
    if (url.pathname === "/mcp" && env.DEPLOYMENT_ENVIRONMENT !== "beta")
      return json({ jsonrpc: "2.0", error: { code: -32003, message: "MCP disabled in production" }, id: null }, 404);
    if (env.DEPLOYMENT_ENVIRONMENT === "beta" && url.pathname === "/mcp") {
      try { return await handleMcp(request, env); }
      catch { return json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }, 500); }
    }
    if (request.method === "GET" && url.pathname === "/api/articles") {
      if (!supabaseBaseUrl(env) || !env.SUPABASE_SECRET_KEY)
        return json({ ok: false, code: "operational_data_unavailable", message: "Articles are temporarily unavailable." }, 503);
      const articles = await supabaseRpc<unknown[]>(env, "get_published_articles", {});
      return json({ ok: true, articles });
    }
    const publicArticle = url.pathname.match(/^\/api\/articles\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
    if (request.method === "GET" && publicArticle) {
      if (!supabaseBaseUrl(env) || !env.SUPABASE_SECRET_KEY)
        return json({ ok: false, code: "operational_data_unavailable", message: "Articles are temporarily unavailable." }, 503);
      const article = await supabaseRpc<Record<string, unknown> | null>(env, "get_published_article", { candidate_slug: publicArticle[1] });
      if (!article) return json({ ok: false, message: "Article not found." }, 404);
      return json({ ok: true, article });
    }
    const publicCampaign = url.pathname.match(/^\/api\/campaigns\/([a-z0-9-]+)$/);
    if (operationalDataEnabled && request.method === "GET" && publicCampaign) {
      const campaign = await supabaseRpc<Record<string, unknown> | null>(env, "get_public_campaign", { campaign_slug: publicCampaign[1] });
      if (!campaign) return json({ ok: false, message: "Campaign not found." }, 404);
      // Enrich the public campaign response server-side. This keeps the
      // Pledge credential and lookup behind the Worker and avoids making a
      // second browser request that may be affected by beta access policy.
      const pledgeId = stringValue(campaign.charityPledgeId);
      // A public campaign URL is itself an anonymous provider-proxy surface:
      // repeated requests could otherwise spend the Pledge credential even
      // though the browser never calls the dedicated lookup route. Keep the
      // campaign available with its canonical database charity fields when
      // the enrichment budget is exhausted or temporarily unavailable.
      const lookupAllowed = pledgeId
        ? await anonymousRateAllowed(request, env, "pledge_lookup", 60, 3600).catch(() => false)
        : false;
      const charity = pledgeId && lookupAllowed ? await lookupOrganization(pledgeId, env).catch(() => null) : null;
      // Never attach a logo or external metadata to a different nonprofit
      // than the verified campaign beneficiary. Staff must refresh the
      // canonical Pledge association before a logo can appear.
      const matchingCharity = charity && pledgeId && charity.pledgeId.toLowerCase() === pledgeId.toLowerCase()
        ? charity
        : null;
      return json({ ok: true, environment: env.DEPLOYMENT_ENVIRONMENT,
        campaign: matchingCharity ? { ...campaign, charity: matchingCharity } : campaign });
    }
    const campaignEvent = url.pathname.match(/^\/api\/campaigns\/([a-z0-9-]+)\/events$/);
    if (operationalDataEnabled && request.method === "POST" && campaignEvent) {
      if (!browserMutationOriginAllowed(request) || !(await anonymousRateAllowed(request, env, "campaign_event", 120, 3600)))
        return json({ ok: false, message: "Event not accepted." }, 429);
      let body: Record<string, unknown>;
      try {
        const parsed = await readJson(request, 3_000);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_campaign_event");
        body = parsed as Record<string, unknown>;
      } catch {
        return json({ ok: false, message: "Invalid event." }, 400);
      }
      const eventType = body.type === "view" || body.type === "donation_started" ? body.type : null;
      const attemptId = typeof body.attemptId === "string" && body.attemptId.length <= 120 ? body.attemptId.trim() : "";
      const sourceCandidate = url.searchParams.get("src") || (typeof body.source === "string" ? body.source : "");
      const source = ["email", "social", "web", "event", "print", "qr", "direct"].includes(sourceCandidate.trim().toLowerCase())
        ? sourceCandidate.trim().toLowerCase() : "direct";
      if (!eventType || (eventType === "donation_started" && !attemptId)) return json({ ok: false, message: "Invalid event." }, 400);
      const session = await anonymousSessionKey(request, env);
      const eventKey = await sha256Hex(`${session}:${eventType}:${eventType === "view" ? "daily" : attemptId}`);
      await supabaseRpc(env, "record_campaign_event", {
        campaign_slug: campaignEvent[1], event_type_value: eventType, event_key_value: eventKey,
        source_value: source,
      });
      return json({ ok: true }, 202);
    }
    const publicCampaignAsset = url.pathname.match(/^\/api\/campaign-assets\/([0-9a-f-]{36})$/i);
    if (operationalDataEnabled && request.method === "GET" && publicCampaignAsset) {
      const asset = await supabaseRpc<{ id: string; storagePath: string; mimeType: string; altText: string; contentSha256: string } | null>(env, "get_public_campaign_asset", { candidate_asset_id: publicCampaignAsset[1] });
      if (!asset) return json({ ok: false, message: "Campaign asset not found." }, 404);
      const stored = await getPrivateAssetObject(env, "campaign-assets", asset.storagePath);
      if (!stored.ok) return json({ ok: false, message: "Campaign asset unavailable." }, 404);
      const bytes = await readBoundedResponseBytes(stored);
      if (await sha256BytesHex(bytes) !== asset.contentSha256) return json({ ok: false, message: "Asset verification failed." }, 409);
      const headers = new Headers({
        "cache-control": "public, max-age=300, stale-while-revalidate=3600",
        "content-type": asset.mimeType,
        "x-content-type-options": "nosniff",
      });
      return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { status: 200, headers });
    }
    const publicNonprofit = url.pathname.match(/^\/api\/nonprofits\/([a-z0-9]+(?:-[a-z0-9]+)*)$/);
    if (operationalDataEnabled && request.method === "GET" && publicNonprofit) {
      const nonprofit = await supabaseRpc<Record<string, unknown> | null>(env, "get_public_nonprofit", { profile_slug: publicNonprofit[1] });
      return nonprofit ? json({ ok: true, environment: env.DEPLOYMENT_ENVIRONMENT || "production", nonprofit }) : json({ ok: false, message: "Nonprofit profile not found." }, 404);
    }
    const publicNonprofitAsset = url.pathname.match(/^\/api\/nonprofit-assets\/([0-9a-f-]{36})$/i);
    if (operationalDataEnabled && request.method === "GET" && publicNonprofitAsset) {
      const asset = await supabaseRpc<{ storagePath: string; mimeType: string; contentSha256: string } | null>(env, "get_public_nonprofit_asset", { candidate_asset_id: publicNonprofitAsset[1] });
      if (!asset) return json({ ok: false, message: "Nonprofit asset not found." }, 404);
      const stored = await getPrivateAssetObject(env, "partner-assets", asset.storagePath);
      if (!stored.ok) return json({ ok: false, message: "Nonprofit asset unavailable." }, 404);
      const bytes = await readBoundedResponseBytes(stored);
      if (await sha256BytesHex(bytes) !== asset.contentSha256) return json({ ok: false, message: "Asset verification failed." }, 409);
      return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { headers: { "content-type": asset.mimeType, "cache-control": "public, max-age=300, stale-while-revalidate=3600", "x-content-type-options": "nosniff" } });
    }
    if (operationalDataEnabled && url.pathname.startsWith("/api/staff/")) {
      try {
        return await handleStaffApi(request, env, url);
      } catch (error) {
        return requestFailure(error, "The staff operation was rejected. Review the values and try again.");
      }
    }
    const organizationMatch = url.pathname.match(
      /^\/api\/pledge\/organizations\/([0-9a-f-]{36})$/i,
    );
    if (request.method === "GET" && organizationMatch) {
      return handleOrganizationLookup(request, env, organizationMatch[1]);
    }
    if (url.pathname.startsWith("/api/"))
      return json({ ok: false, message: "Not found." }, 404);
    if (operationalDataEnabled && request.method === "GET") {
      const vanity = url.pathname.match(/^\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/);
      if (vanity) {
        const alias = await supabaseRpc<{ canonicalSlug: string; behavior: "redirect" | "render" } | null>(
          env, "resolve_campaign_alias", { candidate_slug: vanity[1] },
        );
        const canonicalSlug = isSafeCampaignSlug(alias?.canonicalSlug) ? alias.canonicalSlug : null;
        const behavior = alias?.behavior === "redirect" || alias?.behavior === "render" ? alias.behavior : null;
        if (canonicalSlug && behavior) {
          if (behavior === "redirect")
            return Response.redirect(`${applicationOrigin(env.DEPLOYMENT_ENVIRONMENT)}/c/${canonicalSlug}`, 308);
          const canonicalUrl = new URL(`/c/${canonicalSlug}`, applicationOrigin(env.DEPLOYMENT_ENVIRONMENT));
          const rendered = await env.ASSETS.fetch(new Request(canonicalUrl, request));
          const metadata = await metadataForPublicPath(canonicalUrl, env).catch(() => null);
          return injectPublicMetadata(rendered, metadata, canonicalSlug);
        }
      }
    }
    let response = await env.ASSETS.fetch(request);
    if (request.method === "GET" && response.status === 200) {
      const metadata = await metadataForPublicPath(url, env).catch(() => null);
      if (metadata) response = await injectPublicMetadata(response, metadata);
    }
    if (request.method === "GET" && response.status === 200
      && response.headers.get("content-type")?.toLowerCase().includes("text/html")
      && !isKnownHtmlPath(url.pathname)) {
      return new Response("Not found", {
        status: 404,
        headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" },
      });
    }
    if (env.DEPLOYMENT_ENVIRONMENT !== "beta") return response;

    const headers = new Headers(response.headers);
    headers.set("x-robots-tag", "noindex, nofollow, noarchive");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
}

export function hardened(response: Response, request: Request, env: WorkerEnv): Response {
  const headers = new Headers(response.headers);
  // A small, non-secret build marker lets release smoke tests distinguish the
  // current Worker from a cached/static shell served by an older deployment.
  headers.set("x-dbm-application-contract-version", APPLICATION_CONTRACT_VERSION);
  const pledgeWidgetOrigin = env.DEPLOYMENT_ENVIRONMENT === "beta"
    ? "https://staging.pledge.to"
    : "https://www.pledge.to";
  const pledgeProviderApiOrigin = pledgeApiOrigin(env.DEPLOYMENT_ENVIRONMENT);
  headers.set("content-security-policy", `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' https://challenges.cloudflare.com ${pledgeWidgetOrigin} https://www.googletagmanager.com; script-src-attr 'none'; frame-src https://challenges.cloudflare.com ${pledgeWidgetOrigin}; connect-src 'self' https://challenges.cloudflare.com ${pledgeProviderApiOrigin} https://www.google-analytics.com https://region1.google-analytics.com; img-src 'self' data: https://images.pexels.com https://www.pledge.to https://res.cloudinary.com https://pledgeling-res.cloudinary.com https://www.google-analytics.com; style-src 'self'; style-src-attr 'none'; font-src 'self'; upgrade-insecure-requests`);
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("x-permitted-cross-domain-policies", "none");
  headers.set("cross-origin-resource-policy", "same-origin");
  if (env.DEPLOYMENT_ENVIRONMENT === "production") headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  const path = normalizedPath(new URL(request.url).pathname);
  if (env.DEPLOYMENT_ENVIRONMENT === "beta" || NON_INDEXABLE_PATHS.has(path) || path.startsWith("/partner") || path.startsWith("/api/"))
    headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  if ((path.startsWith("/api/") && !PUBLIC_ASSET_PATH.test(path)) || NON_INDEXABLE_PATHS.has(path) || path.startsWith("/partner") || path === "/healthz" || path === "/readyz")
    headers.set("cache-control", "no-store");
  if (env.DEPLOYMENT_ENVIRONMENT !== "beta" && request.method === "GET" && response.status === 200
    && response.headers.get("content-type")?.toLowerCase().includes("text/html")
    && isPublicHtmlCachePath(path))
    headers.set("cache-control", "public, max-age=60, stale-while-revalidate=300");
  const refreshed = refreshedCookies.get(request);
  if (refreshed) headers.append("set-cookie", refreshed);
  const anonymous = anonymousCookies.get(request);
  if (anonymous) headers.append("set-cookie", anonymous);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    try {
      return hardened(await routeRequest(request, env), request, env);
    } catch (error) {
      // Keep provider/database failures bounded and machine-readable instead
      // of leaking a platform 1101 page to donors or agent callers. The log
      // intentionally excludes URLs, cookies, request bodies, and secrets.
      console.error(JSON.stringify({
        event: "request_failed",
        method: request.method,
        reason: error instanceof Error ? error.message : "unknown",
      }));
      const upstreamStatus = error instanceof Error && "upstreamStatus" in error
        && typeof error.upstreamStatus === "number" ? error.upstreamStatus : 0;
      const status = upstreamStatus >= 400 && upstreamStatus < 500
        && upstreamStatus !== 401 && upstreamStatus !== 403 && upstreamStatus !== 429 ? 400 : 503;
      return hardened(json({ ok: false, message: status === 400
        ? "The request could not be accepted."
        : "The service is temporarily unavailable. Please try again." }, status), request, env);
    }
  },
  async scheduled(_controller: ScheduledController, env: WorkerEnv): Promise<void> {
    const jobs: Array<[string, () => Promise<void>]> = [
      ["anonymous_rate_limit_retention", async () => {
        if (supabaseBaseUrl(env) && env.SUPABASE_SECRET_KEY)
          await supabaseRpc(env, "prune_anonymous_rate_limits", { batch_size: 1000 });
      }],
      ["scheduled_articles", () => processScheduledArticles(env)],
    ];
    if (operationalDataConfigured(env)) {
      jobs.push(
        ["campaign_lifecycles", async () => { await supabaseRpc(env, "advance_campaign_lifecycles", {}); }],
        // Article lifecycle and campaign transitions can remain independent,
        // but notification delivery must wait for a complete provider config.
        ["outbox", () => processOutbox(env)],
      );
    }
    for (const [job, run] of jobs) {
      try {
        await run();
      } catch (error) {
        // Keep independent scheduled jobs moving when one dependency is
        // unavailable. Outbox leases and the database lifecycle state provide
        // the retry/reconciliation boundary for the failed job.
        console.error(JSON.stringify({
          event: "scheduled_job_failed",
          job,
          reason: error instanceof Error ? error.message : "unknown",
        }));
      }
    }
  },
} satisfies ExportedHandler<WorkerEnv>;
