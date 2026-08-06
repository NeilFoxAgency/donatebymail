# Google Ad Grants website readiness

Reviewed August 5, 2026 against current official Google for Nonprofits guidance.

## Website requirements addressed

| Google website expectation | Donate by Mail implementation |
| --- | --- |
| Organization owns and controls the advertised domain | Production target is `donatebymail.org`. The AppDeploy URL is preview-only and must not be submitted as the grant domain. |
| Clear mission and activities | Mission appears on the homepage and About page. How It Works and For Nonprofits explain activities in detail. |
| Substantial, unique content | Crawlable HTML pages cover donors, nonprofit partners, data security, original guides, transparency, privacy, terms, accessibility, and contact information. |
| Clear nonprofit identity | Organization name, 501(c)(3) status, EIN 92-1515120, founder, proceeds model, and receipt practices are public. |
| Easy navigation and working links | The homepage and every crawlable page link to the donor action, mission pages, resources, contact information, and policies. |
| Functional mission actions | The estimator, multi-device donor packet, packing slip, shipping label, draft saving, and contact handoff are functional. |
| Secure HTTPS | AppDeploy preview is HTTPS. Cloudflare must enforce HTTPS and redirect HTTP on `donatebymail.org` before application. |
| Mobile-friendly | Responsive layouts and mobile navigation are included and covered by browser QA. |
| Fast loading | No site photography, video embeds, advertising scripts, or required external font requests. The production target is a static Vite build. |
| No excessive commercial activity | The site states that Donate by Mail is not a trade-in marketplace, donors are not paid, and estimates are informational. No advertising or affiliate links are present. |
| Contact and policies | Contact, Privacy, Terms, Accessibility, and Transparency pages are linked site-wide. |
| Search discovery | `robots.txt`, `sitemap.xml`, canonical metadata, unique page descriptions, and accurate Organization, WebSite, CollectionPage, and Article structured data are included where the corresponding content is visible. |
| Ongoing original content | The **Blog** at `/articles` provides a crawlable editorial section with typed, human-readable articles, per-article metadata, canonical URLs, and Article structured data. Publishing is versioned and scheduled through the beta agent CMS; drafts never appear publicly. |

## Security and crawlability checks added in the beta build

- Static-page builds now receive consistent Open Graph/Twitter metadata, an
  absolute production canonical, and an explicit indexable robots directive.
- The Worker owns `robots.txt` and `sitemap.xml` on the production hostname.
  Published article slugs are appended when the article read service is
  available; a valid static sitemap remains available during an article-service
  outage. Beta returns `Disallow: /` and no sitemap.
- `/ads.txt` is an intentional 404 rather than the homepage returned by the
  SPA fallback. Donate by Mail does not run an ad inventory program.
- `npm run seo:check` checks titles, descriptions, canonicals, social metadata,
  image alt text, absolute social images, beta/AppDeploy leakage, sitemap
  contents, structured-data presence on the homepage, and the absence of a
  static `ads.txt` asset.
- Unknown HTML paths no longer receive the SPA homepage with a `200` response;
  operational routes are marked `noindex` and `no-store` so staff/account
  surfaces are not cached or presented as public content.
- The successful active donation submission emits the consent-gated
  `donation_packet_created` event without donation IDs, email addresses, or
  other donor identifiers. GA4 remains optional until configured and tested.
- GA4 IDs are accepted only in the `G-...` measurement-ID format, and each
  event is sent once through `gtag` to avoid duplicate conversion counting.
- Cloudflare Access-protected editorial MCP routes now verify the signed JWT
  against the beta Access JWKS, issuer, audience, type, and time claims. A
  forwarded-header presence check is not treated as authentication.

These checks improve technical readiness; they do not establish domain
verification, Search Console ownership, GA4 configuration, Google Ads import,
or Ad Grants approval.

The beta Supabase security/performance advisor run on August 5, 2026 returned
one warning: leaked-password protection is disabled. Supabase documents that
this control is available on Pro and above; the beta uses passwordless magic
links rather than password sign-in. Recheck and enable it if the project plan
or authentication model changes before real donor accounts are introduced.

