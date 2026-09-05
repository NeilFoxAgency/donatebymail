# Donate by Mail

Donate by Mail is a U.S. 501(c)(3) public charity with a mission to turn unused phones into funding for meaningful causes. This repository contains the public donor and nonprofit-partner website.

## Included experience

- Red, white, and blue mobile-first design
- Multi-phone resale estimate with exact-model fields
- Pledge nonprofit search with one required charity selection
- Cloudflare Worker submission endpoint and administrator email notification
- Complete donor packet and browser-saved draft
- Printable packing slip
- Printable donor packet with a packing slip and shipping label
- Phone data-preparation and security guidance
- Mission, nonprofit-program, resource, transparency, contact, privacy, terms, and accessibility pages
- Crawlable landing pages suitable for mission-focused Google Ad Grants campaigns
- Robots, sitemap, canonical metadata, and structured nonprofit data
- Cloudflare Workers Static Assets configuration

## Local development

```bash
npm install
cp .env.example .env.local
# Add the public Pledge partner key to .env.local
npm run dev
```

Tests and production build:

```bash
npm run test
npm run build
```

## Pledge charity selection

The browser integration requires:

```env
VITE_PLEDGE_PARTNER_KEY=your_public_partner_key
VITE_PLEDGE_ENV=production
```

The partner key is intended for frontend use. Do not expose the secret Pledge API key. Full setup, local testing, beta metadata behavior, and administrator-notification behavior are documented in [`docs/pledge-charity-selection.md`](docs/pledge-charity-selection.md). The secret API key is required by the production readiness gate because production campaign pages must be able to re-verify the selected beneficiary.

The beta deploy command forces `VITE_PLEDGE_ENV=sandbox` so the beta Worker
loads `https://staging.pledge.to`, calls only Pledge's sandbox API at
`https://api-staging.pledge.to`, and accepts messages only from that origin.
When the same static bundle is used by a custom-domain dry run without an
explicit override, the browser also selects sandbox automatically on
`beta.donatebymail.org` and production on the two production hostnames.

Pledge provides nonprofit search and selection; it is not a payment rail. The beta
stores donation, shipment, device-processing, proceeds-policy, and manual finance
records, but it does not move money automatically. Documentation is issued only
after staff verify physical receipt and the device.

## Cloudflare deployment

Before deployment:

1. Configure `VITE_PLEDGE_PARTNER_KEY` in the build environment.
2. Configure the required Brevo sender domain and `BREVO_API_KEY` Worker secret.
3. Verify the sender and administrator destination configured in `wrangler.jsonc`.
4. Configure the production Pledge API key with `npx wrangler secret put PLEDGE_API_KEY`.

Then deploy through the explicit environment command:

```bash
npm run deploy:production
```

### Production release gate

Production is deliberately fail-closed. A release is not considered ready from
the local build alone: the production Supabase project, Cloudflare Worker, and
public browser bundle must be checked as one change set.

Before requesting the production release confirmation, an authorized operator
must complete all of the following:

1. Apply and verify every repository migration in the production Supabase
   project. The migration list must include the current production-boundary
   and recipient-outbox migrations; do not use the beta project as an implicit
   production database. The Worker also rejects the known beta project host in
   production readiness checks.
2. In Supabase Auth, set the Site URL to exactly `https://donatebymail.org` and
   allow only the exact production redirect URLs
   `https://donatebymail.org`,
   `https://donatebymail.org/auth/confirm`, and
   `https://donatebymail.org/api/auth/callback`. Do not carry beta, localhost,
   preview, wildcard, or plaintext redirects into the production project.
   Supply those remote values as `SUPABASE_PRODUCTION_AUTH_SITE_URL` and
   `SUPABASE_PRODUCTION_AUTH_REDIRECT_URLS`, then run
   `npm run check:production-auth`. Also enable leaked-password protection,
   confirm custom SMTP and OTP expiry/rate limits, require MFA for staff
   operators, and verify backups, point-in-time recovery, organization MFA,
   and a second project owner.
3. Configure every root Worker secret declared under `secrets.required` and
   build with real, non-test `VITE_TURNSTILE_SITE_KEY` and
   `VITE_PLEDGE_PARTNER_KEY` values. Public keys belong in the browser bundle;
   API keys and session material must remain Cloudflare secrets.
   Run `npm run check:production-config -- --remote-secrets` before requesting
   the release; it checks the public build inputs and the remote secret names
   without printing secret values.
