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
Authorization therefore uses database memberships rather than user metadata,
short-lived/rotated sessions, explicit grants, RLS with ownership predicates,
server-side checks for sensitive commands, and production MFA for staff.

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
Phase 1A requirement because beta holds test data and no contact records are yet
implemented. Reassess before real donor PII is stored, using documented support
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

### Event delivery

Retries can duplicate email or external effects, while an email outage can hide
a donation if persistence depends on delivery. The transaction commits business
state and an outbox item first. Handlers are idempotent, leased, bounded, and
redacted; failures become visible without discarding the business record.

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
