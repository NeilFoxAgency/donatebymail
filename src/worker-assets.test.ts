import { describe, expect, it } from "vitest";
import { buildRobotsTxt, buildSitemapXml, escapeXml, hardened, hasValidCampaignImageSignature, isKnownHtmlPath, sha256BytesHex } from "./worker";

describe("campaign asset integrity", () => {
  it("rejects MIME spoofing and accepts supported image signatures", () => {
    expect(hasValidCampaignImageSignature("image/png", new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false);
    expect(hasValidCampaignImageSignature("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(hasValidCampaignImageSignature("image/png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
    expect(hasValidCampaignImageSignature("image/webp", new TextEncoder().encode("RIFFxxxxWEBP"))).toBe(true);
    expect(hasValidCampaignImageSignature("image/gif", new Uint8Array([71, 73, 70, 56]))).toBe(false);
  });

  it("derives different digests from different reviewed bytes", async () => {
    const first = await sha256BytesHex(new Uint8Array([1, 2, 3]));
    const second = await sha256BytesHex(new Uint8Array([1, 2, 4]));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
  });

  it("keeps beta crawlers out and generates a production sitemap without ad inventory", async () => {
    expect(buildRobotsTxt("beta")).toContain("Disallow: /");
    const sitemap = await buildSitemapXml({ DEPLOYMENT_ENVIRONMENT: "production" } as never);
    expect(sitemap).toContain("https://donatebymail.org/how-it-works.html");
    expect(sitemap).not.toContain("/ads.txt");
    expect(escapeXml("<tag a=\"b\">&")).toBe("&lt;tag a=&quot;b&quot;&gt;&amp;");
  });

  it("sets the production transport and browser security headers", () => {
    const secured = hardened(
      new Response("ok"),
      new Request("https://donatebymail.org/"),
      { DEPLOYMENT_ENVIRONMENT: "production" } as never,
    );
    expect(secured.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(secured.headers.get("content-security-policy")).toContain("style-src 'self'");
    expect(secured.headers.get("content-security-policy")).not.toContain("style-src 'self' 'unsafe-inline'");
    expect(secured.headers.get("x-permitted-cross-domain-policies")).toBe("none");
  });

  it("keeps operational pages private and rejects unknown SPA HTML paths", () => {
    expect(isKnownHtmlPath("/articles/example-story")).toBe(true);
    expect(isKnownHtmlPath("/about")).toBe(true);
    expect(isKnownHtmlPath("/not-a-real-page")).toBe(false);
    const staff = hardened(new Response("staff"), new Request("https://donatebymail.org/staff"), { DEPLOYMENT_ENVIRONMENT: "production" } as never);
    expect(staff.headers.get("x-robots-tag")).toContain("noindex");
    expect(staff.headers.get("cache-control")).toBe("no-store");
    const track = hardened(new Response("track"), new Request("https://donatebymail.org/track"), { DEPLOYMENT_ENVIRONMENT: "production" } as never);
    expect(track.headers.get("x-robots-tag")).toContain("noindex");
    expect(track.headers.get("cache-control")).toBe("no-store");
  });
});
