export const RESERVED_ROOT_SLUGS = new Set([
  "about",
  "accessibility",
  "admin",
  "api",
  "app",
  "auth",
  "c",
  "contact",
  "data-security",
  "donate-phone",
  "favicon",
  "for-nonprofits",
  "get-involved",
  "help",
  "how-it-works",
  "index",
  "llms",
  "partner",
  "phone-drives",
  "prepare-phone",
  "privacy",
  "receipts",
  "resources",
  "robots",
  "security",
  "sitemap",
  "site-shell",
  "team",
  "terms",
  "transparency",
  "www",
]);

const VANITY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type VanityAliasValidation =
  | { valid: true; slug: string }
  | { valid: false; slug: string; reason: "invalid_format" | "reserved" };

export function validateVanityAlias(pathOrSlug: string): VanityAliasValidation {
  const slug = pathOrSlug.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
  if (!VANITY_SLUG_PATTERN.test(slug))
    return { valid: false, slug, reason: "invalid_format" };
  if (RESERVED_ROOT_SLUGS.has(slug))
    return { valid: false, slug, reason: "reserved" };
  return { valid: true, slug };
}
