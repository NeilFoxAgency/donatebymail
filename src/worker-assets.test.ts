import { describe, expect, it, vi } from "vitest";
import worker, { buildRobotsTxt, buildSitemapXml, csvCell, escapeXml, hardened, hasValidCampaignImageSignature, isKnownHtmlPath, isPublicHtmlCachePath, isSafeCampaignSlug, metadataForPublicPath, sha256BytesHex } from "./worker";

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
    expect(secured.headers.get("content-security-policy")).toContain("https://www.pledge.to");
    expect(secured.headers.get("content-security-policy")).not.toContain("https://staging.pledge.to");
    expect(secured.headers.get("x-permitted-cross-domain-policies")).toBe("none");
    expect(secured.headers.get("x-dbm-application-contract-version")).toMatch(/^\d{14}$/);
    const beta = hardened(
      new Response("ok"),
      new Request("https://beta.donatebymail.org/"),
      { DEPLOYMENT_ENVIRONMENT: "beta" } as never,
    );
    const betaCsp = beta.headers.get("content-security-policy") || "";
    expect(betaCsp).toContain("https://staging.pledge.to");
    expect(betaCsp).toContain("https://api-staging.pledge.to");
    expect(betaCsp).not.toContain("https://api.pledge.to");
  });

  it("redirects production plaintext requests before serving any asset or API", async () => {
    const response = await worker.fetch(
      new Request("http://donatebymail.org/"),
      { DEPLOYMENT_ENVIRONMENT: "production" } as never,
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://donatebymail.org/");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
  });

  it("redirects hosted beta plaintext requests before serving any connector or asset", async () => {
    const response = await worker.fetch(
      new Request("http://beta.donatebymail.org/donate-phone.html"),
      { DEPLOYMENT_ENVIRONMENT: "beta" } as never,
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://beta.donatebymail.org/donate-phone.html");
  });

  it("keeps operational pages private and rejects unknown SPA HTML paths", () => {
    expect(isKnownHtmlPath("/articles/example-story")).toBe(true);
    expect(isKnownHtmlPath("/about")).toBe(true);
    expect(isKnownHtmlPath("/auth/mfa")).toBe(true);
    expect(isKnownHtmlPath("/not-a-real-page")).toBe(false);
    const staff = hardened(new Response("staff"), new Request("https://donatebymail.org/staff"), { DEPLOYMENT_ENVIRONMENT: "production" } as never);
    expect(staff.headers.get("x-robots-tag")).toContain("noindex");
    expect(staff.headers.get("cache-control")).toBe("no-store");
    const track = hardened(new Response("track"), new Request("https://donatebymail.org/track"), { DEPLOYMENT_ENVIRONMENT: "production" } as never);
    expect(track.headers.get("x-robots-tag")).toContain("noindex");
    expect(track.headers.get("cache-control")).toBe("no-store");
    const publicAsset = hardened(
      new Response("asset", { headers: { "cache-control": "public, max-age=300, stale-while-revalidate=3600" } }),
      new Request("https://donatebymail.org/api/campaign-assets/00000000-0000-4000-8000-000000000001"),
      { DEPLOYMENT_ENVIRONMENT: "production" } as never,
    );
    expect(publicAsset.headers.get("cache-control")).toContain("public");
    expect(publicAsset.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("only caches explicitly public production HTML shells", () => {
    expect(isPublicHtmlCachePath("/c/spring-drive")).toBe(true);
    expect(isPublicHtmlCachePath("/articles/example-story")).toBe(true);
    expect(isPublicHtmlCachePath("/nonprofits/example-charity")).toBe(true);
    expect(isPublicHtmlCachePath("/account")).toBe(false);
    expect(isPublicHtmlCachePath("/track")).toBe(false);
    const page = hardened(
      new Response("<html></html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
      new Request("https://donatebymail.org/c/spring-drive"),
      { DEPLOYMENT_ENVIRONMENT: "production" } as never,
    );
    expect(page.headers.get("cache-control")).toBe("public, max-age=60, stale-while-revalidate=300");
    const betaPage = hardened(
      new Response("<html></html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
      new Request("https://beta.donatebymail.org/c/spring-drive"),
      { DEPLOYMENT_ENVIRONMENT: "beta" } as never,
    );
    expect(betaPage.headers.get("cache-control")).toBeNull();
  });

  it("builds server-side article metadata from the published revision", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      title: "How to prepare a donated phone", seoTitle: "Prepare a Donated Phone | Donate by Mail",
      seoDescription: "A short, practical checklist for preparing an old phone before mailing it.",
      excerpt: "Prepare an old phone before mailing it.", authorName: "Donate by Mail",
      publishedAt: "2026-08-08T12:00:00.000Z",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    try {
      const metadata = await metadataForPublicPath(
        new URL("https://donatebymail.org/articles/prepare-a-donated-phone"),
        {
          DEPLOYMENT_ENVIRONMENT: "production", SUPABASE_URL: "https://db.supabase.co",
          SUPABASE_PUBLISHABLE_KEY: "public-key", SUPABASE_SECRET_KEY: ["test", "service", "value"].join("-"),
          DONATION_TRACKING_SECRET: "tracking-secret-32-characters-minimum",
          BFF_SESSION_SECRET: "bff-session-secret-32-characters-minimum",
        } as never,
      );
      expect(metadata).toMatchObject({
        title: "Prepare a Donated Phone | Donate by Mail",
        description: "A short, practical checklist for preparing an old phone before mailing it.",
        canonical: "https://donatebymail.org/articles/prepare-a-donated-phone",
        type: "article",
        structured: { "@type": "Article", headline: "How to prepare a donated phone" },
      });
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("/rest/v1/rpc/get_published_article"), expect.objectContaining({ method: "POST" }));
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("renders vanity aliases as the canonical campaign instead of the homepage", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/rest/v1/rpc/resolve_campaign_alias")) {
        return new Response(JSON.stringify({ canonicalSlug: "spring-drive", behavior: "render" }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/rest/v1/rpc/get_public_campaign")) {
        return new Response(JSON.stringify({ headline: "Spring phone drive", summary: "Give a phone a useful next chapter." }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const assetsFetch = vi.fn().mockResolvedValue(new Response(
      "<!doctype html><html><head><title>Donate by Mail</title><meta property=\"og:title\" content=\"Homepage\"><meta name=\"twitter:title\" content=\"Homepage\"></head><body></body></html>",
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    ));
    const env = {
      DEPLOYMENT_ENVIRONMENT: "production",
      SUPABASE_URL: "https://db.supabase.co", SUPABASE_PUBLISHABLE_KEY: "publishable",
      SUPABASE_SECRET_KEY: ["service", "secret"].join("-"), DONATION_TRACKING_SECRET: ["tracking-secret", "32-characters-minimum"].join("-"),
      BFF_SESSION_SECRET: "bff-session-secret-32-characters-minimum",
      ASSETS: { fetch: assetsFetch },
    };
    try {
      const response = await worker.fetch(new Request("https://donatebymail.org/spring-drive"), env as never);
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(body).toContain('name="dbm-campaign-slug" content="spring-drive"');
      expect(body).toContain("Spring phone drive | Donate by Mail");
      expect(body).toContain('<meta name="twitter:title" content="Spring phone drive | Donate by Mail" />');
      expect(body).not.toContain('property="og:title" content="Homepage"');
      expect((body.match(/property="og:title"/g) || []).length).toBe(1);
      expect(assetsFetch).toHaveBeenCalledWith(expect.any(Request));
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("only exposes same-origin verified asset references in social metadata", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/rest/v1/rpc/get_public_campaign")) {
        return new Response(JSON.stringify({
          headline: "Spring phone drive", summary: "Give a phone a useful next chapter.",
          heroImageUrl: "/api/campaign-assets/00000000-0000-4000-8000-000000000001",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("unexpected", { status: 500 });
    });
    const env = {
      DEPLOYMENT_ENVIRONMENT: "production", SUPABASE_URL: "https://db.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "publishable", SUPABASE_SECRET_KEY: ["service", "secret"].join("-"),
      DONATION_TRACKING_SECRET: "tracking-secret-32-characters-minimum",
      BFF_SESSION_SECRET: "bff-session-secret-32-characters-minimum",
    };
    try {
      const metadata = await metadataForPublicPath(new URL("https://donatebymail.org/c/spring-drive"), env as never);
      expect(metadata?.image).toBe("https://donatebymail.org/api/campaign-assets/00000000-0000-4000-8000-000000000001");

      fetchSpy.mockImplementation(async (input) => {
        if (String(input).includes("/rest/v1/rpc/get_public_campaign")) {
          return new Response(JSON.stringify({ headline: "Spring phone drive", heroImageUrl: "https://attacker.example/track.png" }), {
            status: 200, headers: { "content-type": "application/json" },
          });
        }
        return new Response("unexpected", { status: 500 });
      });
      const untrusted = await metadataForPublicPath(new URL("https://donatebymail.org/c/spring-drive"), env as never);
      expect(untrusted?.image).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("fails closed when an alias RPC returns an unsafe canonical route", async () => {
    expect(isSafeCampaignSlug("spring-drive")).toBe(true);
    expect(isSafeCampaignSlug("https://attacker.example")).toBe(false);
    expect(isSafeCampaignSlug("/c/spring-drive")).toBe(false);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("/rest/v1/rpc/resolve_campaign_alias")) {
        return new Response(JSON.stringify({ canonicalSlug: "https://attacker.example", behavior: "redirect" }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const assetsFetch = vi.fn().mockResolvedValue(new Response("shell", {
      status: 200, headers: { "content-type": "text/html; charset=utf-8" },
    }));
    try {
      const response = await worker.fetch(new Request("https://donatebymail.org/spring-drive"), {
        DEPLOYMENT_ENVIRONMENT: "production",
        SUPABASE_URL: "https://db.supabase.co", SUPABASE_PUBLISHABLE_KEY: "publishable",
        SUPABASE_SECRET_KEY: ["service", "secret"].join("-"), DONATION_TRACKING_SECRET: ["tracking-secret", "32-characters-minimum"].join("-"),
        BFF_SESSION_SECRET: "bff-session-secret-32-characters-minimum", ASSETS: { fetch: assetsFetch },
      } as never);
      expect(response.status).toBe(404);
      expect(assetsFetch).toHaveBeenCalled();
      expect(response.headers.get("location")).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("exports partner reports as quoted, formula-neutralized CSV", () => {
    expect(csvCell('=HYPERLINK("https://evil.example")')).toBe('"\'=HYPERLINK(""https://evil.example"")"');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });
});
