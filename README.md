# Donate by Mail

Donate by Mail turns unused phones into funding for meaningful causes.

This repository contains the public donation experience, including:

- a multi-device phone-value estimator
- red, white, and blue Donate by Mail branding
- donor mailing and contact details
- browser-only draft saving and restoration
- a unique donation ID for each generated packet
- a printable packing slip for the shipment
- a printable post-receipt acknowledgment preview
- data-security and phone-preparation guidance

The production target is Cloudflare Workers Static Assets, with future Cloudflare D1 and R2 services for donation records, carrier labels, intake events, and issued receipt PDFs.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Cloudflare deployment

```bash
npm run deploy
```

> The estimator is not an appraisal or tax valuation. The packing slip is not a charitable acknowledgment. Official acknowledgments should describe donated property without assigning fair market value and should only be issued after the property is physically received and verified.
