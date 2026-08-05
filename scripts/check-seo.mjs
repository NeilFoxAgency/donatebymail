import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { SITE_ORIGIN } from "./seo-metadata.mjs";

const root = process.cwd();
const directory = existsSync(resolve(root, "dist")) ? resolve(root, "dist") : root;
const htmlFiles = readdirSync(directory).filter((file) => file.endsWith(".html") && !file.includes("playwright"));
const failures = [];
const get = (html, pattern) => html.match(pattern)?.[1]?.trim() || "";

for (const file of htmlFiles) {
  const html = readFileSync(resolve(directory, file), "utf8");
  const title = get(html, /<title[^>]*>([^<]*)<\/title>/i);
  const description = get(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  const canonical = get(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i);
  const robots = get(html, /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i).toLowerCase();
  const ogUrl = get(html, /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']*)["']/i);
  if (!title || title.length < 10) failures.push(`${file}: missing or too-short title`);
  if (!description || description.length < 50 || description.length > 320) failures.push(`${file}: description should be 50-320 characters`);
  if (!canonical || !canonical.startsWith(`${SITE_ORIGIN}/`)) failures.push(`${file}: canonical must use ${SITE_ORIGIN}`);
  if (robots.includes("noindex")) failures.push(`${file}: public build contains noindex`);
  if (!ogUrl || ogUrl !== canonical) failures.push(`${file}: og:url must equal canonical`);
  if (!/<meta[^>]+property=["']og:image["']/i.test(html)) failures.push(`${file}: missing og:image`);
  for (const image of html.matchAll(/<img\b([^>]*)>/gi)) {
    if (!/\balt=["'][^"']*["']/i.test(image[1])) failures.push(`${file}: image is missing alt text`);
  }
  if (/5e27aa4c670fcbb06b\.v2\.appdeploy\.ai|beta\.donatebymail\.org/i.test(html)) failures.push(`${file}: contains beta or AppDeploy URL`);
}

const sitemapPath = resolve(directory, "sitemap.xml");
if (!existsSync(sitemapPath)) failures.push("sitemap.xml is missing from the build");
else {
  const sitemap = readFileSync(sitemapPath, "utf8");
  if (!sitemap.includes(`${SITE_ORIGIN}/`)) failures.push("sitemap.xml has no production URLs");
  if (/<loc>[^<]*\/ads\.txt<\/loc>/i.test(sitemap)) failures.push("sitemap.xml must not advertise ads.txt");
}
if (existsSync(resolve(directory, "ads.txt"))) failures.push("ads.txt must not be served as a static SPA asset");

if (failures.length) {
  console.error(failures.map((failure) => `SEO: ${failure}`).join("\n"));
  process.exit(1);
}
console.log(`SEO checks passed for ${htmlFiles.length} HTML pages in ${directory}.`);
