import { fileURLToPath } from "node:url";

export const PRODUCTION_AUTH_SITE_URL = "https://donatebymail.org";
export const PRODUCTION_AUTH_REDIRECT_URLS = [
  "https://donatebymail.org",
  "https://donatebymail.org/auth/confirm",
  "https://donatebymail.org/api/auth/callback",
];

const ALLOWED_PRODUCTION_AUTH_HOSTS = new Set(["donatebymail.org", "www.donatebymail.org"]);

function normalizeUrls(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "")
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Validate the remote Supabase Auth URL configuration required by production.
 * The repository's local config intentionally targets beta, so production
 * must provide its dashboard/API values explicitly rather than inheriting
 * beta redirects or broad preview wildcards.
 */
export function validateProductionAuthConfig({
  siteUrl = "",
  redirectUrls = [],
} = {}) {
  const errors = [];
  const normalizedSiteUrl = String(siteUrl || "").trim().replace(/\/$/, "");
  const urls = normalizeUrls(redirectUrls).map((url) => url.replace(/\/$/, ""));
  if (normalizedSiteUrl !== PRODUCTION_AUTH_SITE_URL)
    errors.push(`Supabase Auth Site URL must be exactly ${PRODUCTION_AUTH_SITE_URL}.`);
  if (new Set(urls).size !== urls.length)
    errors.push("Supabase Auth redirect URLs must not contain duplicates.");

  for (const required of PRODUCTION_AUTH_REDIRECT_URLS) {
    if (!urls.includes(required)) errors.push(`Supabase Auth is missing the exact redirect URL ${required}.`);
  }
  for (const value of urls) {
    if (value.includes("*") || /beta[.]donatebymail[.]org|localhost|127[.]0[.]0[.]1/i.test(value)) {
      errors.push(`Supabase Auth production redirects cannot target beta, localhost, or wildcard URLs: ${value}.`);
      continue;
    }
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !ALLOWED_PRODUCTION_AUTH_HOSTS.has(url.hostname.toLowerCase())
        || url.username || url.password || url.search || url.hash)
        errors.push(`Supabase Auth production redirect is not an exact HTTPS Donate by Mail URL: ${value}.`);
      else if (!PRODUCTION_AUTH_REDIRECT_URLS.includes(value))
        errors.push(`Supabase Auth production redirect is not on the exact approved list: ${value}.`);
    } catch {
      errors.push(`Supabase Auth production redirect is not a valid URL: ${value}.`);
    }
  }
  return errors;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const errors = validateProductionAuthConfig({
    siteUrl: process.env.SUPABASE_PRODUCTION_AUTH_SITE_URL,
    redirectUrls: process.env.SUPABASE_PRODUCTION_AUTH_REDIRECT_URLS,
  });
  if (errors.length) {
    for (const error of errors) console.error(`Production Supabase Auth check failed: ${error}`);
    process.exit(1);
  }
  console.log("Production Supabase Auth URL configuration passed.");
}