The project advisor also reports informational `RLS enabled, no policy` items
for private operational tables. Those tables intentionally use explicit
server-side RPC grants and default-deny RLS rather than broad client policies;
the local advisor and migration lint runs report no warning-level issues.

## Final preview validation

- AppDeploy deployment completed successfully.
- Three of three automated browser tests passed.
- The mission and nonprofit identity are visible on the homepage.
- The mobile resource-page test passed.
- The required donor-preparation guardrail passed.
- No frontend or backend errors were reported by AppDeploy.

## Conversion measurement prepared

- Optional consent-aware GA4 support is included through `VITE_GA4_MEASUREMENT_ID`.
- Prepared event names include `donation_packet_created`, `mailing_instructions_viewed`, `contact_email_started`, and `nonprofit_partner_inquiry_started`.
- Production analytics must be configured, tested, and imported into Google Ads before relying on conversion-based bidding.

## External actions still required before applying

1. Deploy this branch on `donatebymail.org` through Cloudflare. Do not submit the AppDeploy preview domain.
2. Enforce HTTPS and redirect all HTTP requests to HTTPS.
3. Confirm `satoshi@donatebymail.org` is monitored, or replace `VITE_CONTACT_EMAIL` and the static-page contact text before launch.
4. Confirm donor-paid mailing instructions and the headquarters address label work consistently before sending large paid-traffic volumes.
5. Configure GA4, test consent and conversion events, mark a meaningful completed action as a key event, and import it into Google Ads.
6. Verify Google for Nonprofits eligibility through Goodstack.
7. Build mission-specific campaigns with relevant geography, at least two unique sitelinks, tightly themed ad groups, specific keywords, and conversion-based bidding where required.
8. Maintain current Ad Grants account-level policies after activation.

The website changes prepare the technical surface but do not satisfy the
account-level grant controls by themselves. Before relying on Ad Grants,
confirm the organization through Goodstack, verify domain ownership in Search
Console, configure and test GA4/Google Ads conversion import, and operate
campaigns with the required quality, click-through, keyword, ad-group, and
sitelink controls. A packet-created event is an initial funnel signal; a
post-receipt action should be evaluated as the more meaningful conversion once
the Phase 1B operational status flow exists.

The current production deployment predates these beta-only improvements. The
branch must be deployed to beta and verified before any production rollout.

## Article publishing workflow

Articles are stored as immutable revisions in the private Supabase schema and
served through narrow public read RPCs. The Workspace Agent can list and read
published articles, create drafts, update content, and schedule an exact
revision. Immediate publication remains approval-gated by policy; scheduled
publication runs from the exact revision selected by the agent. Content blocks
are validated server-side (paragraphs, headings, lists, quotes, and safe links)
and rendered without raw HTML injection. This keeps the publishing surface
auditable while leaving room to allow low-risk publication automatically after
the beta has been tested.

This is readiness work, not a claim of Google Ad Grants approval. The account
still needs organization verification, compliant campaigns, conversion
tracking, and ongoing policy maintenance. See Google's [website policy](https://support.google.com/nonprofits/answer/1657899)
and [Ad Grants compliance guidance](https://support.google.com/nonprofits/answer/9314402)
for the current external requirements.

## Official Google sources

- Website policy: https://support.google.com/nonprofits/answer/1657899
- U.S. eligibility: https://support.google.com/nonprofits/answer/3215869
- Goodstack verification: https://support.google.com/nonprofits/answer/12016036
- Campaign setup and sitelinks: https://support.google.com/nonprofits/answer/9841727
- Conversion tracking: https://support.google.com/nonprofits/answer/9841491
- Policy compliance: https://support.google.com/nonprofits/answer/9314402
- Account management policy: https://support.google.com/nonprofits/answer/117827

## Search and structured-data sources reviewed

- [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
- [Google Search Essentials](https://developers.google.com/search/docs/essentials)
- [Structured data introduction](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data)
- [Structured data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
- [Canonical URL consolidation](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Sitemaps overview](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview)
- [Mobile-first indexing](https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing)
- [Core Web Vitals](https://developers.google.com/search/docs/appearance/core-web-vitals)
