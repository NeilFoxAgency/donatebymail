# Beta access boundary

`beta.donatebymail.org` must contain synthetic data only. Cloudflare Access is
the required beta-only perimeter; it must never cover `donatebymail.org` or the
production Worker route.

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
  token and verified the Donate by Mail application body.
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
