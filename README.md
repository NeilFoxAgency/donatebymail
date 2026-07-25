# Donate by Mail

Donate by Mail is a U.S. 501(c)(3) public charity with a mission to turn unused phones into funding for meaningful causes. This repository contains the public donor and nonprofit-partner website.

## Included experience

- Red, white, and blue mobile-first design
- Multi-phone resale estimate with exact-model fields
- Pledge nonprofit search with one required charity selection
- Cloudflare Worker submission endpoint and administrator email notification
- Complete donor packet and browser-saved draft
- Printable packing slip
- Pending acknowledgment preview that excludes estimated tax value
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

This version does not send money through Pledge and does not implement payouts, webhooks, or transaction tracking.

## Cloudflare deployment

Before deployment:

1. Configure `VITE_PLEDGE_PARTNER_KEY` in the build environment.
2. Onboard `donatebymail.org` in Cloudflare Email Service.
3. Verify the sender and destination configured in `wrangler.jsonc`.
4. Optionally configure richer Pledge metadata lookup with `npx wrangler secret put PLEDGE_API_KEY`.

Then deploy:

```bash
npm run deploy
```

## Security and privacy

See `public/.well-known/security.txt` and the project documentation. Drafts are stored in the donor's browser. Final form data is validated by the Worker and emailed to the configured Donate by Mail administrator; it is not stored in a new database by this feature.

## Google Ad Grants readiness

See [`docs/ad-grants-readiness.md`](docs/ad-grants-readiness.md) for the official-policy audit, implementation checklist, conversion-event plan, and remaining external actions.

> The estimator is not an appraisal or tax valuation. An official acknowledgment should describe donated property without assigning fair market value and should be issued only after the property is physically received and verified.