4. Run `npm run contract:check` and `npm run verify:release`, then inspect `/readyz` from the production
   hostname and exercise the donor, partner, staff/MFA, beta-agent, and outbox
   workflows with synthetic data. A cached static page at `/readyz` is a
   failed deployment check, not a healthy response. Readiness also verifies
   the exact application database contract (`20260808144611`), returned as
   `applicationContractVersion`, and, for beta, the separate agent contract
   (`20260808150002`) as `agentContractVersion`.
   Run `npm run smoke:production` for the repeatable health, readiness, current
   Worker-served HTML-shell, and explicit production agent/MCP-disabled boundary check on both
   `donatebymail.org` and `www.donatebymail.org`. The agent/MCP surface stays
   on the isolated beta connector until a separately approved production
   enablement change.
5. Verify the edge perimeter independently of the Worker: HTTP requests to
   both production hostnames must redirect to HTTPS, the zone minimum TLS
   version must be at least 1.2, HSTS and the edge `nosniff` security-header
   setting must be enabled (the Worker also emits both headers), and Cloudflare
   managed WAF rules must be enabled where available. Confirm the production DNS SPF record authorizes
   every sender (Google Workspace and Brevo) in one record, and verify a
   delivered Brevo message has aligned DKIM, SPF, and DMARC results before
   enabling donor notifications. When Google Workspace and Brevo both send
   from the domain, merge their mechanisms into one SPF record as described in
   [Brevo's SPF guidance](https://help.brevo.com/hc/en-us/articles/4414335084434-Merging-multiple-SPF-records).
   Run `npm run check:production-edge` with an operator-supplied
   `CLOUDFLARE_API_TOKEN` as the repeatable read-only edge gate, then run
   `npm run check:production-dns` as the repeatable read-only DNS gate; it
   requires one merged SPF record authorizing Google, Brevo, and `mx`, ending
   in a restrictive `~all` or `-all` policy, plus a DMARC policy and MX record.
6. Refresh the Cloudflare MCP portal/server metadata after the Worker deploy,
   then run `npm run smoke:agent` with ephemeral credentials. The operations
   portal must advertise exactly the bounded operations tools and the editorial
   connector exactly the six typed article tools; an older mixed tool list is a
   failed agent readiness check even if the Worker rejects unauthorized calls.
   The smoke also executes the harmless `support_capabilities` and
   `list_articles` reads, so a connector must be functional as well as
   correctly described.
   The beta and agent smokes also probe plaintext `http://` beta and connector
   `/mcp` routes and require same-origin redirects to canonical HTTPS routes
   before they exercise authentication or the MCP contract.
7. Record the Worker version, Supabase migration head, provider test result,
   rollback target, and operator in the release log. Keep beta Access policy,
   data, and credentials isolated until the production checks pass.

`npm run deploy:production` refuses to run without the exact
`DONATE_BY_MAIL_PRODUCTION_DEPLOY=donatebymail.org` confirmation, the canonical
`NeilFoxAgency/donatebymail` origin, a clean `main` checkout, the remote secret
preflight, and a successful production dry run. After the upload it runs
`npm run smoke:production`; a stale custom-domain
route, cached static `/healthz`/`/readyz` response, or older HTML shell without
the current Worker build marker therefore fails the release command. It does
not apply Supabase migrations or bypass Cloudflare Access.

The Wrangler asset routing keeps HTML shells on the Worker-first path. Static
HTML would otherwise be served directly by Cloudflare and could bypass the
Worker's HTTPS redirect, CSP/HSTS headers, cache policy, and release marker;
the production preflight and configuration test reject any HTML exclusion.

### Current hosted release status (September 5, 2026)

The connected account is not production-ready yet. The production hostname is
still serving a cached static HTML shell at `/healthz`, `/readyz`, and
`/ads.txt`. The guarded release passes its full local verification and strict
Wrangler dry run from clean `main`, but the production Worker is not deployed.
Pledge, Turnstile, session, tracking, and Brevo secrets are staged in unapplied
Worker versions. A separate production Supabase project is active in
`us-east-2`; all 75 migrations are applied, both contract probes exist, remote
schema lint and advisors are clean, database SSL enforcement is enabled, and
Auth has the exact production URL allowlist and hardened password settings.
Supabase's publishable and secret API keys and a dedicated Brevo SMTP credential
remain unavailable to the release environment. No beta value or placeholder was
substituted.

Live DNS now passes the merged SPF, DMARC, and MX checks. Always
Use HTTPS, TLS 1.2 minimum, one-year HSTS with subdomains, Browser Integrity
Check, Bot Fight Mode, and the available Free Managed Ruleset are enabled, but
the trusted GitHub release job still needs a scoped `CLOUDFLARE_API_TOKEN` to
prove the full edge configuration. Paid Cloudflare WAF/OWASP rules cannot be
enabled on the current plan and are not represented as active controls.

Beta's protected smoke currently receives HTTP 403 from Cloudflare Access, so
the service token or its `Service Auth` policy must be replaced. The dedicated
connector hosts reject missing bearer credentials over HTTPS as expected, but
their plaintext POST `/mcp` requests receive a method-changing 301 rather than
307/308. Do not connect the Workspace Agent or move out of beta until Access is
repaired, the transport redirect is method-preserving, the current Worker is
deployed with a sandbox Pledge key, and both `npm run smoke:beta` and
`npm run smoke:agent` pass with the exact current contract markers.

### Beta environment

The isolated beta Worker is deployed to `beta.donatebymail.org`. Beta responses
include an `X-Robots-Tag` header that prevents the testing copy from being
indexed. Deploying beta does not update the production Worker or its domains.

The beta environment has its own Cloudflare secrets. Configure each secret once
through Wrangler's secure prompt (never through a Vite variable or committed
file):

