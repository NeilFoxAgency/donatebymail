# Donate by Mail: 100-point production-readiness review

This checklist records the concrete hardening work completed in the current
workspace and the remaining hosted gates. “Local” means implemented and
covered by the repository verification suite. “Hosted” means it still needs
authorized deployment, credentials, or provider-side configuration; it is not
represented as complete.

## Transport and HTTP safety

1. **Local —** Redirect hosted production HTTP requests to HTTPS with `308`.
2. **Local —** Redirect hosted beta HTTP requests to HTTPS with `308`.
3. **Local —** Preserve POST bodies during HTTP-to-HTTPS redirects.
4. **Local —** Keep loopback HTTP available for deterministic local harnesses only.
5. **Local —** Emit exact production HSTS: `max-age=31536000; includeSubDomains`.
6. **Local —** Emit `X-Content-Type-Options: nosniff`.
7. **Local —** Split CSP Pledge widget and API origins by environment.
8. **Local —** Add referrer, permissions, and cross-origin resource policies.
9. **Local —** Keep beta out of search indexes with robots and response headers.
10. **Local —** Convert unexpected Worker failures into bounded JSON responses.

## Public content, routing, and SEO

11. **Local —** Generate one canonical URL for each static page.
12. **Local —** Emit root-relative Vite assets so nested SPA routes can load them.
13. **Local —** Remove stale homepage Open Graph tags before route metadata injection.
14. **Local —** Generate route-specific Open Graph titles and descriptions.
15. **Local —** Generate route-specific Twitter cards, titles, descriptions, and images.
16. **Local —** Restrict social preview images to verified same-origin asset URLs.
17. **Local —** Escape structured JSON-LD safely for HTML script contexts.
18. **Local —** Bound and sanitize metadata values with safe fallbacks.
19. **Local —** Keep the sitemap valid when optional database reads are unavailable.
20. **Local —** Reject unknown SPA HTML paths instead of serving misleading content.

## Browser UX and accessibility

21. **Local —** Provide a keyboard-accessible skip link to the main content.
22. **Local —** Give the mobile menu button an explicit `aria-controls` target.
23. **Local —** Keep the controlled mobile navigation mounted and correctly hidden.
24. **Local —** Close mobile navigation and nested menus with Escape.
25. **Local —** Test public pages at narrow viewports for horizontal overflow.
26. **Local —** Run axe checks across public, intake, confirmation, and partner pages.
27. **Local —** Associate donation inputs, selects, and checkboxes with accessible labels.
28. **Local —** Require meaningful alternative text for rendered public images.
29. **Local —** Render article blocks through a typed, allowlisted block model.
30. **Local —** Drop unsafe protocol-relative and external article links.

## Donation workflow integrity

31. **Local —** Bound persisted donation drafts before restoring them.
32. **Local —** Validate charity identifiers as the expected Pledge UUID shape.
33. **Local —** Accept only bounded HTTPS charity logo and website URLs.
34. **Local —** Prevent ordinary draft restoration from replacing a campaign beneficiary.
35. **Local —** Separate sandbox and production Pledge environments explicitly.
36. **Local —** Keep browser CSP provider hosts aligned with the selected Pledge environment.
37. **Local —** Preserve tracking capabilities after transient status-request failures.
38. **Local —** Preserve claim capabilities after transient claim-handoff failures.
39. **Local —** Prevent React StrictMode from duplicating one-time capability requests.
40. **Local —** Record donation consent timestamps on the server and exclude forged timestamps from hashes.

## Authentication, sessions, and CSRF

41. **Local —** Bound session response bodies before parsing JSON.
42. **Local —** Apply a finite session-request timeout.
43. **Local —** Require JSON content types for session responses.
44. **Local —** Prevent callers from overriding generated session accept and CSRF headers.
45. **Local —** Enforce same-origin browser mutation checks.
46. **Local —** Reject cross-origin staff GET requests that could expose private state.
47. **Local —** Verify Cloudflare Access JWT signature, issuer, audience, and time claims.
48. **Local —** Enforce active staff/admin role boundaries server-side.
49. **Local —** Disable legacy agent and MCP mutation surfaces in production.
50. **Local —** Keep authenticated and operational responses out of shared caches.

## Partner and staff operations

51. **Local —** Expose an explicit partner onboarding completion checklist.
52. **Local —** Use optimistic lock versions for partner campaign edits.
53. **Local —** Make draft saves report a durable saved state to the user.
54. **Local —** Sanitize uploaded campaign and nonprofit images before attachment.
55. **Local —** Verify uploaded bytes against supported image signatures.
56. **Local —** Persist and verify reviewed asset content digests.
57. **Local —** Require the exact campaign/revision pair for publication.
58. **Local —** Require administrator approval before publication.
59. **Local —** Keep partner reporting aggregate and donor-PII-free.
60. **Local —** Mark partner/staff surfaces noindex and no-store.

