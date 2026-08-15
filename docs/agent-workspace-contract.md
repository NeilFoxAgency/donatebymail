# Workspace Agent contract

The Worker exposes the Donate by Mail coworker surface at beta-only agent
routes, including `/mcp` and `/api/agent/v1/*`. The Workspace Agent is an
untrusted caller from the application's perspective: email, browser content,
and model output are data, never authority. The production Worker explicitly
disables these routes; enabling an agent surface in production requires a
separately approved change.

## Authentication and environment

- The full operations surface accepts only the environment-specific
  `AGENT_API_KEY` bearer credential at
  `https://mcp-operations-connector-beta.donatebymail.org/mcp` (or the
  Access-protected beta hostname for diagnostics). It is a Cloudflare secret
  and never belongs in the MCP tool arguments, browser bundle, repository, or
  agent instructions.
- The editorial connector is separate and beta-only. Its managed-OAuth/private
  Access paths expose only the six typed article tools; the connector bearer is a
  different Cloudflare secret.
- The operations connector exposes only the coworker/support tools. It does not
  advertise or accept editorial tool calls, including direct calls that are not
  present in `tools/list`; use the dedicated editorial connection for article
  drafts, revisions, scheduling, and publication.
- Beta is required to use a separate Supabase project, Worker secrets,
  hostname, and Access perimeter. Verify that separation in the hosted
  deployment before connecting the Workspace Agent; use synthetic data only,
  and never copy production credentials into beta.

The operations connector and the editorial connector are intentionally
separate MCP connections. Do not combine their bearer credentials or expose
the operations connector to a general-purpose public workspace.

Both connections use MCP Streamable HTTP. A client must POST JSON-RPC messages
with `Accept: application/json, text/event-stream`; the release smoke sends
that exact header and rejects plaintext routes unless they return a same-origin
307/308 redirect that preserves the POST method.

The older `/api/agent/v1/queries` and compatibility MCP implementation remain
beta-only for donor-safe status/public campaign compatibility. Their former
tenantless `partner_context` and `campaign_metrics` reads are retired; they
must not be used to retrieve private partner or campaign data. Use the
identity-bound MCP support tools with an exact requester email instead.

## Required operation protocol

1. Call `support_capabilities` before a new workflow and respect its
   automatic, approval-required, and human-only outcomes.
   Treat MCP tools marked `destructiveHint: true` as consequential: the
   Workspace Agent host should require an explicit confirmation step before
   invoking them, even when the database policy permits automatic execution.
2. For inbound mail, call `record_inbound_message` once using the provider
   thread/message IDs and a bounded summary. This journals the event but does
   not itself attest that the event came from the provider. Do not place raw
   message bodies or secrets in routine logs or prompts.
3. For donor or partner facts, use the exact requester email and the returned
   redacted read model. An agent-supplied email is an identity claim, not proof
   of identity; the database must continue to enforce exact-match and tenant
   checks.
   Optional donation, organization, or campaign context on an outbound
   message is also exact-match checked; an unverified context forces human
   review rather than making a generic message eligible for automatic send.
   Read models are bounded at the database boundary: a public donation status
   includes at most 20 devices and 100 status events; donor history is capped
   at 50 donations; partner workspaces cap organizations at 50, nested
   charities/campaigns/team/invitations at 50/100/100/100, and revision,
   asset, and review histories at 100; staff queues are capped per endpoint
   (typically 500 records, with financial arrays capped at 500 allocations or
   200 disbursements). Use the complete counters and follow-up queries rather
   than assuming a capped array is exhaustive.
