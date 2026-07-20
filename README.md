# Donate by Mail

Donate by Mail is a U.S. 501(c)(3) public charity with a mission to turn unused phones into funding for meaningful causes. This repository contains the public donor and nonprofit-partner website.

## Included experience

- Mission-focused, crawlable pages with distinct URLs
- Multi-phone resale estimate
- Donor packet and browser-saved draft
- Printable packing slip
- Pending acknowledgment preview that excludes estimated tax value
- Phone data-preparation guides
- Nonprofit partner program explanation
- Transparency, privacy, terms, accessibility, contact, resources, and FAQ pages
- Conversion-ready thank-you page and optional consent-aware GA4 events
- Cloudflare Workers Static Assets configuration
- Robots, sitemap, structured data, and page metadata

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

Cloudflare should redirect HTTP to HTTPS and serve unknown route paths through the SPA fallback.

## Google Ad Grants readiness

See [`docs/ad-grants-readiness.md`](docs/ad-grants-readiness.md) for the official-policy audit, implementation checklist, conversion events, and remaining deployment/account actions.

> The estimator is not an appraisal or tax valuation. An official acknowledgment should describe donated property without assigning fair market value and should be issued only after the property is physically received and verified.
