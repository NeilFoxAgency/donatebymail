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

The partner key is intended for frontend use. Do not expose the secret Pledge API key. Full setup, local testing, optional metadata lookup, and administrator-notification behavior are documented in [`docs/pledge-charity-selection.md`](docs/pledge-charity-selection.md).

Pledge provides nonprofit search and selection; it is not a payment rail. The beta
stores donation, shipment, device-processing, proceeds-policy, and manual finance
records, but it does not move money automatically. Documentation is issued only
after staff verify physical receipt and the device.

## Cloudflare deployment

Before deployment:

1. Configure `VITE_PLEDGE_PARTNER_KEY` in the build environment.
2. Onboard `donatebymail.org` in Cloudflare Email Service.
3. Verify the sender and destination configured in `wrangler.jsonc`.
4. Optionally configure richer Pledge metadata lookup with `npx wrangler secret put PLEDGE_API_KEY`.

Then deploy through the explicit environment command:

```bash
npm run deploy:production
```

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
```

Validate or deploy the current build to beta:

```bash
npm run deploy:beta:dry-run
npm run deploy:beta
```

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

## Google Ad Grants readiness

See [`docs/ad-grants-readiness.md`](docs/ad-grants-readiness.md) for the official-policy audit, implementation checklist, conversion-event plan, and remaining external actions.

> The estimator is not an appraisal or tax valuation. An official acknowledgment should describe donated property without assigning fair market value and should be issued only after the property is physically received and verified.
