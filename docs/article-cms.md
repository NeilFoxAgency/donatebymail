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

The beta article connector is available through the Cloudflare MCP Portal at
`https://mcp-portal-beta.donatebymail.org/mcp`. The portal is the preferred
ChatGPT endpoint: it provides the managed OAuth front door and proxies only
the beta article server. The upstream server is available directly at
`https://mcp-beta.donatebymail.org/mcp/articles` for private diagnostics, and
is independently protected by Cloudflare Access. The article server exposes only
`list_articles`, `get_article`, `create_article_draft`, `update_article_content`,
`schedule_article_publication`, and `publish_article`. It does not expose
donor, partner, support-email, financial, credential, or arbitrary SQL tools.
Writes go through the semantic command policy engine and carry an idempotency
key, correlation ID, exact target/revision IDs, and an audited execution result.

To connect ChatGPT, an administrator enables developer mode, creates a custom
MCP app, enters the portal endpoint above, selects OAuth, scans the tools, and
tests the draft app before publishing it to the workspace. Both the portal and
the upstream server are restricted to `tre@donatebymail.org` by Cloudflare
Access. The portal's upstream capability sync must be authenticated once in
Cloudflare Zero Trust (**AI controls → MCP servers → Donate by Mail beta article
publisher → Authenticate/Reauthenticate**); after that, the portal will expose
the six article tools to the ChatGPT app. ChatGPT may still ask for approval for
write actions according to workspace app permissions and the active article
policy.

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
