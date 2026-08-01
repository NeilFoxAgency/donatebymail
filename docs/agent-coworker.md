# Donate by Mail beta agent coworker

This document describes the beta-only Workspace Agent integration stacked on the Gen2 beta foundation in PR #5.

## Design

The agent is a constrained operations coworker, not a database administrator. It reaches Donate by Mail through the beta Worker's authenticated `/mcp` endpoint. The Worker exposes only named business tools and calls service-role-only functions in the `api` schema. It never exposes raw SQL, Supabase credentials, or direct access to `app_private` tables.

The fixed audit identity is:

```text
donate-by-mail-operations-agent-v1
```

Every consequential agent operation is attributed to that identity and recorded in the action, execution, communication, and audit ledgers.

## Low-risk support email

The agent may automatically send an email only after `agent_authorize_support_message` returns `ALLOW_AUTOMATICALLY` for the exact recipient, category, subject, body, and business-record context.

Automatically eligible categories are:

- general FAQ
- verified donation status, value-status, or shipping update
- donation preparation or acknowledgment-process guidance
- partner campaign setup, portal help, or campaign-status guidance
- a redacted internal escalation sent to `tre@donatebymail.org`

Private donation and partner facts require an exact stored-email match. The authorization expires after two hours. `agent_record_outbound_message` recomputes the content hash after Gmail sends the message; changed content is rejected. Gmail provider IDs and the immutable execution result are then stored in Supabase.

Identity mismatches, financial actions, legal or tax advice, privacy or security incidents, complaints or threats, access changes, and messages outside the bounded categories escalate instead of auto-sending.

## Inbox and database synchronization

The intended sequence for each inbound message is:

1. Read the Gmail thread.
2. Journal the provider thread and message IDs with `record_inbound_message`.
3. Retrieve the relevant donor or partner support snapshot.
4. Draft the response from current database facts and the canonical agent files.
5. Authorize the exact response.
6. Send through Gmail only when the authorization permits it.
7. Record the outbound provider IDs and execution result.
8. Apply the matching Gmail workflow label and update the Supabase communication-thread status.

Provider identifiers and idempotency keys prevent duplicate messages and duplicate records.

## Partner intake

The agent may create or refresh a bounded partner lead and answer routine setup questions. It cannot verify a charity, activate an organization, grant portal access, publish a campaign, or set proceeds terms. Those remain administrator decisions.

## Human-only boundaries

The agent cannot perform or attest to:

- physical package receipt
- device inspection
- data-wipe verification
- device valuation
- final financial reconciliation approval
- preparation, approval, execution, or reversal of a disbursement
- role or credential administration
- production deployment
- unrestricted PII export
- arbitrary database queries

These boundaries are enforced by both the MCP catalog and database policy.

## Financial policy

No active proceeds policy is created by this integration. The database remains on policy hold until leadership approves an exact versioned policy, eligibility rules, and deductible cost categories. Economic terms and effective dates on an existing policy version are immutable; changes require a new version.

## Workspace runtime sources

The Workspace Agent should attach the canonical Donate by Mail knowledge, data, and operating-instruction files. Those files supply durable organizational guidance; Gmail and the bounded MCP tools supply current operational facts. When a static file and a live tool result differ, the agent must use the live authorized result for the specific case and flag any durable policy conflict to Tre.

## Deployment

This branch does not deploy the beta Worker. Before connecting a Workspace Agent:

1. Merge or otherwise make the PR #5 beta foundation available to this stacked branch.
2. Review and merge this integration.
3. Configure the beta Worker secret `AGENT_API_KEY`.
4. Deploy the beta Worker.
5. Confirm unauthenticated `/mcp` requests return 401.
6. Confirm authenticated `initialize` and `tools/list` expose only the bounded catalog.
7. Connect the custom MCP app in the Workspace Agent and attach the canonical agent files.
8. Run a synthetic inbound and low-risk outbound Gmail test, verifying Gmail and Supabase records match.

Production should remain unchanged until beta acceptance tests pass.