## Agent and MCP contract

61. **Local —** Separate operations and editorial connector host contracts.
62. **Local —** Allow only the connector origin and trusted OpenAI origins.
63. **Local —** Require the MCP JSON/SSE Accept contract in release smoke tests.
64. **Local —** Reject unsupported MCP protocol versions deterministically.
65. **Local —** Use strict input and output schemas with additional properties disabled.
66. **Local —** Bound scalar agent arguments before database dispatch.
67. **Local —** Bound serialized tool results before returning them to the agent.
68. **Local —** Annotate destructive tools as consequential and approval-sensitive.
69. **Local —** Validate article URLs, blocks, timestamps, and recipient fields.
70. **Local —** Make agent capabilities replay-safe with deterministic authorization records.

## Database and integrity controls

71. **Local —** Restrict outbound sender identities to the Donate by Mail domain.
72. **Local —** Guard agent context identity with database triggers.
73. **Local —** Bind outbound provider actions to their authorized provider context.
74. **Local —** Preserve inbound provenance for agent-created communications.
75. **Local —** Expire and reject replayed authorizations.
76. **Local —** Bound authenticated read-model outputs.
77. **Local —** Bound public read-model outputs.
78. **Local —** Bound article publication queue work.
79. **Local —** Retain and prune anonymous rate-limit records.
80. **Local —** Add required foreign-key indexes and keep database advisors clean.

## Outbox, scheduling, and operational resilience

81. **Local —** Record per-recipient delivery receipts.
82. **Local —** Make notification dispatch idempotent.
83. **Local —** Use leases and retry reconciliation for failed outbox work.
84. **Local —** Run scheduled jobs independently so one failure does not stop all jobs.
85. **Local —** Advance campaign lifecycle state through a scheduled boundary.
86. **Local —** Process scheduled article publication through the Worker scheduler.
87. **Local —** Fail closed when notification provider configuration is incomplete.
88. **Local —** Keep secrets, URLs, cookies, and request bodies out of failure logs.
89. **Local —** Return bounded correlation-aware upstream errors.
90. **Local —** Gate operational database routes on complete operational configuration.

## Release and hosted readiness gates

91. **Local —** Keep privileged CI secrets on trusted main-branch jobs only.
92. **Local —** Require strict Wrangler dry-runs for beta and production.
93. **Local —** Refuse production deploys without the exact confirmation, branch, origin, clean tree, and verification gates.
94. **Local —** Validate production public keys and required secrets before deploy.
95. **Hosted — BLOCKED (credential input required).** The production Turnstile widget and `TURNSTILE_SECRET_KEY` are provisioned, and fresh BFF/tracking secrets exist as unapplied Worker versions. The approved production Pledge public key plus the three production Supabase values (URL, publishable key, and secret key) are not available in this workspace. No values were invented or copied from beta.
96. **Hosted — COMPLETE.** The single root SPF record now contains Google, Brevo, and `mx`; `npm run check:production-dns` passes after propagation.
97. **Hosted — PARTIAL.** Always Use HTTPS, TLS 1.2 minimum, one-year HSTS with subdomains, nosniff, Cloudflare's active Free Managed Ruleset, and a Free-plan IP rate limit for anonymous donation submissions are enabled. The paid Cloudflare Managed WAF/OWASP rulesets remain unavailable without an explicit plan upgrade.
98. **Hosted — BLOCKED (release guard and configuration).** The guarded production deploy still correctly refuses the dirty feature checkout and refuses until item 95 is complete; live `/healthz` therefore still serves the stale static shell rather than the current Worker contract.
99. **Hosted — PARTIAL.** A new one-year beta service token was created and added to the existing `Service Auth` policy. Authenticated beta requests now reach the Worker, but beta smoke still fails the current-Worker marker until the current Worker is deployed.
100. **Hosted — BLOCKED (deployment).** The existing MCP connector host remains reachable and HTTPS-safe, but its live responses lack the current application/agent contract markers. Deploying the current Worker is gated by items 95 and 98; no connector tool smoke is claimed green without those markers and bearer credentials.

The browser audit confirmed that the current hosted site is still serving an
older shell on nested article routes and an older mobile navigation contract;
the local build and regression suite now protect both fixes. Hosted changes in
this authorization window are recorded above with their live evidence and
remaining gates. Production readiness is not claimed while the guarded Worker
deployment, production data-plane credentials, and Free-plan WAF limitation
remain unresolved.
