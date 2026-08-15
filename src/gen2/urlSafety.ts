export function safeExternalHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

const UUID_PATH = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

/**
 * Keep private media references on the current origin and on one of the
 * explicitly approved asset endpoints.  API responses are untrusted at the
 * browser boundary, even when the Worker normally constructs these values.
 */
export function safePrivateAssetUrl(value: unknown, allowedPrefixes: readonly string[]): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || allowedPrefixes.length === 0) return null;
  try {
    const url = new URL(value, "https://donate-by-mail.invalid");
    if (url.origin !== "https://donate-by-mail.invalid" || url.search || url.hash || url.username || url.password) return null;
    return allowedPrefixes.some((prefix) => {
      if (!prefix.endsWith("/")) return false;
      const expression = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}${UUID_PATH}$`, "i");
      return expression.test(url.pathname);
    }) ? url.pathname : null;
  } catch {
    return null;
  }
}

export function safeInternalRedirect(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.startsWith("/")
    || value.startsWith("//") || value.startsWith("/\\")
    || /[\u0000-\u001f\u007f]/.test(value)
    // Browsers and intermediaries can normalize encoded separators during a
    // redirect. Keep those forms out of a supposedly same-origin handoff.
    || /%(?:2f|2F|5c|5C)/.test(value)) return fallback;
  try {
    const url = new URL(value, "https://donate-by-mail.invalid");
    if (url.origin !== "https://donate-by-mail.invalid" || url.username || url.password) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
