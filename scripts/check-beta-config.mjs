import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_BETA_SECRETS = [
  "AGENT_API_KEY",
  "BFF_SESSION_SECRET",
  "BREVO_API_KEY",
  "DONATION_TRACKING_SECRET",
  "MCP_ARTICLE_BEARER_TOKEN",
  "PLEDGE_API_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_URL",
];

const PLACEHOLDER_PUBLIC_VALUES = /(?:placeholder|replace[-_ ]?me|your(?:[-_ ]+[a-z0-9]+){1,6}|example)/i;

/**
 * Beta still needs a real public Pledge widget key.  The beta Worker skips
 * production Turnstile verification, but a missing Pledge key leaves the
 * donor flow unable to select a beneficiary while all backend smoke checks
 * can still appear healthy.
 */
export function validateBetaPublicConfig(environment = process.env) {
  const errors = [];
  const pledgePartnerKey = environment.VITE_PLEDGE_PARTNER_KEY?.trim() || "";
  if (pledgePartnerKey.length < 8) errors.push("VITE_PLEDGE_PARTNER_KEY is missing or malformed.");
  if (PLACEHOLDER_PUBLIC_VALUES.test(pledgePartnerKey)) errors.push("VITE_PLEDGE_PARTNER_KEY is a placeholder value.");
  if (environment.VITE_PLEDGE_ENV !== "sandbox") errors.push("VITE_PLEDGE_ENV must be sandbox for a beta release.");
  return { errors, pledgePartnerKey };
}

export function missingBetaSecrets(names) {
  const present = names instanceof Set ? names : new Set(names);
  return REQUIRED_BETA_SECRETS.filter((name) => !present.has(name));
}

export function remoteBetaSecretNames() {
  const raw = execFileSync("npx", ["wrangler", "secret", "list", "--env", "beta", "--format", "json"], {
    encoding: "utf8",
    timeout: 60_000,
  });
  const values = JSON.parse(raw);
  if (!Array.isArray(values)) throw new Error("Cloudflare returned an invalid beta secret list.");
  return new Set(values.map((item) => item?.name).filter((name) => typeof name === "string"));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const publicConfig = validateBetaPublicConfig();
    const missing = missingBetaSecrets(remoteBetaSecretNames());
    if (publicConfig.errors.length || missing.length) {
      for (const error of publicConfig.errors) console.error(`Beta configuration error: ${error}`);
      if (missing.length) console.error(`Beta deployment refused. Missing Cloudflare secrets: ${missing.join(", ")}`);
      process.exitCode = 1;
    } else {
      console.log("Beta Cloudflare secret preflight passed.");
    }
  } catch (error) {
    console.error(`Beta secret preflight failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}
