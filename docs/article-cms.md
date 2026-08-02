# Donate by Mail article CMS

The public editorial surface is `/articles` and `/articles/:slug`. Only
published revisions are returned by the public Worker API. Drafts, scheduled
revisions, staff identity, and internal policy records stay in the private
Supabase schema.

## Safe content model

Articles are immutable revisions composed of typed blocks: `paragraph`,
`heading` (levels 2–4), `list`, `quote`, and `link`. The database validates
lengths and links (`/…` or `https://…`) before storing a revision. React renders
these values as elements; it never injects HTML or Markdown. Each revision has
a server-computed SHA-256 content hash.

## Agent workflow

The beta MCP endpoint exposes bounded tools for `list_articles`, `get_article`,
`create_article_draft`, `update_article_content`, `schedule_article_publication`,
and `publish_article`. Writes go through the semantic command policy engine and
carry an idempotency key, correlation ID, exact target/revision IDs, and an
audited execution result.

- Draft creation, revision creation, and future scheduling are automatically
  allowed by the beta policy when their risk classification matches.
- Immediate publication is a separate command and is approval-gated by the
  active policy. It cannot be smuggled into a draft or schedule request.
- The scheduled Worker publishes only the exact `scheduled_revision_id` after
  its timestamp. Updating a draft never changes the live article.
- External email, financial actions, physical device verification, credentials,
  arbitrary SQL, and production deployment remain separate controls.

The next step after beta verification is a small staff article review screen
that can approve an exact revision before publication. No production Worker or
production database resource is changed by this branch.
