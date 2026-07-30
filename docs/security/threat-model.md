# Donate by Mail repository threat model

## Overview

This repository implements a public U.S. charity website, a phone-donation
workflow, a Cloudflare Worker API, and the foundations for donor, nonprofit
partner, staff, and agent-assisted operations backed by Supabase. Runtime code
is primarily in `src/`, public content is in `public/`, deployment policy is in
`wrangler.jsonc`, and database changes are migrations under `supabase/`.

The highest-value assets are donor PII and sessions, staff and partner
authority, physical-device and data-wipe facts, financial records, campaign
publication authority, audit integrity, outbound email authority, and service
credentials. The primary security objective is that an Internet user, donor,
partner, compromised email, uploaded asset, or AI agent cannot cross those
boundaries.

## Threat Model, Trust Boundaries, and Assumptions

### Actors

- Anonymous visitors and bots can control public requests, donation fields,
  URLs, tracking references, and contact content.
- Donors control their submitted device descriptions and contact details but
  must not control verified intake or financial facts.
- Partner users control approved organization content within their own tenant.
- Staff operators record physical and financial facts through authenticated
  commands.
- External systems include Pledge, Brevo, carriers, Supabase, Cloudflare, and
  future email providers.
- A Workspace Agent consumes untrusted email/content and invokes narrow
  semantic commands through a policy gateway.
- Developers control source, migrations, CI, and deployments; compromised
  developer or CI credentials are a privileged threat.

### Trust boundaries

1. Internet/browser to Cloudflare Worker.
2. Worker to Supabase Auth and private Postgres data.
3. Authenticated identity to donor, partner, staff, service, or agent authority.
4. Partner organization to every other organization and all donor PII.
5. Database transaction to Brevo, Pledge, carriers, and eventual queue delivery.
6. Untrusted email/upload/web content to the agent reasoning boundary.
7. Beta resources to production resources.
8. Database/storage backups and operator access to live application access.

Assumptions:

- Cloudflare and Supabase platform controls protect their underlying
  infrastructure and encrypt managed data at rest and in transit.
- The Worker and migration code must still enforce least privilege; platform
  encryption does not prevent an over-privileged query or leaked service key.
- Beta contains test data only until the operational beta is explicitly opened.
- A carrier-delivered event cannot prove staff possession of a package.
- The Pledge integration identifies nonprofits but does not authorize payouts.

### Security invariants

- Browser code never receives server/service credentials.
- Public IDs and slugs never authorize private access.
- All tenant and actor checks are server/database enforced, not UI-only.
- Agent decisions are policy-versioned, attributable, idempotent, and bounded to
  semantic commands.
- Untrusted content cannot modify policy, permissions, secrets, physical facts,
  financial approvals, or production state.
- State, audit, domain event, and outbox writes are atomic.
- PII does not enter routine logs, public campaign data, partner analytics,
  outbox payloads, or agent prompts.

## Attack Surface, Mitigations, and Attacker Stories

### Public requests and donation data

Relevant classes include injection, stored/reflected XSS, oversized input,
abuse, CSRF after cookie authentication, enumeration, IDOR, and malicious file
content. Mitigations include same-origin APIs, runtime schemas, exact-origin and
CSRF checks, Turnstile/rate controls in the operational phase, output encoding,
strict CSP, private upload quarantine, non-authorizing public references, and
negative authorization tests.

### Authentication and tenancy

A stolen or replayed session, stale authorization claim, user-controlled JWT
metadata, or incomplete RLS policy could expose other donors or organizations.
Authorization uses database memberships rather than user metadata. Passwordless
links use PKCE with the verifier held temporarily in the private database so a
callback works across devices. The Worker exchanges the code and stores the
Supabase access/refresh pair only inside an AES-GCM-sealed, `HttpOnly`, `Secure`,
`SameSite=Lax`, host-only cookie. It refreshes short-lived access tokens,
enforces a seven-day absolute session limit, invalidates the upstream session
on logout, and requires same-origin, session-bound CSRF proof for mutations.
Browser code never receives the Supabase authorization tokens. Staff authority
is rechecked against active database membership after callback and on requests.
Donation claim capabilities arrive in a URL fragment, are erased immediately,
and are exchanged for opaque, short-lived server state. Only a bounded account
login attempt can carry that action across PKCE, and the verified Auth email
must still match the donation contact before the one-time claim is consumed.

### Service credentials and supply chain

A leaked Supabase secret bypasses RLS; a leaked Brevo key permits outbound mail;
and a compromised deployment token can change production. Credentials are kept
in environment-specific secret stores. Deployment commands are explicit and
guarded, CI actions are commit-pinned, lockfiles are committed, and secret and
dependency scans run in CI.

### Database operator and backup disclosure

RLS does not protect against a database administrator, service-role compromise,
or raw backup disclosure. Phase 1 minimizes PII, separates private contact
records, centralizes contact access, and avoids email/address foreign keys.

Field-level encryption would reduce disclosure from database/backup access but
would introduce a separate high-value key, rotation/recovery obligations,
reduced support search, and the possibility of permanent data loss. It is not a
Phase 1 requirement because the beta is restricted to synthetic data. Contact
records are implemented and currently store plaintext names, email, and postal
address in private `app_private.donor_contacts`, protected by explicit grants,
RLS, and Worker-only repositories. Reassess before real donor PII is stored,
using documented support
lookup needs, incident recovery, backup access, key escrow, rotation ownership,
and restore drills. The schema boundary must allow ciphertext and keyed lookup
to replace plaintext without changing business identifiers.

