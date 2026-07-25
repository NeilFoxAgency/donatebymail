# Pledge charity-selection integration

This version uses Pledge only to let a phone donor search for and select one nonprofit. It does not create a Pledge donation, move money, track a payout, or use Pledge webhooks.

## Public partner key

Create a local `.env.local` file or configure the build environment with:

```env
VITE_PLEDGE_PARTNER_KEY=your_public_partner_key
VITE_PLEDGE_ENV=production
```

The partner key is available in Pledge Impact Hub under **Pledge APIs > Widgets**. Pledge documents the partner key as a frontend identifier that is safe to expose. Never use a secret Pledge API key in a `VITE_` variable.

For sandbox testing, use a sandbox account and key, set `VITE_PLEDGE_ENV=sandbox`, and the site will load `https://staging.pledge.to/embed/widget.js` and trust only `https://staging.pledge.to` messages.

## Optional organization metadata lookup

Pledge’s documented `updateEvent` guarantees the organization UUID but not the nonprofit name, EIN, location, logo, or website. The Cloudflare Worker can enrich the selection through `GET /v1/organizations/{id}` when a secret API key is configured:

```bash
npx wrangler secret put PLEDGE_API_KEY
```

Do not commit this secret or expose it in browser code. Without it, the Pledge UUID is still captured and the integration accepts any additional organization fields Pledge includes in the widget event, but full metadata cannot be guaranteed.

## Administrator email

`POST /api/donations` validates the donor, phone, mailing, and selected-charity data and sends a plain-text notification through the Cloudflare `ADMIN_EMAIL` binding. The notification contains:

- Donation ID and creation time
- Selected charity name and Pledge UUID
- EIN and location when available
- Donor contact and mailing address
- Mailing choice
- Phone descriptions

The default destination is `satoshi@donatebymail.org`. Before production deployment, onboard `donatebymail.org` in Cloudflare Email Service and verify the destination and sender configured in `wrangler.jsonc`.

## Local testing

```bash
npm install
cp .env.example .env.local
# add the public partner key to .env.local
npm run test
npm run dev
```

The unit tests use mocked `postMessage` events and do not call Pledge or create transactions. `wrangler dev` simulates the email binding unless it is configured for remote delivery.

## Security behavior

- Only messages from the exact documented Pledge origin are processed.
- Malformed messages, unrelated actions, invalid UUIDs, and untrusted origins are ignored.
- A charity UUID is required before submission.
- Manually typed nonprofit names are not accepted as a substitute for a Pledge UUID.
- The Worker accepts same-origin requests only and validates the payload before sending email.

## Later phase

Monetary disbursement through Pledge is intentionally out of scope. A later project may design and review that flow separately.
