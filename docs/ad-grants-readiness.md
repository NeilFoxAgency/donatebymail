# Google Ad Grants website readiness

Reviewed July 20, 2026 against current official Google for Nonprofits guidance.

## Official website requirements addressed

| Google website expectation | Implementation |
| --- | --- |
| Organization owns and controls the advertised domain | Production target is `donatebymail.org`. The AppDeploy URL is preview-only and must not be submitted as the grant domain. |
| Clear mission and activities | Mission appears in the homepage hero and dedicated About page. How It Works and For Nonprofits explain activities in detail. |
| Substantial, unique content | Crawlable HTML pages provide original content for donors, nonprofit partners, data security, resources, transparency, privacy, terms, and accessibility. |
| Clear nonprofit identity | Organization name, 501(c)(3) status, EIN 92-1515120, founder, proceeds model, and IRS verification path are public. |
| Easy navigation and working links | Every crawlable page links to the main donor action, mission pages, resources, contact information, and policies. |
| Functional mission actions | The estimator, multi-device donor packet, packing slip, acknowledgment preview, contact handoff, and partner inquiry handoff are functional. |
| Secure HTTPS | AppDeploy preview is HTTPS. Cloudflare must enforce HTTPS and redirect HTTP on `donatebymail.org` before application. |
| Mobile-friendly | Responsive layouts and mobile navigation are included and covered by browser QA. |
| Fast loading | No site photography, video embeds, advertising scripts, or external font requests are required. The app is a static Vite build. |
| No excessive commercial activity | The site states that Donate by Mail is not a trade-in marketplace, donors are not paid, and estimates are informational. No ads or affiliate links are present. |
| Contact and policies | Dedicated Contact, Privacy, Terms, Accessibility, and Transparency pages are linked site-wide. |
| Search discovery | `robots.txt`, `sitemap.xml`, canonical metadata, unique page descriptions, and NGO structured data are included. |

## Ad account features prepared in code

- A meaningful donor-packet completion state is available for conversion measurement.
- Analytics code can be enabled with `VITE_GA4_MEASUREMENT_ID`.
- Prepared events include `donation_packet_created`, `prepaid_label_request_started`, `contact_email_started`, `nonprofit_partner_inquiry_started`, and document-print events.
- Analytics initializes only after visitor consent when a measurement ID is configured.
- Contact email can be changed with `VITE_CONTACT_EMAIL`.

## External actions still required before applying

1. Deploy this branch on the nonprofit-owned domain `donatebymail.org` through Cloudflare.
2. Confirm the displayed organization email is monitored. The current fallback is `satoshi@donatebymail.org` because it is an existing public domain email associated with Donate by Mail.
3. Confirm every real label or mailed-kit request can be fulfilled consistently. A carrier-label integration is preferable before running large campaigns.
4. Configure GA4, test consent and events, mark `donation_packet_created` or a later fulfilled-request event as a key event, and import it into Google Ads.
5. Verify Google for Nonprofits eligibility through Goodstack.
6. Submit `donatebymail.org`, not the preview domain, for the Ad Grants website review.
7. Build mission-specific campaigns with at least two distinct sitelinks, such as Donate a Phone, Data Security, For Nonprofits, and Phone Donation Resources.
8. Use meaningful conversion tracking and maintain current account-level Ad Grants policies after activation.

## Official Google sources

- Website policy: https://support.google.com/nonprofits/answer/1657899
- U.S. eligibility: https://support.google.com/nonprofits/answer/3215869
- Goodstack verification: https://support.google.com/nonprofits/answer/12016036
- Campaign setup and sitelinks: https://support.google.com/nonprofits/answer/9841727
- Conversion tracking: https://support.google.com/nonprofits/answer/9841491
- Policy compliance: https://support.google.com/nonprofits/answer/9314402
- Account management policy: https://support.google.com/nonprofits/answer/117827