```bash
npx wrangler secret put BREVO_API_KEY --env beta
npx wrangler secret put PLEDGE_API_KEY --env beta
npx wrangler secret put SUPABASE_URL --env beta
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY --env beta
npx wrangler secret put SUPABASE_SECRET_KEY --env beta
npx wrangler secret put DONATION_TRACKING_SECRET --env beta
npx wrangler secret put BFF_SESSION_SECRET --env beta
npx wrangler secret put AGENT_API_KEY --env beta
npx wrangler secret put MCP_ARTICLE_BEARER_TOKEN --env beta
```

Validate or deploy the current build to beta:

```bash
: "${SANDBOX_PLEDGE_PARTNER_KEY:?Set SANDBOX_PLEDGE_PARTNER_KEY to the sandbox public key from Pledge}"
VITE_PLEDGE_ENV=sandbox VITE_PLEDGE_PARTNER_KEY="$SANDBOX_PLEDGE_PARTNER_KEY" npm run check:beta-config
VITE_PLEDGE_ENV=sandbox VITE_PLEDGE_PARTNER_KEY="$SANDBOX_PLEDGE_PARTNER_KEY" npm run deploy:beta:dry-run
VITE_PLEDGE_PARTNER_KEY="$SANDBOX_PLEDGE_PARTNER_KEY" npm run deploy:beta
```

The real beta deployment command performs the read-only Cloudflare secret-name
and public sandbox-widget preflight before uploading and runs the
Access-protected beta smoke immediately afterward. It never reads or prints
secret values; a missing secret, missing sandbox Pledge key, or stale route
must fail the release rather than producing a generic unhealthy Worker
response.

Before connecting the Workspace Agent, inject the two connector credentials
from a secret manager or ephemeral environment (never paste them into source,
logs, or a shell command), then run the separate read-only MCP contract smoke:

```bash
npm run smoke:agent
unset AGENT_API_KEY MCP_ARTICLE_BEARER_TOKEN
```

The command sends `initialize`, `tools/list`, and the harmless
`support_capabilities`/`list_articles` reads to the dedicated operations and
editorial connector hosts. It verifies connector identity, protocol
negotiation, required operations tools, and the exact six-tool editorial
surface; it also probes the private Access and managed-OAuth aliases for
method-preserving HTTPS redirects. It never logs credential values or invokes
a data-changing tool.

Beta intentionally does not use Turnstile so its workflows can be exercised by
automated testing. It is synthetic-data-only and uses server-side rate limits
for anonymous donation and magic-link requests. Turnstile remains a production
cutover requirement for anonymous write endpoints.

## Security and privacy

See `public/.well-known/security.txt`, `SECURITY.md`, and the threat model. Gen2
beta donations persist in private Supabase tables. Routine administrator email
is redacted; authorized staff retrieve contact details from the authenticated
workspace. Supabase sessions are exchanged by the Worker and kept out of
browser-readable storage.

The Workspace Agent contract, tool boundaries, retry rules, and pre-connection
checks are documented in [`docs/agent-workspace-contract.md`](docs/agent-workspace-contract.md).

## Google Ad Grants readiness

See [`docs/ad-grants-readiness.md`](docs/ad-grants-readiness.md) for the official-policy audit, implementation checklist, conversion-event plan, and remaining external actions.

> The estimator is not an appraisal or tax valuation. An official acknowledgment should describe donated property without assigning fair market value and should be issued only after the property is physically received and verified.
