# Pledge charity-selection integration

This version uses Pledge only to let a phone donor search for and select one nonprofit. It does not create a Pledge donation, move money, track a payout, or use Pledge webhooks.

## Public partner key

Create a local `.env.local` file or configure the build environment with:

```env
VITE_PLEDGE_PARTNER_KEY=your_public_partner_key
VITE_PLEDGE_ENV=production
```

The partner key is available in Pledge Impact Hub under **Pledge APIs > Widgets**. Pledge documents the partner key as a frontend identifier that is safe to expose. Never use a secret Pledge API key in a `VITE_` variable.

For sandbox testing, use a sandbox account and key, set `VITE_PLEDGE_ENV=sandbox`, and the site will load `https://staging.pledge.to/embed/widget.js`, call `https://api-staging.pledge.to`, and trust only `https://staging.pledge.to` messages. The beta Worker uses the beta Pledge API secret only against that staging API origin.

The beta release command sets that sandbox value explicitly and refuses to
run without a non-placeholder sandbox partner key. The browser also
uses `beta.donatebymail.org` as the sandbox default when no build override is
present, which keeps a shared static bundle from accidentally loading the
production widget in beta. Production builds must use `VITE_PLEDGE_ENV=production`
or leave the value unset for the production-hostname default.

## Organization metadata lookup

Pledge’s documented `updateEvent` guarantees the organization UUID but not the nonprofit name, EIN, location, logo, or website. The Cloudflare Worker enriches the selection through `GET /v1/organizations/{id}` when a secret API key is configured:

```bash
npx wrangler secret put PLEDGE_API_KEY
```

Do not commit this secret or expose it in browser code. Beta/local development can exercise UUID-only behavior without it; production does not pass readiness until the secret is configured, so the Worker can re-verify the beneficiary before publishing public campaign metadata.

## Administrator email

`POST /api/donations` validates the donor, phone, mailing, and selected-charity data. In the configured operational path, the Worker persists the donation before the outbox sends a donor confirmation and a redacted administrator notification through Brevo. The administrator message contains:

- Donation ID and creation time
- Selected charity name and Pledge UUID
- Device count and submitted status
- A link to the authenticated staff workspace

Configure `BREVO_API_KEY` as a Cloudflare Worker secret and verify the sender and administrator destination in `wrangler.jsonc` (`BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `ADMIN_NOTIFICATION_TO`, and `REPLY_TO_EMAIL`). Do not put the Brevo key or donor PII in the browser bundle, agent instructions, or routine logs.

## Local testing

```bash
npm install
cp .env.example .env.local
# add the public partner key to .env.local
npm run test
npm run dev
```

The unit tests use mocked `postMessage` events and do not call Pledge or create transactions. Integration tests use a local Supabase database and a mock Brevo-compatible endpoint; they do not send real email.

## Security behavior

- Only messages from the exact documented Pledge origin are processed.
- Malformed messages, unrelated actions, invalid UUIDs, and untrusted origins are ignored.
- A charity UUID is required before submission.
- Manually typed nonprofit names are not accepted as a substitute for a Pledge UUID.
- The Worker accepts same-origin requests only and validates the payload before sending email.

## Later phase

Monetary disbursement through Pledge is intentionally out of scope. A later project may design and review that flow separately.
