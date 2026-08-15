import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_PRODUCTION_SECRETS = [
  "BFF_SESSION_SECRET",
  "BREVO_API_KEY",
  "DONATION_TRACKING_SECRET",
  "PLEDGE_API_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_URL",
  "TURNSTILE_SECRET_KEY",
];

const TURNSTILE_TEST_SITE_KEYS = new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "1x00000000000000000000BB",
  "2x00000000000000000000BB",
  "3x00000000000000000000FF",
]);
const PLACEHOLDER_PUBLIC_VALUES = /(?:placeholder|replace[-_ ]?me|your(?:[-_ ]+[a-z0-9]+){1,6}|example)/i;

export function validateProductionPublicConfig(environment = process.env) {
  const errors = [];
  const turnstileSiteKey = environment.VITE_TURNSTILE_SITE_KEY?.trim() || "";
  const pledgePartnerKey = environment.VITE_PLEDGE_PARTNER_KEY?.trim() || "";
  if (turnstileSiteKey.length < 20) errors.push("VITE_TURNSTILE_SITE_KEY is missing or malformed.");
  if (PLACEHOLDER_PUBLIC_VALUES.test(turnstileSiteKey)) errors.push("VITE_TURNSTILE_SITE_KEY is a placeholder value.");
  if (TURNSTILE_TEST_SITE_KEYS.has(turnstileSiteKey)) errors.push("A Cloudflare Turnstile test sitekey cannot be deployed to production.");
  if (pledgePartnerKey.length < 8) errors.push("VITE_PLEDGE_PARTNER_KEY is missing or malformed.");
  if (PLACEHOLDER_PUBLIC_VALUES.test(pledgePartnerKey)) errors.push("VITE_PLEDGE_PARTNER_KEY is a placeholder value.");
  if (environment.VITE_PLEDGE_ENV && environment.VITE_PLEDGE_ENV !== "production")
    errors.push("VITE_PLEDGE_ENV must be production for a production release.");
  return { errors, turnstileSiteKey, pledgePartnerKey };
}

export function productionBundleContainsPublicConfig(directory, publicConfig) {
  const files = readdirSync(directory, { recursive: true })
    .filter((entry) => typeof entry === "string" && entry.endsWith(".js"));
  const javascript = files.map((entry) => readFileSync(resolve(directory, entry), "utf8")).join("\n");
  return javascript.includes(publicConfig.turnstileSiteKey)
    && javascript.includes(publicConfig.pledgePartnerKey);
}

/**
 * Every HTML shell must pass through the Worker so its HTTPS, cache, CSP, and
 * release-marker headers cannot be bypassed by the static-assets router.
 * Static JS/CSS/media may still be served directly for edge efficiency.
 */
export function validateWorkerAssetRouting(configText) {
  const blocks = [...String(configText || "").matchAll(/"run_worker_first"\s*:\s*\[([\s\S]*?)\]/g)]
    .map((match) => match[1]);
  const htmlExclusion = /["']!\s*[^"']*\.html["']/i;
  if (blocks.length < 2 || blocks.some((block) => !block.includes('"/*"') || htmlExclusion.test(block)))
    return ["Production deployment refused. Every environment must run the Worker first for HTML shells so security and release headers cannot be bypassed."];
  return [];
}

/** Keep production on the verified custom domains with no workers.dev alias. */
export function validateWorkerDeploymentRouting(configText) {
  const text = String(configText || "");
  const errors = [];
  if (/["']workers_dev["']\s*:\s*true\b/i.test(text))
    errors.push("Production deployment refused. workers.dev must remain disabled for every environment.");
  if (/["']preview_urls["']\s*:\s*true\b/i.test(text))
    errors.push("Production deployment refused. Workers preview URLs must remain disabled for every environment.");
  for (const hostname of ["donatebymail.org", "www.donatebymail.org"]) {
    const escaped = hostname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`['\"]pattern['\"]\\s*:\\s*['\"]${escaped}['\"][\\s\\S]{0,120}['\"]custom_domain['\"]\\s*:\\s*true`, "i").test(text))
      errors.push(`Production deployment refused. The ${hostname} custom domain route is missing.`);
  }
  return errors;
}

function remoteSecretNames() {
  const raw = execFileSync("npx", ["wrangler", "secret", "list", "--env=", "--format", "json"], {
    encoding: "utf8",
    timeout: 60_000,
  });
  const values = JSON.parse(raw);
  if (!Array.isArray(values)) throw new Error("Cloudflare returned an invalid production secret list.");
  return new Set(values.map((item) => item?.name).filter((name) => typeof name === "string"));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const publicConfig = validateProductionPublicConfig();
  const failures = publicConfig.errors.map((error) => `Production configuration error: ${error}`);
  try {
    const wranglerConfig = readFileSync(resolve("wrangler.jsonc"), "utf8");
    failures.push(...validateWorkerAssetRouting(wranglerConfig));
    failures.push(...validateWorkerDeploymentRouting(wranglerConfig));
  } catch (error) {
    failures.push(`Production asset-routing preflight failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  if (process.argv.includes("--remote-secrets")) {
    try {
      const names = remoteSecretNames();
      const missing = REQUIRED_PRODUCTION_SECRETS.filter((name) => !names.has(name));
      if (missing.length) failures.push(`Production deployment refused. Missing Cloudflare secrets: ${missing.join(", ")}`);
    } catch (error) {
      failures.push(`Production secret preflight failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  if (process.argv.includes("--bundle")) {
    if (publicConfig.errors.length) {
      failures.push("Production bundle check skipped because the public browser configuration is invalid.");
    } else {
      try {
        if (!productionBundleContainsPublicConfig(resolve("dist"), publicConfig))
          failures.push("Production deployment refused. The built browser bundle does not contain the approved Turnstile and Pledge public keys.");
      } catch (error) {
        failures.push(`Production bundle preflight failed: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }
  }
  if (failures.length) {
    for (const failure of failures) console.error(failure);
    process.exit(1);
  }
  console.log("Production public configuration and requested release checks passed.");
}
