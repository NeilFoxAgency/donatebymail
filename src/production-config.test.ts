import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// The production deploy preflight intentionally runs as plain Node ESM.
// @ts-expect-error TypeScript's bundler resolver does not load declarations for imported .mjs scripts.
import { productionBundleContainsPublicConfig, validateProductionPublicConfig, validateWorkerAssetRouting, validateWorkerDeploymentRouting } from "../scripts/check-production-config.mjs";
// @ts-expect-error TypeScript's bundler resolver does not load declarations for imported .mjs scripts.
import { missingBetaSecrets, REQUIRED_BETA_SECRETS, validateBetaPublicConfig } from "../scripts/check-beta-config.mjs";
// @ts-expect-error TypeScript's bundler resolver does not load declarations for imported .mjs scripts.
import { validateProductionDns } from "../scripts/check-production-dns.mjs";
// @ts-expect-error TypeScript's bundler resolver does not load declarations for imported .mjs scripts.
import { validateProductionEdgeSettings } from "../scripts/check-production-edge.mjs";
// @ts-expect-error TypeScript's bundler resolver does not load declarations for imported .mjs scripts.
import { PRODUCTION_AUTH_REDIRECT_URLS, PRODUCTION_AUTH_SITE_URL, validateProductionAuthConfig } from "../scripts/check-production-auth-config.mjs";
import worker, { brevoApiUrl, isLocalBetaHarness, OUTBOX_BATCH_SIZE, OUTBOX_LEASE_SECONDS, pledgeApiOrigin, processOutbox, productionConfigurationErrors, redirectLegacyAuthCallback, requestFailureStatus, supabaseBaseUrl } from "./worker";

