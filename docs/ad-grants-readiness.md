# Google Ad Grants website readiness

Reviewed July 20, 2026 against current official Google for Nonprofits guidance.

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
| Search discovery | `robots.txt`, `sitemap.xml`, canonical metadata, unique page descriptions, and NGO structured data are included. |

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

## Official Google sources

- Website policy: https://support.google.com/nonprofits/answer/1657899
- U.S. eligibility: https://support.google.com/nonprofits/answer/3215869
- Goodstack verification: https://support.google.com/nonprofits/answer/12016036
- Campaign setup and sitelinks: https://support.google.com/nonprofits/answer/9841727
- Conversion tracking: https://support.google.com/nonprofits/answer/9841491
- Policy compliance: https://support.google.com/nonprofits/answer/9314402
- Account management policy: https://support.google.com/nonprofits/answer/117827