### Agent and email automation

An attacker may send an email containing prompt injection, impersonate a partner,
request a campaign edit outside their authority, or try to turn a harmless edit
into publication, PII access, or money movement. Email/content is data, not
authority. The system authenticates the sender and tenant, creates a bounded
revision, evaluates each semantic command separately, validates the result,
verifies the public page, and audits the reply. Policy outcomes can mature from
approval to automatic execution for measured low-risk work without enabling
physical, financial, credential, role, SQL, or deployment commands.

REST and MCP semantic-command requests share the same canonical, key-sorted
authorization-input envelope. Its fingerprint includes agent identity,
command, target type and ID, risk, normalized facts, and payload. The database
binds an idempotency key to that fingerprint, so a retry with changed risk,
facts, or target is rejected instead of reusing a prior low-risk decision.

Partner invitation email is an identifier-only outbox event. The Worker
resolves the recipient from the private invitation at delivery time and never
places an address or privileged credential in the event payload. An uninvited
partner magic-link request cannot create an Auth identity or organization
membership; activation still requires a matching active invitation.

### Event delivery

Retries can duplicate email or external effects, while an email outage can hide
a donation if persistence depends on delivery. The transaction commits business
state and an outbox item first. Handlers are idempotent, leased, bounded, and
redacted; failures become visible without discarding the business record.

### Financial corrections and partner authority

Sales and costs are append-only facts. Reversals remove originals from the
effective ledger without deleting history, and corrected replacements are
accepted only while financial inputs are explicitly open. Allocation waits for
physical reconciliation and input finalization; the eligible-device set and
cost applications are frozen. Reopening creates an allocation reversal and is
denied after approval or disbursement. Disbursement preparation derives its
canonical charity and snapshots its approval requirements.

Partner roles originate only from audited staff invitations matched to a
verified passwordless identity. Active membership and an active organization
are checked together. Agent commands cannot grant roles. Campaign assets are
disabled until immutable storage, byte validation, digest binding, and a public
serving route are implemented as one complete control.

### Browser hardening and administrative email

The Worker deploys a CSP with exact production and staging Pledge origins,
denies framing and object embedding, restricts forms and connections, and adds
`Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options`, and
`X-Frame-Options`. API and authenticated surfaces use `Cache-Control: no-store`.
Routine beta administrator notices contain only the public donation ID,
charity, device count, status, and authenticated staff link. Donor email and
street address stay in the private workspace rather than routine email.

### Current beta abuse boundary

The beta is a synthetic-data-only test environment, not a public beta approved
for real donor data. Cloudflare Access is the required perimeter, with named
human identities and a separate service-token policy for automation. The
unauthenticated challenge, authorized one-time-PIN path, service-token path,
logout, and production non-interference were verified on July 29, 2026.
The passwordless PKCE callback is intentionally a separate, path-scoped
Cloudflare Access application with a Bypass policy for
`beta.donatebymail.org/api/auth/callback`; this does not bypass the Worker’s
one-time state, Supabase code exchange, active-role checks, or encrypted
session-cookie requirements. The broader beta hostname remains behind the
named Access policy.
Turnstile remains absent so authorized automation can test the flow. Anonymous
donation and passwordless-email endpoints use server-side,
privacy-preserving IP-bucket rate limits, generic authentication responses,
bounded payloads, and idempotent email delivery. Production cutover still
requires server-verified Turnstile and a separate review.

### Out-of-scope attacker stories

The application cannot protect a donor who intentionally leaves credentials on
their phone or a staff member who performs an unauthorized physical act outside
the system. It must not worsen those risks: the site never asks for a passcode,
records who asserted physical facts, and preserves operational evidence.

## Severity Calibration (Critical, High, Medium, Low)

### Critical

- Browser or agent access to Supabase service credentials or arbitrary SQL.
- Cross-tenant compromise exposing donor PII at scale.
- Unauthorized production deployment or financial execution.
- Agent prompt injection that grants roles, exposes secrets, or changes final
  financial/physical facts.

### High

- Donor-to-donor or partner-to-partner IDOR with sensitive records.
- Staff-session bypass or campaign publication outside authorization.
- Stored XSS on authenticated staff/partner surfaces.
- Audit or financial history that can be altered without an attributable
  compensating entry.

### Medium

- Enumeration of donation existence without private record access.
- Missing rate limits enabling material abuse or transactional-email cost.
- Outbox duplication producing repeated notifications but no state or financial
  corruption.
- Public publication of internal but non-PII campaign fields.

### Low

- Non-sensitive UI integrity issues without an authorization or privacy effect.
- Missing hardening headers on an informational page where no session or input is
  present.
- Low-volume operational metadata exposure that does not identify a donor,
  reveal credentials, or enable a higher-impact attack.

Repository: https://github.com/NeilFoxAgency/donatebymail.git
Version: working-tree-4707d2c4ea94795795c2e9ce581fa83289e5d37cf5fa03b973d62ca6b31a6611
