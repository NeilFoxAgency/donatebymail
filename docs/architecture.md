# Donate by Mail architecture

## Current runtime

- React 19 and Vite serve the public site and donation experience.
- Cloudflare Workers Static Assets serves the build.
- `src/worker.ts` owns same-origin `/api/*` requests and server-only Brevo and
  Pledge credentials.
- Production runs as `donate-by-mail`; beta runs separately as
  `donate-by-mail-beta` on `beta.donatebymail.org`.

The existing production donation flow remains operational while Gen2 is built
and tested only in beta.

## Gen2 architecture decision

Supabase Postgres is the authoritative operational source of truth. Supabase
Auth will provide identity and Supabase Storage may hold private documents.
Cloudflare remains the public application and API boundary.

Cloudflare D1 is intentionally not used for Gen2 operational records. Splitting
donations, organizations, authorization, and audit history between D1 and
Postgres would add dual-write and recovery risk. R2 remains an optional future
home for high-volume public assets, not a second source of business truth.

The beta database is the U.S.-region Supabase project
`ccgvxlpvljydbvxnzhjp`. It is test-only. A future production Supabase project
will be separate and will receive the same reviewed migrations only after beta
acceptance.

### Beta migration-history repair

The beta project once recorded three campaign/partner migrations under upload
timestamps that differed from the filenames later committed to Git. Before
applying the remediation migration, the linked beta history is repaired with
Supabase's supported `migration repair --linked --status reverted/applied`
command, preserving schema and data. The final linked list must match the
repository filenames exactly; production is never linked for this operation.

Hosted Free-plan Supabase advisors continue to report
`auth_leaked_password_protection`. That control is Pro-only and this beta uses
passwordless magic links rather than password authentication. Revisit the
finding if passwords are introduced or the project plan changes; do not weaken
the current auth posture to silence it.

## Trust boundaries

```text
Browser
  -> Cloudflare Worker / same-origin BFF
      -> Supabase Auth
      -> Supabase Postgres private schemas and narrow API functions
      -> Pledge nonprofit lookup
      -> Brevo transactional email
      -> transactional outbox processor
          -> future queue adapter and agent command gateway
```

- Secret and service-role credentials are Worker-only.
- Passwordless auth uses cross-device PKCE state in the private database and an
  encrypted host-only `HttpOnly` cookie. Browser code never stores or sends a
  Supabase bearer token; mutations require same-origin session-bound CSRF proof.
- Operational tables live in `app_private`, outside the exposed `public`
  schema, with explicit grants and RLS enabled.
- `api` contains narrow reviewed functions. It is not a generic CRUD surface.
- Human, partner, donor, service, and agent authority are distinct.
- The agent uses semantic commands evaluated by versioned policies. It never
  receives arbitrary SQL or database credentials.

## Account routing

`/login` is the single public account gateway and `/settings` is the shared
profile surface. A server-derived context chooses donor, partner, and staff
destinations; the browser never infers roles from local state. Donor identity
creation is public but donation history remains claim-capability gated. Partner
identity creation is disabled for the public gateway and activation requires a
matching staff invitation. These routes, together with `/account`, `/partner`,
and `/staff`, are permanently reserved from campaign vanity aliases.

## Policy foundations

### Proceeds

Proceeds shares, eligible costs, eligibility, scope, and effective dates are
versioned configuration. A donation will snapshot the resolved policy version.
No percentage, including 50%, is a universal schema invariant.

Resolution order is campaign, partnership/charity, general, then a policy hold
when no approved assignment applies.

### Agent actions

Semantic commands such as `send_message`, `update_campaign_content`, and
`publish_campaign_revision` are evaluated as `ALLOW_AUTOMATICALLY`,
`REQUIRE_APPROVAL`, `ESCALATE`, or `DENY`. Initial beta policies may require
approval while allowing later safe automation without replacing the command
surface.

Physical receipt, device verification and valuation, final financial approval,
credentials, arbitrary database access, and production deployment remain
outside autonomous agent authority.

### Financial approval

Approval count and whether a preparer may approve are versioned policy, not
hard-coded dual control. Beta may use a single staff approver. Every financial
action remains attributable and append-only.

## Event delivery

State changes, audit events, domain events, and outbox events commit in one
Postgres transaction. The initial beta uses a scheduled Worker to lease and
process bounded outbox rows directly. An `OutboxDispatcher` abstraction allows
Cloudflare Queues to be introduced later without changing business commands or
event producers.

Outbox payloads contain identifiers and non-sensitive routing data, not donor
PII. Handlers are idempotent and terminal failures are operator-visible.
Partner invitation persistence commits before email delivery. The invitation
outbox handler resolves the recipient address server-side and sends a normal
passwordless-login link; a provider failure leaves the leased event retryable.

## Privacy posture

Phase 1 uses private schemas, least privilege, RLS, server-only credentials,
redaction, and separate private contact records. Email and address values will
not be identifiers or foreign keys.

Custom field-level encryption is optional hardening. Contact access will be
centralized so encrypted storage and keyed lookup can be added later without
changing donation identifiers or public APIs. See the repository threat model
for the decision criteria.

Donations are never claimed by an email-matching read. A verified donor must
use an expiring, donation-specific, one-time HMAC capability. Campaigns refer
to canonical verified charities and verified organization-to-charity links.
Campaign validation, beneficiary match, attribution, and policy snapshot occur
inside the donation-creation transaction. Revisions can reference only
controlled campaign assets, not mutable partner-provided remote image URLs.

## Receipt and donor-document rules

- The donor purchases postage and receives a printable address label and
  packing slip.
- Carrier delivery is not proof of physical intake.
- Only staff can verify physical receipt and actual devices received.
- An official acknowledgment is issued only after physical receipt is verified.
- The acknowledgment describes property but does not assign fair market value.
- Informational estimates remain separate from tax documentation.
- Receipt and acknowledgment actions create immutable audit events.

## Delivery phases

1. Phase 0: environment, architecture, security contract, CI, and deploy guards.
2. Phase 1A: policy, tenancy, audit, outbox, agent decision, and route-reservation
   foundations.
3. Phase 1B: persistent donations, donor status/account access, and the minimum
   staff interface required to enter real-world device facts.
4. Phase 2: expanded financial and administrative operations.
5. Later phases: partner portal, dynamic campaigns, agent API/MCP, and measured
   automation.

The beta currently implements the Phase 0 and Phase 1A foundations, the Phase
1B donor/staff operational slice, and bounded Phase 2/later-phase test surfaces
for campaign revisions, policy-held proceeds, manual disbursement recording,
and semantic agent-policy evaluation. These surfaces remain beta-only and are
not authorization to deploy or migrate production.

Turnstile is intentionally omitted from beta so automated and human testing can
exercise the flows. The beta is synthetic-data-only and applies server-side
rate limits to anonymous donations and magic-link requests; it is not approved
for real donor PII. Turnstile remains a required production-cutover control for
anonymous write endpoints.