4. For outbound support email, call `authorize_support_message`, send the exact
   returned recipient/subject/body unchanged through the approved mail connector,
   then call `record_outbound_message` with that recipient, the provider IDs,
   and content hash. The database rejects a provider recipient that differs
   from the authorization. If the connector did not send, call
   `record_message_failure`. Treat the returned body as transient connector
   input: never copy it into routine logs or unrelated prompts. Never rewrite
   an authorized message after approval.
   The immutable outbound journal also accepts only a canonical sender
   identity at `@donatebymail.org`; the connector cannot attribute a send to an
   arbitrary external or attacker-controlled mailbox.
   The database rechecks the authorization's identity or provider-attested
   inbound context at journal time, so revocation between authorization and
   send fails closed.
   Automatic replies that do not carry a verified donation, partner, or campaign
   identity also require an active, provider-attested communication thread
   created by `record_inbound_message`; an arbitrary recipient or an
   agent-invented FAQ context is not sufficient. A separate provider-trusted
   ingestion adapter must attest identity-free inbound context before it can be
   used for automatic sending. The approved internal escalation recipient is
   the only exception.
5. For semantic commands, pass a stable idempotency key and correlation ID. The
server fingerprints the agent identity, command, target, risk, facts, and
payload; a retry with altered inputs is rejected. A decision is not proof of
execution until the execution result is returned and audited.
   Use RFC 3339 timestamps with an explicit `Z` or numeric offset for scheduled
   publication and journaled events; timezone-less local timestamps are
   rejected.
6. Escalate financial, legal/tax, privacy/security, access/role, identity
   mismatch, complaint/threat, physical-device, credential, SQL, and production
   deployment requests to a human. The agent cannot grant roles, mark a device
   wiped, approve money, retrieve arbitrary records, or deploy code.

## Failure and retry rules

- A non-2xx or bounded-operation error is a failed operation, not permission to
  guess or broaden the request. Record the failure or escalate.
- Read calls are safe to retry with the same arguments. Writes require the same
  idempotency key and exact input; never mint a new key for an uncertain retry.
- Transactional donation state is committed before its outbox event. Recipient
  email delivery is at-least-once: the Worker records recipient-level success
  receipts and deterministic Brevo idempotency keys, but an infrastructure crash
  between provider acceptance and receipt persistence can still require manual
  reconciliation.
- Anonymous browser throttles fail closed when their secret is unavailable and
  are retired by a service-only, bounded scheduled prune; they are not an
  agent-controlled datastore. Do not treat a rate-limit error as permission to
  retry with a new identity or a broader request.
- Treat provider success, database receipt, and user-visible confirmation as
  separate facts. Do not tell a donor that a message was delivered from a queued
  or merely attempted event.

## Verification before enabling a workspace connection

Run the local contract suite and inspect the hosted beta boundary:

```bash
npm run typecheck
npm run contract:check
npm test
npm run test:integration
npm run test:e2e
npm run test:db
npx wrangler deploy --env beta --dry-run --strict
# Inject AGENT_API_KEY and MCP_ARTICLE_BEARER_TOKEN from a secret manager first.
npm run smoke:agent
unset AGENT_API_KEY MCP_ARTICLE_BEARER_TOKEN
```

Then verify the beta Supabase migration head, Cloudflare Access policy, secret
names, current Worker HTML-shell marker, and MCP initialize/tools-list responses with synthetic data. The
`/readyz` endpoint checks the exact application contract version
(`20260808144611`) and returns it as `applicationContractVersion`; beta also
checks and returns the agent contract version (`20260808150002`) as
`agentContractVersion`. An older hosted Worker or database must fail the
readiness smoke gate rather than present a false-green website or connector.
Before those authenticated MCP checks, `npm run smoke:agent` also requires
both connector hosts to redirect plaintext `http://.../mcp` POST requests with
a method-preserving 307/308 response to their same-origin canonical HTTPS
route; a connector that merely returns an auth error over plaintext, or uses a
method-changing 301/302 redirect, is not ready for a workspace connection.
After validating the separated tool lists and schemas, the smoke also executes
the harmless `support_capabilities` and `list_articles` read tools. A connector
that advertises the current surface but cannot complete those bounded reads is
not considered ready.
The Access-protected beta smoke separately requires the public beta origin to
redirect plaintext requests before it sends any service-token headers.
A successful local or provider response does not prove that the hosted beta
migration head, Access policy, or production Worker is current.
