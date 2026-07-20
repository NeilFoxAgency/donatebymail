# Donate by Mail

Donate by Mail is a U.S. 501(c)(3) public charity with a mission to turn unused phones into funding for meaningful causes. This repository contains the public donor and nonprofit-partner website.

## Included experience

- Red, white, and blue mobile-first design
- Multi-phone resale estimate with exact-model fields
- Complete donor packet and browser-saved draft
- Printable packing slip
- Pending acknowledgment preview that excludes estimated tax value
- Phone data-preparation and security guidance
- Mission, nonprofit-program, resource, transparency, contact, privacy, terms, and accessibility pages
- Crawlable landing pages suitable for mission-focused Google Ad Grants campaigns
- Robots, sitemap, canonical metadata, and structured nonprofit data
- Optional consent-aware GA4 scaffolding and named conversion events
- Cloudflare Workers Static Assets configuration

## Local development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## Cloudflare deployment

The project uses `wrangler.jsonc` and Vite static assets:

```bash
npm run deploy
```

Set these build variables in the production environment when ready:

- `VITE_CONTACT_EMAIL` - monitored Donate by Mail contact address
- `VITE_GA4_MEASUREMENT_ID` - optional GA4 measurement ID

Cloudflare should redirect HTTP to HTTPS and serve unknown application routes through the SPA fallback while serving the dedicated HTML landing pages directly.

## Google Ad Grants readiness

See [`docs/ad-grants-readiness.md`](docs/ad-grants-readiness.md) for the official-policy audit, final preview QA results, implementation checklist, conversion-event plan, and remaining external actions.

> The estimator is not an appraisal or tax valuation. An official acknowledgment should describe donated property without assigning fair market value and should be issued only after the property is physically received and verified.
