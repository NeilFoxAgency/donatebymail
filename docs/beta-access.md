# Beta access boundary

`beta.donatebymail.org` must contain synthetic data only. Cloudflare Access is
the required beta-only perimeter; it must never cover `donatebymail.org` or the
production Worker route.

## Remaining account activation

The Cloudflare account currently stops at **Activate Zero Trust Free**. The
account owner must review and accept Cloudflare's terms and authorization for
charges above the free allowance. Codex did not accept financial terms or
authorize card charges.

After activation:

1. Open **Access > Applications** and add a self-hosted application named
   `Donate by Mail beta` for exactly `beta.donatebymail.org` (no wildcard).
2. Add an **Allow** policy for explicitly approved testers, initially
   `tre@donatebymail.org`, using one-time PIN or the configured Google IdP.
3. Create a service token named `donatebymail-beta-smoke` and a separate
   **Service Auth** policy that includes only that token.
4. Store its values only as Actions secrets `CF_ACCESS_CLIENT_ID` and
   `CF_ACCESS_CLIENT_SECRET`; never source, logs, Vite variables, or Supabase.
5. Verify a private-window request is challenged, an authorized tester can
   complete both Access and the Supabase callback, `npm run smoke:beta` passes,
   and the production hostname remains unaffected.

An application record alone is not proof of protection. The challenge, human
path, service-token path, and production non-interference require live checks.
