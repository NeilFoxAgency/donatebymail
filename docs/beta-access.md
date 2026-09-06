# Beta access boundary

`beta.donatebymail.org` must contain synthetic data only. Cloudflare Access is
the required beta-only perimeter; it must never cover `donatebymail.org` or the
production Worker route.

## Current hosted status

The historical checks below are evidence from the July 29–30 beta deployment,
not a current release approval. The hosted beta must be rechecked after every
Worker or Supabase change. As of September 5, 2026, Access still challenges
anonymous beta requests, but the configured CI service-token pair receives
HTTP 403 and cannot run the protected smoke. The deployed Worker also predates
the current `applicationContractVersion` and `agentContractVersion` contract.
Treat both as failed readiness gates until the service token or its policy is
replaced, `npm run smoke:beta` passes, and the separate `npm run smoke:agent`
passes against the current deployment. The dedicated connector hosts currently
redirect plaintext POST `/mcp` with a method-changing 301; they must instead
return 307/308 to their canonical HTTPS routes. An authentication response over
plaintext or a method-changing 301/302 redirect is a transport failure, not a
successful boundary check.

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
- Historical token expiration: July 29, 2027. The current pair receives HTTP
  403, so expiration alone is not proof that the token or policy is usable.

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