const temporaryDirectories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("production release configuration", () => {
  it("keeps the beta deployment secret preflight aligned with the Worker contract", () => {
    expect(REQUIRED_BETA_SECRETS).toEqual(expect.arrayContaining([
      "AGENT_API_KEY", "BFF_SESSION_SECRET", "BREVO_API_KEY", "DONATION_TRACKING_SECRET",
      "MCP_ARTICLE_BEARER_TOKEN", "PLEDGE_API_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_URL",
    ]));
    expect(missingBetaSecrets(new Set(REQUIRED_BETA_SECRETS))).toEqual([]);
    expect(missingBetaSecrets(new Set(["AGENT_API_KEY", "SUPABASE_URL"]))).toEqual(expect.arrayContaining([
      "BFF_SESSION_SECRET", "SUPABASE_SECRET_KEY", "MCP_ARTICLE_BEARER_TOKEN",
    ]));
  });

  it("requires a real sandbox Pledge key for beta builds", () => {
    expect(validateBetaPublicConfig({}).errors).toEqual(expect.arrayContaining([
      "VITE_PLEDGE_PARTNER_KEY is missing or malformed.",
      "VITE_PLEDGE_ENV must be sandbox for a beta release.",
    ]));
    expect(validateBetaPublicConfig({
      VITE_PLEDGE_PARTNER_KEY: "sandbox-partner-key",
      VITE_PLEDGE_ENV: "production",
    }).errors).toContain("VITE_PLEDGE_ENV must be sandbox for a beta release.");
    expect(validateBetaPublicConfig({
      VITE_PLEDGE_PARTNER_KEY: "your_sandbox_public_partner_key",
      VITE_PLEDGE_ENV: "sandbox",
    }).errors).toContain("VITE_PLEDGE_PARTNER_KEY is a placeholder value.");
    expect(validateBetaPublicConfig({
      VITE_PLEDGE_PARTNER_KEY: "sandbox-partner-key",
      VITE_PLEDGE_ENV: "sandbox",
    }).errors).toEqual([]);
  });

  it("binds Pledge beneficiary verification to the deployment environment", () => {
    expect(pledgeApiOrigin("beta")).toBe("https://api-staging.pledge.to");
    expect(pledgeApiOrigin("production")).toBe("https://api.pledge.to");
  });

  it("rejects missing or test-only public browser credentials", () => {
    expect(validateProductionPublicConfig({}).errors).toHaveLength(2);
    expect(validateProductionPublicConfig({
      VITE_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      VITE_PLEDGE_PARTNER_KEY: "pledge-public-key",
    }).errors).toContain("A Cloudflare Turnstile test sitekey cannot be deployed to production.");
  });

  it("rejects values that are merely long placeholders", () => {
    const result = validateProductionPublicConfig({
      VITE_TURNSTILE_SITE_KEY: "production-sitekey-placeholder-123456",
      VITE_PLEDGE_PARTNER_KEY: "release-verification-placeholder",
    });
    expect(result.errors).toEqual(expect.arrayContaining([
      "VITE_TURNSTILE_SITE_KEY is a placeholder value.",
      "VITE_PLEDGE_PARTNER_KEY is a placeholder value.",
    ]));
    expect(validateProductionPublicConfig({
      VITE_TURNSTILE_SITE_KEY: "real-looking-turnstile-public-key",
      VITE_PLEDGE_PARTNER_KEY: "your_public_partner_key",
    }).errors).toContain("VITE_PLEDGE_PARTNER_KEY is a placeholder value.");
  });

  it("proves that the final bundle contains both approved public credentials", () => {
    const directory = mkdtempSync(join(tmpdir(), "dbm-production-bundle-"));
    temporaryDirectories.push(directory);
    mkdirSync(join(directory, "assets"));
    const config = {
      errors: [],
      turnstileSiteKey: "0x4-production-turnstile-public-key",
      pledgePartnerKey: "production-pledge-public-key",
    };
    writeFileSync(join(directory, "assets", "app.js"), `${config.turnstileSiteKey}:${config.pledgePartnerKey}`);
    expect(productionBundleContainsPublicConfig(directory, config)).toBe(true);
  });

  it("routes HTML shells through the Worker before static assets", () => {
    const config = readFileSync("wrangler.jsonc", "utf8");
    expect(validateWorkerAssetRouting(config)).toEqual([]);
    expect(validateWorkerAssetRouting('{"run_worker_first":["/*","!/*.html"]}')).toHaveLength(1);
    expect(validateWorkerAssetRouting('{"run_worker_first":["/*","!/**/*.html"]}')).toHaveLength(1);
  });

  it("keeps production on its custom domains without a workers.dev alias", () => {
    const config = readFileSync("wrangler.jsonc", "utf8");
    expect(validateWorkerDeploymentRouting(config)).toEqual([]);
    expect(validateWorkerDeploymentRouting('{"workers_dev":true,"routes":[]}')).toEqual(expect.arrayContaining([
      "Production deployment refused. workers.dev must remain disabled for every environment.",
      "Production deployment refused. The donatebymail.org custom domain route is missing.",
    ]));
    expect(validateWorkerDeploymentRouting('{"workers_dev":false,"preview_urls":true,"routes":[]}')).toContain(
      "Production deployment refused. Workers preview URLs must remain disabled for every environment.",
    );
  });

  it("requires one merged sender SPF record plus DMARC and MX", () => {
    expect(validateProductionDns({
      txtRecords: [["v=spf1 include:_spf.google.com include:spf.brevo.com mx ~all"]],
      dmarcRecords: [["v=DMARC1; p=none; rua=mailto:rua@example.test"]],
      mxRecords: [{ exchange: "smtp.google.com", priority: 1 }],
    })).toEqual([]);
    expect(validateProductionDns({
      txtRecords: [["v=spf1 include:_spf.google.com ~all"]],
      dmarcRecords: [["v=DMARC1; p=none"]],
      mxRecords: [{ exchange: "smtp.google.com", priority: 1 }],
    })).toEqual(expect.arrayContaining([
      "SPF is missing the include:spf.brevo.com mechanism.",
      "SPF is missing the mx mechanism.",
    ]));
    expect(validateProductionDns({
      txtRecords: [["v=spf1 include:_spf.google.com include:spf.brevo.com mx +all"]],
      dmarcRecords: [["v=DMARC1; p=none"]],
      mxRecords: [{ exchange: "smtp.google.com", priority: 1 }],
    })).toContain("SPF must end with a restrictive ~all or -all policy.");
    expect(validateProductionDns({
      txtRecords: [["v=spf1 include:_spf.google.com include:spf.brevo.com mx ~all redirect=example.test"]],
      dmarcRecords: [["v=DMARC1; p=none"]],
      mxRecords: [{ exchange: "smtp.google.com", priority: 1 }],
    })).toContain("SPF must end with a restrictive ~all or -all policy.");
    expect(validateProductionDns({
      txtRecords: [["v=spf1invalid include:_spf.google.com include:spf.brevo.com mx ~all"]],
      dmarcRecords: [["v=dmarc1invalid; p=none"]],
      mxRecords: [{ exchange: "smtp.google.com", priority: 1 }],
    })).toEqual(expect.arrayContaining([
      "Expected exactly one SPF record, found 0.",
      "Expected exactly one DMARC record, found 0.",
    ]));
  });

  it("requires exact production Supabase Auth URLs and rejects beta or wildcard redirects", () => {
    expect(validateProductionAuthConfig({
      siteUrl: PRODUCTION_AUTH_SITE_URL,
      redirectUrls: PRODUCTION_AUTH_REDIRECT_URLS,
    })).toEqual([]);
    expect(validateProductionAuthConfig({
      siteUrl: "https://beta.donatebymail.org",
      redirectUrls: ["https://beta.donatebymail.org", "https://donatebymail.org/**"],
    })).toEqual(expect.arrayContaining([
      `Supabase Auth Site URL must be exactly ${PRODUCTION_AUTH_SITE_URL}.`,
      "Supabase Auth is missing the exact redirect URL https://donatebymail.org/auth/confirm.",
      "Supabase Auth production redirects cannot target beta, localhost, or wildcard URLs: https://beta.donatebymail.org.",
      "Supabase Auth production redirects cannot target beta, localhost, or wildcard URLs: https://donatebymail.org/**.",
    ]));
    expect(validateProductionAuthConfig({
      siteUrl: PRODUCTION_AUTH_SITE_URL,
      redirectUrls: [...PRODUCTION_AUTH_REDIRECT_URLS, "http://donatebymail.org/auth/confirm"],
    })).toContain("Supabase Auth production redirect is not an exact HTTPS Donate by Mail URL: http://donatebymail.org/auth/confirm.");
    expect(validateProductionAuthConfig({
      siteUrl: PRODUCTION_AUTH_SITE_URL,
      redirectUrls: [...PRODUCTION_AUTH_REDIRECT_URLS, "https://www.donatebymail.org/auth/confirm", "https://donatebymail.org/partner"],
    })).toEqual(expect.arrayContaining([
      "Supabase Auth production redirect is not on the exact approved list: https://www.donatebymail.org/auth/confirm.",
      "Supabase Auth production redirect is not on the exact approved list: https://donatebymail.org/partner.",
    ]));
  });

  it("requires an independently secure Cloudflare edge perimeter", () => {
    expect(validateProductionEdgeSettings([
      { id: "always_use_https", value: "on" },
      { id: "browser_check", value: "on" },
      { id: "min_tls_version", value: "1.2" },
      { id: "security_header", value: { strict_transport_security: {
        enabled: true, max_age: "not-a-number", include_subdomains: true, nosniff: true,
      } } },
      { id: "waf", value: "on" },
      { id: "ssl", value: "strict" },
    ])).toContain("Cloudflare edge HSTS must be enabled for at least one year with subdomains.");
    expect(validateProductionEdgeSettings([
      { id: "always_use_https", value: "on" },
      { id: "browser_check", value: "on" },
      { id: "min_tls_version", value: "1.2" },
      { id: "security_header", value: { strict_transport_security: {
        enabled: true, max_age: 31_536_000, include_subdomains: true, nosniff: true,
      } } },
      { id: "waf", value: "on" },
      { id: "ssl", value: "strict" },
    ])).toEqual([]);
    expect(validateProductionEdgeSettings([
      { id: "always_use_https", value: "off" },
      { id: "browser_check", value: "off" },
      { id: "min_tls_version", value: "1.0" },
      { id: "security_header", value: { strict_transport_security: {
        enabled: false, max_age: 0, include_subdomains: false, nosniff: false,
      } } },
      { id: "waf", value: "off" },
      { id: "ssl", value: "flexible" },
    ])).toEqual(expect.arrayContaining([
      "Cloudflare Always Use HTTPS must be enabled.",
      "Cloudflare Browser Integrity Check must be enabled.",
      "Cloudflare minimum TLS version must be 1.2 or newer.",
      "Cloudflare edge HSTS must be enabled for at least one year with subdomains.",
      "Cloudflare edge nosniff must be enabled.",
      "Cloudflare managed WAF or the active Free Managed Ruleset must be enabled.",
      "Cloudflare SSL mode must be full or strict.",
    ]));
    expect(validateProductionEdgeSettings([
      { id: "always_use_https", value: "on" },
      { id: "browser_check", value: "on" },
      { id: "min_tls_version", value: "1.2" },
      { id: "security_header", value: { strict_transport_security: {
        enabled: true, max_age: 31_536_000, include_subdomains: true, nosniff: true,
      } } },
      { id: "waf", value: "off" },
      { id: "ssl", value: "full" },
    ], [{
      kind: "managed",
      name: "Cloudflare Managed Free Ruleset",
      phase: "http_request_firewall_managed",
      rules: [{ enabled: true }],
    }])).toEqual([]);
  });

  it("fails runtime readiness when a production control is absent", () => {
    const complete = {
      DEPLOYMENT_ENVIRONMENT: "production",
      BREVO_API_KEY: ["configured-production-brevo"].join(""), PLEDGE_API_KEY: ["configured-production-pledge"].join(""),
      BREVO_SENDER_EMAIL: "contact@donatebymail.org", BREVO_SENDER_NAME: "Donate by Mail",
      ADMIN_NOTIFICATION_TO: "tre@donatebymail.org", REPLY_TO_EMAIL: "tre@donatebymail.org",
      SUPABASE_URL: "https://configured.supabase.co", SUPABASE_PUBLISHABLE_KEY: "configured-production-publishable",
      ["SUPABASE_" + "SECRET_KEY"]: ["configured-production-secret"].join(""), DONATION_TRACKING_SECRET: "tracking-secret-32-characters-minimum",
      BFF_SESSION_SECRET: "bff-session-secret-32-characters-minimum",
      TURNSTILE_SECRET_KEY: "configured-production-turnstile",
    };
    expect(productionConfigurationErrors(complete as never)).toEqual([]);
    expect(productionConfigurationErrors({ ...complete, TURNSTILE_SECRET_KEY: "" } as never)).toEqual(["TURNSTILE_SECRET_KEY"]);
    expect(productionConfigurationErrors({ ...complete, BFF_SESSION_SECRET: "short" } as never)).toEqual(["BFF_SESSION_SECRET"]);
    expect(productionConfigurationErrors({ ...complete, SUPABASE_URL: "http://configured.supabase.co" } as never)).toEqual(["SUPABASE_URL"]);
    expect(productionConfigurationErrors({ ...complete, SUPABASE_URL: "https://user:password@configured.supabase.co" } as never)).toEqual(["SUPABASE_URL"]);
    expect(productionConfigurationErrors({ ...complete, SUPABASE_URL: "https://configured.supabase.co?apikey=leak" } as never)).toEqual(["SUPABASE_URL"]);
    expect(productionConfigurationErrors({ ...complete, SUPABASE_URL: "https://collector.example/supabase" } as never)).toEqual(["SUPABASE_URL"]);
    expect(productionConfigurationErrors({ ...complete, SUPABASE_URL: "https://configured.supabase.co:8443" } as never)).toEqual(["SUPABASE_URL"]);
    expect(productionConfigurationErrors({ ...complete, SUPABASE_URL: "https://ccgvxlpvljydbvxnzhjp.supabase.co" } as never)).toEqual(["SUPABASE_URL"]);
  });

  it("rejects provider credentials that are present but implausibly short", () => {
    const complete = {
      DEPLOYMENT_ENVIRONMENT: "production",
      ["BREVO_" + "API_KEY"]: ["configured", "production", "brevo"].join("-"), ["PLEDGE_" + "API_KEY"]: ["configured", "production", "pledge"].join("-"),
      BREVO_SENDER_EMAIL: "contact@donatebymail.org", BREVO_SENDER_NAME: "Donate by Mail",
      ADMIN_NOTIFICATION_TO: "tre@donatebymail.org", REPLY_TO_EMAIL: "tre@donatebymail.org",
      SUPABASE_URL: "https://configured.supabase.co", SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      ["SUPABASE_" + "SECRET_KEY"]: ["service", "secret", "key"].join("-"), DONATION_TRACKING_SECRET: "donation-tracking-secret-32-characters",
      BFF_SESSION_SECRET: "bff-session-secret-32-characters", TURNSTILE_SECRET_KEY: "turnstile-secret",
    };
    expect(productionConfigurationErrors({ ...complete, ["PLEDGE_" + "API_KEY"]: "short" } as never)).toEqual(["PLEDGE_API_KEY"]);
    expect(productionConfigurationErrors({ ...complete, TURNSTILE_SECRET_KEY: "short" } as never)).toEqual(["TURNSTILE_SECRET_KEY"]);
  });

  it("maps upstream outages to retryable responses without hiding client errors", () => {
    expect(requestFailureStatus(Object.assign(new Error("upstream"), { upstreamStatus: 503 }))).toBe(503);
    expect(requestFailureStatus(Object.assign(new Error("upstream"), { upstreamStatus: 403 }))).toBe(503);
    expect(requestFailureStatus(new Error("fetch failed"))).toBe(503);
    expect(requestFailureStatus(Object.assign(new Error("invalid input"), { upstreamStatus: 400 }))).toBe(400);
    expect(requestFailureStatus(new Error("malformed body"))).toBe(400);
  });

  it("allows only loopback HTTP for local beta integration", () => {
    expect(supabaseBaseUrl({ DEPLOYMENT_ENVIRONMENT: "beta", SUPABASE_URL: "http://127.0.0.1:54321/" })).toBe("http://127.0.0.1:54321");
    expect(supabaseBaseUrl({ DEPLOYMENT_ENVIRONMENT: "beta", SUPABASE_URL: "http://127.0.0.1:54321/rest" })).toBeNull();
    expect(supabaseBaseUrl({ DEPLOYMENT_ENVIRONMENT: "beta", SUPABASE_URL: "https://configured.supabase.co/rest" })).toBeNull();
    expect(supabaseBaseUrl({ DEPLOYMENT_ENVIRONMENT: "beta", SUPABASE_URL: "http://supabase.example" })).toBeNull();
    expect(supabaseBaseUrl({ DEPLOYMENT_ENVIRONMENT: "beta", SUPABASE_URL: "https://collector.example" })).toBeNull();
  });

  it("limits the local beta HTTP exception to known harness hostnames", () => {
    const env = { DEPLOYMENT_ENVIRONMENT: "beta", SUPABASE_URL: "http://127.0.0.1:54321" } as const;
    expect(isLocalBetaHarness(env, "integration.test")).toBe(true);
    expect(isLocalBetaHarness(env, "beta.donatebymail.org")).toBe(false);
  });

  it("keeps Brevo credentials on the canonical provider or local integration loopback", () => {
    expect(brevoApiUrl({ DEPLOYMENT_ENVIRONMENT: "production" })).toBe("https://api.brevo.com/v3/smtp/email");
    expect(brevoApiUrl({ DEPLOYMENT_ENVIRONMENT: "production", BREVO_API_URL: "https://collector.example/v3/smtp/email" })).toBeNull();
    expect(brevoApiUrl({ DEPLOYMENT_ENVIRONMENT: "beta", BREVO_API_URL: "http://127.0.0.1:43123/v3/smtp/email" })).toBe("http://127.0.0.1:43123/v3/smtp/email");
    expect(brevoApiUrl({ DEPLOYMENT_ENVIRONMENT: "beta", BREVO_API_URL: "http://collector.example/v3/smtp/email" })).toBeNull();
    expect(productionConfigurationErrors({ DEPLOYMENT_ENVIRONMENT: "production", BREVO_API_URL: "https://collector.example/v3/smtp/email" } as never)).toContain("BREVO_API_URL");
  });

  it("requires beta delivery and connector controls before readiness", () => {
    const beta = {
      DEPLOYMENT_ENVIRONMENT: "beta",
      BREVO_API_KEY: ["beta-brevo"].join(""), PLEDGE_API_KEY: ["beta-pledge"].join(""),
      BREVO_SENDER_EMAIL: "contact@donatebymail.org", BREVO_SENDER_NAME: "Donate by Mail Beta",
      ADMIN_NOTIFICATION_TO: "tre+beta@donatebymail.org", REPLY_TO_EMAIL: "tre@donatebymail.org",
      SUPABASE_URL: "https://beta.supabase.co", SUPABASE_PUBLISHABLE_KEY: "beta-publishable",
      ["SUPABASE_" + "SECRET_KEY"]: ["beta-secret"].join(""), DONATION_TRACKING_SECRET: "beta-tracking-secret-32-characters",
      BFF_SESSION_SECRET: "beta-bff-session-secret-32-characters",
      AGENT_API_KEY: "beta-agent-key-with-entropy", MCP_ARTICLE_BEARER_TOKEN: "beta-article-bearer-with-entropy",
      CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", CF_ACCESS_AUDIENCE: "beta-access-audience",
    };
    expect(productionConfigurationErrors(beta as never)).toEqual([]);
    expect(productionConfigurationErrors({ ...beta, BREVO_API_KEY: "" } as never)).toEqual(["BREVO_API_KEY"]);
    expect(productionConfigurationErrors({ ...beta, MCP_ARTICLE_BEARER_TOKEN: "short" } as never)).toEqual(["MCP_ARTICLE_BEARER_TOKEN"]);
    expect(productionConfigurationErrors({ ...beta, ADMIN_NOTIFICATION_TO: "attacker@example.com" } as never)).toEqual(["ADMIN_NOTIFICATION_TO"]);
    expect(productionConfigurationErrors({ ...beta, BREVO_SENDER_NAME: "Donate\nBy Mail" } as never)).toEqual(["BREVO_SENDER_NAME"]);
  });

  it("does not report beta readiness while the hosted agent database contract is stale", async () => {
    const env = {
      DEPLOYMENT_ENVIRONMENT: "beta",
      ["BREVO_" + "API_KEY"]: "beta-brevo-key", ["PLEDGE_" + "API_KEY"]: "beta-pledge-key",
      BREVO_SENDER_EMAIL: "contact@donatebymail.org", BREVO_SENDER_NAME: "Donate by Mail Beta",
      ADMIN_NOTIFICATION_TO: "tre+beta@donatebymail.org", REPLY_TO_EMAIL: "tre@donatebymail.org",
      SUPABASE_URL: "https://beta.supabase.co", SUPABASE_PUBLISHABLE_KEY: "beta-publishable",
      ["SUPABASE_" + "SECRET_KEY"]: "beta-secret", DONATION_TRACKING_SECRET: "beta-tracking-secret-32-characters",
      BFF_SESSION_SECRET: "beta-bff-session-secret-32-characters", AGENT_API_KEY: "beta-agent-key-with-entropy",
      MCP_ARTICLE_BEARER_TOKEN: "beta-article-bearer-with-entropy", CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      CF_ACCESS_AUDIENCE: "beta-access-audience",
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (url.endsWith("/rest/v1/rpc/get_public_nonprofits")) return new Response("[]", { status: 200 });
      if (url.endsWith("/rest/v1/rpc/application_contract_version")) return new Response(JSON.stringify({ contractVersion: "20260808144611" }), { status: 200 });
      if (url.endsWith("/rest/v1/rpc/agent_contract_version")) return new Response(JSON.stringify({ contractVersion: "stale" }), { status: 200 });
      return new Response("unexpected", { status: 500 });
    });
    const response = await worker.fetch(new Request("https://beta.donatebymail.org/readyz"), env as never);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, ready: false });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("reports beta readiness only when the agent contract version matches", async () => {
    const env = {
      DEPLOYMENT_ENVIRONMENT: "beta",
      ["BREVO_" + "API_KEY"]: "beta-brevo-key", ["PLEDGE_" + "API_KEY"]: "beta-pledge-key",
      BREVO_SENDER_EMAIL: "contact@donatebymail.org", BREVO_SENDER_NAME: "Donate by Mail Beta",
      ADMIN_NOTIFICATION_TO: "tre+beta@donatebymail.org", REPLY_TO_EMAIL: "tre@donatebymail.org",
      SUPABASE_URL: "https://beta.supabase.co", SUPABASE_PUBLISHABLE_KEY: "beta-publishable",
      ["SUPABASE_" + "SECRET_KEY"]: "beta-secret", DONATION_TRACKING_SECRET: "beta-tracking-secret-32-characters",
      BFF_SESSION_SECRET: "beta-bff-session-secret-32-characters", AGENT_API_KEY: "beta-agent-key-with-entropy",
      MCP_ARTICLE_BEARER_TOKEN: "beta-article-bearer-with-entropy", CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      CF_ACCESS_AUDIENCE: "beta-access-audience",
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (url.endsWith("/rest/v1/rpc/get_public_nonprofits")) return new Response("[]", { status: 200 });
      if (url.endsWith("/rest/v1/rpc/application_contract_version")) return new Response(JSON.stringify({ contractVersion: "20260808144611" }), { status: 200 });
      if (url.endsWith("/rest/v1/rpc/agent_contract_version")) return new Response(JSON.stringify({ contractVersion: "20260808150002" }), { status: 200 });
      return new Response("unexpected", { status: 500 });
    });
    const response = await worker.fetch(new Request("https://beta.donatebymail.org/readyz"), env as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, ready: true, environment: "beta",
      applicationContractVersion: "20260808144611", agentContractVersion: "20260808150002" });
  });

  it("does not report production readiness while the application database contract is stale", async () => {
    const env = {
      DEPLOYMENT_ENVIRONMENT: "production",
      ["BREVO_" + "API_KEY"]: "production-brevo-key", ["PLEDGE_" + "API_KEY"]: "production-pledge-key",
      BREVO_SENDER_EMAIL: "contact@donatebymail.org", BREVO_SENDER_NAME: "Donate by Mail",
      ADMIN_NOTIFICATION_TO: "tre@donatebymail.org", REPLY_TO_EMAIL: "tre@donatebymail.org",
      SUPABASE_URL: "https://production.supabase.co", SUPABASE_PUBLISHABLE_KEY: "production-publishable",
      ["SUPABASE_" + "SECRET_KEY"]: "production-secret", DONATION_TRACKING_SECRET: "production-tracking-secret-32-characters",
      BFF_SESSION_SECRET: "production-bff-session-secret-32-characters", TURNSTILE_SECRET_KEY: "production-turnstile-secret",
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (url.endsWith("/rest/v1/rpc/get_public_nonprofits")) return new Response("[]", { status: 200 });
      if (url.endsWith("/rest/v1/rpc/application_contract_version")) return new Response(JSON.stringify({ contractVersion: "stale" }), { status: 200 });
      return new Response("unexpected", { status: 500 });
    });
    const response = await worker.fetch(new Request("https://donatebymail.org/readyz"), env as never);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, ready: false });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("reports production readiness only when the application contract version matches", async () => {
    const env = {
      DEPLOYMENT_ENVIRONMENT: "production",
      ["BREVO_" + "API_KEY"]: "production-brevo-key", ["PLEDGE_" + "API_KEY"]: "production-pledge-key",
      BREVO_SENDER_EMAIL: "contact@donatebymail.org", BREVO_SENDER_NAME: "Donate by Mail",
      ADMIN_NOTIFICATION_TO: "tre@donatebymail.org", REPLY_TO_EMAIL: "tre@donatebymail.org",
      SUPABASE_URL: "https://production.supabase.co", SUPABASE_PUBLISHABLE_KEY: "production-publishable",
      ["SUPABASE_" + "SECRET_KEY"]: "production-secret", DONATION_TRACKING_SECRET: "production-tracking-secret-32-characters",
      BFF_SESSION_SECRET: "production-bff-session-secret-32-characters", TURNSTILE_SECRET_KEY: "production-turnstile-secret",
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (url.endsWith("/rest/v1/rpc/get_public_nonprofits")) return new Response("[]", { status: 200 });
      if (url.endsWith("/rest/v1/rpc/application_contract_version")) return new Response(JSON.stringify({ contractVersion: "20260808144611" }), { status: 200 });
      return new Response("unexpected", { status: 500 });
    });
    const response = await worker.fetch(new Request("https://donatebymail.org/readyz"), env as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, ready: true, environment: "production",
      applicationContractVersion: "20260808144611" });
  });

  it("does not disclose missing secret names from the public readiness endpoint", async () => {
    const response = await worker.fetch(new Request("https://donatebymail.org/readyz"), {
      DEPLOYMENT_ENVIRONMENT: "production",
    } as never);
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain('"code":"configuration_unavailable"');
    expect(body).not.toContain("SUPABASE_SECRET_KEY");
    expect(body).not.toContain("BFF_SESSION_SECRET");
  });

  it("does not claim outbox work while provider configuration is incomplete", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await processOutbox({
      DEPLOYMENT_ENVIRONMENT: "beta", SUPABASE_URL: "https://beta.supabase.co",
      BREVO_SENDER_EMAIL: "contact@donatebymail.org", BREVO_SENDER_NAME: "Donate by Mail Beta",
      ADMIN_NOTIFICATION_TO: "tre+beta@donatebymail.org", REPLY_TO_EMAIL: "tre@donatebymail.org",
      SUPABASE_PUBLISHABLE_KEY: ["beta", "publishable"].join("-"), ["SUPABASE_" + "SECRET_KEY"]: ["beta", "secret"].join("-"),
      DONATION_TRACKING_SECRET: ["beta-tracking-secret", "32-characters"].join("-"), BFF_SESSION_SECRET: ["beta-bff-session-secret", "32-characters"].join("-"),
      PLEDGE_API_KEY: ["beta", "pledge-key"].join("-"), AGENT_API_KEY: ["beta-agent-key", "with-entropy"].join("-"),
      MCP_ARTICLE_BEARER_TOKEN: ["beta-article-bearer", "with-entropy"].join("-"), CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      CF_ACCESS_AUDIENCE: ["beta-access-audience"].join("-"), BREVO_API_KEY: "",
    } as never);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps outbox claims bounded below the lease duration", () => {
    expect(OUTBOX_BATCH_SIZE).toBe(5);
    expect(OUTBOX_LEASE_SECONDS).toBe(300);
    expect(OUTBOX_LEASE_SECONDS).toBeGreaterThan(OUTBOX_BATCH_SIZE * 10);
  });

  it("keeps the MCP surface explicitly disabled on production", async () => {
    const response = await worker.fetch(
      new Request("https://donatebymail.org/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      }),
      { DEPLOYMENT_ENVIRONMENT: "production" } as never,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: -32003 } });
  });

  it("binds legacy auth callbacks to the canonical environment origin", () => {
    const response = redirectLegacyAuthCallback(
      new Request("https://untrusted.example/api/auth/callback?state=state-1&code=code-1"),
      { DEPLOYMENT_ENVIRONMENT: "production" } as never,
    );
    expect(response.headers.get("location")).toBe("https://donatebymail.org/auth/confirm?state=state-1#code=code-1");
    const malformed = redirectLegacyAuthCallback(
      new Request("https://untrusted.example/api/auth/callback?code=code-only"),
      { DEPLOYMENT_ENVIRONMENT: "production" } as never,
    );
    expect(malformed.headers.get("location")).toBe("https://donatebymail.org/auth/confirm?error=invalid");
  });

  it("keeps the REST agent surface explicitly disabled on production", async () => {
    const response = await worker.fetch(
      new Request("https://donatebymail.org/api/agent/v1/queries", { method: "POST" }),
      { DEPLOYMENT_ENVIRONMENT: "production" } as never,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "agent_disabled_in_production" });
  });

  it("fails closed instead of sending an email-only donation when operational storage is absent", async () => {
    const response = await worker.fetch(
      new Request("https://donatebymail.org/api/donations", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://donatebymail.org" },
        body: JSON.stringify({}),
      }),
      { DEPLOYMENT_ENVIRONMENT: "production", BREVO_API_KEY: ["configured"].join("") } as never,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "operational_data_unavailable" });
  });

  it("fails closed instead of misreporting a partner application as rate limited", async () => {
    const response = await worker.fetch(
      new Request("https://donatebymail.org/api/partner/applications", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://donatebymail.org" },
        body: JSON.stringify({}),
      }),
      { DEPLOYMENT_ENVIRONMENT: "production" } as never,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "operational_data_unavailable" });
  });

  it("fails closed instead of reporting empty articles when the database is absent", async () => {
    const list = await worker.fetch(
      new Request("https://donatebymail.org/api/articles"),
      { DEPLOYMENT_ENVIRONMENT: "production" } as never,
    );
    expect(list.status).toBe(503);
    expect(await list.json()).toMatchObject({ code: "operational_data_unavailable" });

    const detail = await worker.fetch(
      new Request("https://donatebymail.org/api/articles/safe-slug"),
      { DEPLOYMENT_ENVIRONMENT: "production" } as never,
    );
    expect(detail.status).toBe(503);
    expect(await detail.json()).toMatchObject({ code: "operational_data_unavailable" });
  });

  it("fails closed in production when Pledge beneficiary verification is unavailable", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify")
        return new Response(JSON.stringify({ success: true, action: "donation_submit", hostname: "donatebymail.org" }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      if (url.startsWith("https://api.pledge.to/")) return new Response("unavailable", { status: 503 });
      if (url.includes("/rest/v1/rpc/consume_anonymous_rate_limit")) return new Response("true", { status: 200 });
      return new Response("unexpected", { status: 500 });
    });
    const response = await worker.fetch(
      new Request("https://donatebymail.org/api/donations", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://donatebymail.org" },
        body: JSON.stringify({
          id: "DBM-20260808-ABCDE", clientSubmissionKey: "71000000-0000-4000-8000-000000000001",
          createdAt: "2026-08-08T12:00:00.000Z", shippingMethod: "label",
          donor: {
            firstName: "Sample", middleName: "", lastName: "Donor", email: "donor@example.com",
            address1: "123 Main Street", address2: "", city: "Kissimmee", state: "FL", zip: "34741", country: "US",
            marketingEmailConsent: false,
          },
          devices: [{ id: "phone-1", brand: "Apple", model: "iPhone", age: "2-3 years", condition: "Good", storage: "128 GB", powersOn: true, unlocked: true }],
          charity: { pledgeId: "ec0b21fc-2671-431e-8a81-783b7a9626c9", name: "Unverified charity" },
          turnstileToken: "turnstile-token",
        }),
      }),
      {
        DEPLOYMENT_ENVIRONMENT: "production", BREVO_API_KEY: ["configured", "brevo"].join("-"), PLEDGE_API_KEY: ["configured", "pledge"].join("-"),
        BREVO_SENDER_EMAIL: "contact@donatebymail.org", BREVO_SENDER_NAME: "Donate by Mail",
        ADMIN_NOTIFICATION_TO: "tre@donatebymail.org", REPLY_TO_EMAIL: "tre@donatebymail.org",
        SUPABASE_URL: "https://configured.supabase.co", SUPABASE_PUBLISHABLE_KEY: "configured-publishable",
        ["SUPABASE_" + "SECRET_KEY"]: ["configured", "service", "value"].join("-"), DONATION_TRACKING_SECRET: "tracking-secret-32-characters-minimum",
        BFF_SESSION_SECRET: "bff-session-secret-32-characters-minimum", TURNSTILE_SECRET_KEY: "configured-turnstile",
      } as never,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "charity_verification_unavailable" });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
