import { fileURLToPath } from "node:url";

export const PRODUCTION_ZONE_ID = "135ad51488c46924cd73e0d10855f742";
export const FREE_MANAGED_RULESET_NAME = "Cloudflare Managed Free Ruleset";
const CLOUDFLARE_API_ORIGIN = "https://api.cloudflare.com/client/v4";
const REQUEST_TIMEOUT_MS = 15_000;

function settingMap(settings = []) {
  return new Map(
    (Array.isArray(settings) ? settings : [])
      .filter((setting) => setting && typeof setting.id === "string")
      .map((setting) => [setting.id, setting.value]),
  );
}

function minimumTlsVersion(value) {
  const match = String(value || "").match(/^(\d+)(?:\.(\d+))?$/);
  return match ? Number(`${match[1]}.${match[2] || "0"}`) : 0;
}

function hasFreeManagedRuleset(rulesets = []) {
  return (Array.isArray(rulesets) ? rulesets : []).some((ruleset) =>
    ruleset?.kind === "managed"
      && ruleset?.phase === "http_request_firewall_managed"
      && ruleset?.name === FREE_MANAGED_RULESET_NAME
      && Array.isArray(ruleset?.rules)
      && ruleset.rules.some((rule) => rule?.enabled === true),
  );
}

export function validateProductionEdgeSettings(settings = [], rulesets = []) {
  const values = settingMap(settings);
  const errors = [];
  if (values.get("always_use_https") !== "on")
    errors.push("Cloudflare Always Use HTTPS must be enabled.");
  if (minimumTlsVersion(values.get("min_tls_version")) < 1.2)
    errors.push("Cloudflare minimum TLS version must be 1.2 or newer.");
  if (values.get("browser_check") !== "on")
    errors.push("Cloudflare Browser Integrity Check must be enabled.");

  const securityHeader = values.get("security_header");
  const strictTransportSecurity = securityHeader?.strict_transport_security;
  const maxAge = Number(strictTransportSecurity?.max_age);
  if (!strictTransportSecurity || strictTransportSecurity.enabled !== true
    || !Number.isFinite(maxAge) || maxAge < 31_536_000
    || strictTransportSecurity.include_subdomains !== true)
    errors.push("Cloudflare edge HSTS must be enabled for at least one year with subdomains.");
  if (strictTransportSecurity?.nosniff !== true && securityHeader?.nosniff !== true)
    errors.push("Cloudflare edge nosniff must be enabled.");
  if (values.get("waf") !== "on" && !hasFreeManagedRuleset(rulesets))
    errors.push("Cloudflare managed WAF or the active Free Managed Ruleset must be enabled.");
  if (!["full", "strict"].includes(String(values.get("ssl") || "").toLowerCase()))
    errors.push("Cloudflare SSL mode must be full or strict.");
  return errors;
}

async function readZoneSettings(token, zoneId = process.env.CLOUDFLARE_ZONE_ID || PRODUCTION_ZONE_ID) {
  if (typeof token !== "string" || token.trim().length < 16)
    throw new Error("CLOUDFLARE_API_TOKEN is required for the production edge preflight.");
  if (!/^[0-9a-f]{32}$/i.test(zoneId)) throw new Error("CLOUDFLARE_ZONE_ID is malformed.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("production_edge_timeout"), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${CLOUDFLARE_API_ORIGIN}/zones/${zoneId}/settings`, {
      headers: { authorization: `Bearer ${token.trim()}`, accept: "application/json" },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success || !Array.isArray(body.result))
      throw new Error(`Cloudflare edge settings request failed with HTTP ${response.status}.`);
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

async function readZoneRulesets(token, zoneId = process.env.CLOUDFLARE_ZONE_ID || PRODUCTION_ZONE_ID) {
  if (typeof token !== "string" || token.trim().length < 16)
    throw new Error("CLOUDFLARE_API_TOKEN is required for the production edge preflight.");
  if (!/^[0-9a-f]{32}$/i.test(zoneId)) throw new Error("CLOUDFLARE_ZONE_ID is malformed.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("production_edge_timeout"), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${CLOUDFLARE_API_ORIGIN}/zones/${zoneId}/rulesets`, {
      headers: { authorization: `Bearer ${token.trim()}`, accept: "application/json" },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success || !Array.isArray(body.result))
      throw new Error(`Cloudflare edge rulesets request failed with HTTP ${response.status}.`);
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

export { readZoneSettings, readZoneRulesets };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const [settings, rulesets] = await Promise.all([
      readZoneSettings(process.env.CLOUDFLARE_API_TOKEN),
      readZoneRulesets(process.env.CLOUDFLARE_API_TOKEN),
    ]);
    const errors = validateProductionEdgeSettings(settings, rulesets);
    if (errors.length) {
      for (const error of errors) console.error(`Production edge check failed: ${error}`);
      process.exit(1);
    }
    console.log("Production Cloudflare edge checks passed.");
  } catch (error) {
    console.error(`Production edge lookup failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  }
}
