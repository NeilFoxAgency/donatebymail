const SITE_ORIGIN = "https://donatebymail.org";
const DEFAULT_IMAGE = `${SITE_ORIGIN}/resources/phone-donation-hero.png`;

function attribute(html, selector) {
  const match = html.match(selector);
  return match?.[1]?.trim() || "";
}

function tag(name, content, property = false) {
  const key = property ? `property="${name}"` : `name="${name}"`;
  return `<meta ${key} content="${String(content).replaceAll('"', '&quot;')}" />`;
}

/** Add the metadata Google, social crawlers, and link previews need to static pages. */
export function enhanceStaticHtml(html) {
  const title = attribute(html, /<title[^>]*>([^<]*)<\/title>/i);
  const description = attribute(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  const canonical = attribute(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i) || `${SITE_ORIGIN}/`;
  const existingImage = attribute(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i) || DEFAULT_IMAGE;
  const additions = [];
  if (!/<meta[^>]+name=["']robots["']/i.test(html)) additions.push(tag("robots", "index,follow,max-image-preview:large"));
  if (!/<meta[^>]+property=["']og:type["']/i.test(html)) additions.push(tag("og:type", "website", true));
  if (!/<meta[^>]+property=["']og:site_name["']/i.test(html)) additions.push(tag("og:site_name", "Donate by Mail", true));
  if (!/<meta[^>]+property=["']og:title["']/i.test(html) && title) additions.push(tag("og:title", title, true));
  if (!/<meta[^>]+property=["']og:description["']/i.test(html) && description) additions.push(tag("og:description", description, true));
  if (!/<meta[^>]+property=["']og:url["']/i.test(html)) additions.push(tag("og:url", canonical, true));
  if (!/<meta[^>]+property=["']og:image["']/i.test(html)) additions.push(tag("og:image", existingImage, true));
  if (!/<meta[^>]+property=["']og:image:alt["']/i.test(html)) additions.push(tag("og:image:alt", "Donate by Mail phone donation", true));
  if (!/<meta[^>]+name=["']twitter:card["']/i.test(html)) additions.push(tag("twitter:card", "summary_large_image"));
  if (!/<meta[^>]+name=["']twitter:title["']/i.test(html) && title) additions.push(tag("twitter:title", title));
  if (!/<meta[^>]+name=["']twitter:description["']/i.test(html) && description) additions.push(tag("twitter:description", description));
  if (!/<meta[^>]+name=["']twitter:image["']/i.test(html)) additions.push(tag("twitter:image", existingImage));
  if (!additions.length) return html;
  return html.replace(/<\/head>/i, `${additions.join("\n    ")}\n  </head>`);
}

export { DEFAULT_IMAGE, SITE_ORIGIN };
