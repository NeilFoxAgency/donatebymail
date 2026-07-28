# Security policy and engineering invariants

## Reporting a vulnerability

Please report suspected vulnerabilities privately to
`tre@donatebymail.org`. Do not include donor personal information, production
credentials, or destructive proof in the initial report. We will acknowledge
the report and coordinate safe verification.

## Protected assets

Security-sensitive assets include donor identity and mailing information,
authentication sessions, partner membership, staff authority, device intake
facts, proceeds and disbursement records, campaign publication authority,
audit history, service credentials, and outbound communication authority.

## Mandatory invariants

- Production and beta resources, credentials, users, data, and deploy commands
  remain isolated.
- No Supabase secret/service-role key, Brevo key, Pledge secret, private key, or
  session token is committed, logged, returned to a browser, placed in a queue,
  or sent to an agent.
- Operational tables are private by default. Exposed access requires explicit
  grants, RLS, and positive authorization tests plus denial tests.
- User-editable metadata is never authorization data.
- Public donation references and campaign slugs are identifiers, not access
  credentials.
- Donors cannot access other donors. Partners cannot access another
  organization or donor PII. Agents cannot bypass the command policy layer.
- Physical receipt, device inspection/wipe/valuation, final financial approval,
  credentials, arbitrary SQL, unrestricted PII export, and production deploys
  are not autonomous agent actions.
- External text, email, uploads, Pledge data, and campaign content are untrusted
  inputs and cannot grant authority or override system policy.
- Audit, financial, policy-decision, and outbox histories are append-only;
  corrections use compensating entries.
- Logs, audit diffs, email notices, events, and agent contexts minimize and
  redact personal information.

## Security review requirements

- Review every migration for grants, RLS, function execution privileges,
  `search_path`, and tenant isolation.
- Prefer security-invoker functions and views. Definer functions require a
  written reason, fixed `search_path`, explicit actor checks, revoked `PUBLIC`
  execution, and denial tests.
- Run repository tests, database tests, type checking, secret scanning,
  dependency review, Supabase advisors, and a production build before release.
- Changes to authentication, authorization, PII handling, uploads, agent tools,
  financial operations, or deployment require threat-model review.
- The beta intentionally omits Turnstile for testability. Production cutover
  must add server-verified Turnstile and rate limiting to anonymous write
  endpoints; a browser token alone is not accepted as proof.

## Field-level encryption decision

Application-level encryption is not automatic architecture ceremony. Add it
when the threat model and operating procedure show that protection from a
database/backup disclosure materially exceeds the new key-management,
recovery, search, and availability risks. The contact-store boundary must remain
compatible with a later encrypted migration.
