# Beta access boundary

`beta.donatebymail.org` must contain synthetic data only. Cloudflare Access is
the required beta-only perimeter; it must never cover `donatebymail.org` or the
production Worker route.

## Current hosted status

The historical checks below are evidence from the July 29–30 beta deployment,
not a current release approval. The hosted beta must be rechecked after every
Worker or Supabase change. As of August 8, 2026, the connected Cloudflare
account shows a newer beta deployment, but the unauthenticated operations
connector still returns a generic readiness body without the current
`applicationContractVersion` and `agentContractVersion`. Treat that as a
failed readiness gate until an Access-protected `npm run smoke:beta` and the
separate `npm run smoke:agent` both pass against the current deployment. The
dedicated connector hosts must also redirect plaintext POST `/mcp` requests
with a method-preserving 307/308 response to their canonical HTTPS routes; an
authentication error over plaintext or a method-changing 301/302 redirect is a
transport failure, not a successful boundary check.

## Active configuration

The account owner activated Zero Trust Free. The active boundary is:

- Self-hosted application: `Donate by Mail beta`
- Exact destination: `beta.donatebymail.org` with no wildcard on the application
- Human policy: **Allow Donate by Mail beta staff**, restricted to
  `tre@donatebymail.org`
- Human login method: one-time PIN
- Automation policy: **Service auth for beta smoke**, restricted to the
  `donatebymail-beta-smoke` service token
- PKCE callback exception: a separate, path-scoped self-hosted application
  protects `beta.donatebymail.org/api/auth/callback` with a Bypass policy for
  `Everyone`. This is limited to the single callback path; the BFF still
  requires an unexpired, one-time PKCE state and Supabase code before it sets
  its encrypted session cookie. Without this exception, Cloudflare Access can
  consume a public magic-link redirect before the Worker callback receives it.
- Repository secrets: `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`
- Token expiration: July 29, 2027

## Verified behavior

On July 29–30, 2026:

- An anonymous beta request redirected to the Cloudflare Access challenge.
- The repository's `npm run smoke:beta` received HTTP 200 with the service
  token, verified the Donate by Mail application body and current Worker build
  marker, and checked the JSON `/healthz` plus contract-aware `/readyz`
  responses.
- `tre@donatebymail.org` completed one-time-PIN authentication and received the
  beta homepage.
- The Access logout endpoint cleared the human session; the next beta request
  was challenged again.
- `https://donatebymail.org/` continued to return HTTP 200 without an Access
  redirect.
- A callback request without a valid Supabase code was passed through the
  path-scoped exception and rejected by the Worker with `/?auth=invalid`, not
  by the broad Access challenge.

Rotate the service token before expiration, update both Actions secrets, and
rerun `npm run smoke:beta`. Never store token values in source, logs, Vite
variables, Supabase, or documentation.
