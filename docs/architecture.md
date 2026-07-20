# Production architecture

## Phase 1 - Static public site

- React + Vite frontend
- Cloudflare Workers Static Assets
- Accessible estimator and education flow
- No donor data leaves the browser

## Phase 2 - Donation intake

Add a Cloudflare Worker API with:

- D1 for donors, donation records, device descriptions, and receipt status
- R2 for generated receipt PDFs and optional carrier-label PDFs
- Turnstile for bot protection on intake and receipt lookup
- Transactional email for confirmation, labels, delivery updates, and receipt links
- Signed, expiring receipt lookup tokens instead of public sequential IDs

Suggested routes:

- `POST /api/donations` - validate and create an intake record
- `POST /api/donations/:id/label` - create or attach a prepaid label
- `GET /api/donations/:token/status` - donor-facing status lookup
- `POST /api/admin/donations/:id/received` - record physical receipt after staff verification
- `POST /api/admin/donations/:id/acknowledgment` - issue the final noncash acknowledgment
- `GET /api/receipts/:token` - signed-token PDF retrieval

## Receipt rules

- Never issue the official acknowledgment before the organization receives the property.
- Describe each donated device, but do not place the estimator's dollar value on the acknowledgment.
- Include whether goods or services were provided in exchange.
- Preserve an immutable audit event when staff marks a donation received and when a receipt is issued.
- Keep the estimate and tax acknowledgment as separate records and separate UI surfaces.

## Security and privacy

- Collect only information needed to mail the label and issue the acknowledgment.
- Encrypt sensitive operational data and restrict administrative routes.
- Use role-based admin access, audit logs, rate limits, and Turnstile.
- Never store phone passcodes, Apple IDs, Google credentials, or donor device backups.
- Publish a clear data-wiping policy and chain-of-custody process before launch.
