import { expect, test } from "@playwright/test";

const campaign = {
  slug: "beta-phone-drive",
  name: "Beta Phone Drive",
  charityPledgeId: "11111111-1111-4111-8111-111111111111",
  charityName: "Community Phones Foundation",
  charity: { pledgeId: "11111111-1111-4111-8111-111111111111", name: "Community Phones Foundation", logoUrl: "javascript:alert(1)" },
  headline: "Turn an old phone into support",
  summary: "A deterministic browser fixture campaign.",
  story: "Your unused phone can support a cause you choose.",
  ctaLabel: "Donate a Phone",
  blocks: [{ type: "callout", content: { heading: "Every phone counts", body: "Choose a nonprofit and mail your phone." } }],
};

async function mockPublicApis(page: import("@playwright/test").Page) {
  await page.route("**/api/campaigns/beta-phone-drive", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, campaign }) });
  });
  await page.route("**/api/donations", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, donationId: "DBM-E2E-0001", createdAt: "2026-07-30T00:00:00Z", charity: campaign.charity, trackingUrl: "/track/DBM-E2E-0001" }) });
  });
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: false }) });
  });
  await page.route("**/api/auth/csrf", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrfToken: "e2e-csrf-token" }) });
  });
  await page.route("**/api/account/auth/magic-link", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ message: "A secure link is on its way." }) });
  });
}

test.describe("deterministic beta browser workflows", () => {
  test("campaign CTA preselects the verified beneficiary and can leave campaign context", async ({ page }) => {
    await mockPublicApis(page);
    await page.goto("/donate-phone.html?campaign=beta-phone-drive");
    await page.getByRole("button", { name: /See my estimate/i }).click();
    await page.getByRole("button", { name: /Continue to charity/i }).click();
    await page.getByText("You're supporting Community Phones Foundation.").waitFor();
    await expect(page.locator(".selected-charity img")).toHaveCount(0);
    await expect(page.getByText("Your campaign nonprofit is already selected.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose a different charity" })).toBeVisible();
    await page.getByRole("button", { name: "Choose a different charity" }).click();
    await expect(page).not.toHaveURL(/campaign=beta-phone-drive/);
    await expect(page.getByText("You're supporting Community Phones Foundation.")).not.toBeVisible();
    await expect(page.getByText("Choose the charity that your donation supports.")).toBeVisible();
  });

  test("campaign handoff submits and reaches confirmation", async ({ page }) => {
    await mockPublicApis(page);
    await page.goto("/donate-phone.html?campaign=beta-phone-drive");
    await page.getByRole("button", { name: /See my estimate/i }).click();
    await page.getByRole("button", { name: /Continue to charity/i }).click();
    await page.getByLabel("First name").fill("Browser");
    await page.getByLabel("Last name").fill("Fixture");
    await page.getByLabel("Email address").fill("browser@example.com");
    await page.getByLabel("Street address").fill("1 Test Way");
    await page.getByRole("textbox", { name: "City" }).fill("Kissimmee");
    await page.getByRole("combobox", { name: /^State/ }).selectOption("FL");
    await page.getByLabel("ZIP code").fill("34741");
    await page.locator("input[type=checkbox]").first().check();
    await page.getByRole("button", { name: /Create donation packet/i }).click();
    await expect(page.getByText(/Donation ID/i).first()).toBeVisible();
    await expect(page.getByText("DBM-E2E-0001").first()).toBeVisible();
  });

  test("account gateway offers a deterministic magic-link flow", async ({ page }) => {
    await mockPublicApis(page);
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).first().fill("browser@example.com");
    await page.getByRole("button", { name: "Create an account" }).click();
    await expect(page.getByRole("status")).toContainText("secure link");
  });

  test("keeps a tracking capability retryable after a transient failure", async ({ page }) => {
    let attempts = 0;
    await page.route("**/api/donations/status", async (route) => {
      attempts += 1;
      if (attempts === 1) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Status temporarily unavailable." }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ donation: {
          publicId: "DBM-E2E-TRACK",
          status: "received",
          charityName: "Community Phones Foundation",
          createdAt: "2026-07-30T00:00:00Z",
          devices: [],
          events: [],
        } }),
      });
    });
    await page.goto("/track#id=DBM-E2E-TRACK&token=retryable-token");
    await expect(page.getByRole("status")).toContainText("temporarily unavailable");
    await expect(page).toHaveURL(/#id=DBM-E2E-TRACK&token=retryable-token/);
    await page.reload();
    await expect(page.getByRole("heading", { name: "DBM-E2E-TRACK" })).toBeVisible();
    await expect(page).not.toHaveURL(/token=/);
    expect(attempts).toBe(2);
  });

  test("clears an accepted unauthenticated claim handoff after setting the pending session", async ({ page }) => {
    let claimAttempts = 0;
    await page.route("**/api/account/claim-intents", async (route) => {
      claimAttempts += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, claimed: false, pending: true }) });
    });
    await page.route("**/api/account/session", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false }) });
    });
    await page.goto("/account#donation=DBM-E2E-CLAIM&claim=accepted-claim-capability");
    await expect(page).toHaveURL(/\/account$/);
    await expect(page).not.toHaveURL(/claim=/);
    await expect(page.getByRole("heading", { name: "Track your claimed donations" })).toBeVisible();
    expect(claimAttempts).toBe(1);
  });

  test("guides a nonprofit admin through a plain-language first campaign setup", async ({ page }) => {
    const organizationId = "00000000-0000-4000-8000-000000000030";
    const campaignId = "00000000-0000-4000-8000-000000000031";
    const charityId = "00000000-0000-4000-8000-000000000032";
    const metrics = { views: 0, donationStarts: 0, submittedDonations: 0, phonesPledged: 0, phonesReceived: 0, phonesProcessed: 0, completedDonations: 0 };
    const financial = { grossProceedsCents: 0, eligibleCostCents: 0, allocableBaseCents: 0, allocationCents: 0, provisional: false, disbursementStatus: "not_prepared", policyVersions: [] };
    const campaignSummary = { id: campaignId, slug: "spring-phone-drive", name: "Spring Phone Drive", status: "draft", charityName: "Community Phones Foundation", reviewState: "editing", metrics, financial };
    const workspace = {
      campaign: campaignSummary,
      draft: { stage: 1, headline: "Every phone can help", summary: "A simple way for our community to support local families.", story: "We are collecting working phones so local families can stay connected to school, work, and the people they love.", ctaLabel: "Donate a Phone", blocks: [], toolkit: {}, phoneGoal: 50, startsAt: null, endsAt: null, timezone: "America/New_York", partnerReady: false, reviewState: "editing", lockVersion: 1 },
      metrics, financial, assets: [], revisions: [], reviews: [],
      toolkit: { canonicalUrl: "https://beta.donatebymail.org/c/spring-phone-drive", sourceLinks: { email: "https://beta.donatebymail.org/c/spring-phone-drive?src=email" } },
    };
    let created = false;
    let createRequest: Record<string, unknown> | null = null;
    const organization = {
      id: organizationId, name: "Community Phones", slug: "community-phones", role: "partner_admin",
      onboarding: { organizationProfile: true, verifiedBeneficiary: true, team: false, campaignTerms: false, campaignContent: false, launchDates: false, toolkit: false, publicationReview: false },
      campaigns: [], verifiedCharities: [{ id: charityId, name: "Community Phones Foundation", pledgeId: campaign.charityPledgeId }],
      team: [{ userId: "00000000-0000-4000-8000-000000000033", email: "admin@example.com", role: "partner_admin", status: "active" }], invitations: [], recentActivity: [],
    };
    await page.route("**/api/partner/session", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true }) }));
    await page.route("**/api/auth/csrf", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrfToken: "e2e-csrf-token" }) }));
    await page.route("**/api/partner/overview", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ partner: { organizations: [{ ...organization, campaigns: created ? [campaignSummary] : [] }] } }) }));
    await page.route(`**/api/partner/organizations/${organizationId}/campaign-slugs/**`, async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, available: true }) }));
    await page.route("**/api/partner/campaigns", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      createRequest = route.request().postDataJSON() as Record<string, unknown>;
      created = true;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, result: { campaignId } }) });
    });
    await page.route(`**/api/partner/campaigns/${campaignId}`, async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, workspace }) }));
    await page.goto("/partner");
    await page.getByRole("button", { name: "Campaigns", exact: true }).click();
    await page.getByRole("button", { name: "Start my first campaign" }).click();
    await expect(page.getByRole("heading", { name: "Let’s build this together" })).toBeVisible();
    await page.getByLabel("Campaign name").fill("Spring Phone Drive");
    await expect(page.getByRole("status")).toContainText("link is available");
    await page.getByRole("button", { name: "Next: choose support" }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByLabel("Campaign name")).toHaveValue("Spring Phone Drive");
    await page.getByRole("button", { name: "Next: choose support" }).click();
    await page.getByLabel("Verified nonprofit").selectOption(charityId);
    await expect(page.getByText("This beneficiary is verified by Donate by Mail.")).toBeVisible();
    await page.getByRole("button", { name: "Next: tell the story" }).click();
    await page.getByLabel("Working headline").fill("Every phone can help");
    await page.getByLabel("Short explanation").fill("A simple way for our community to support local families.");
    await page.getByLabel("Campaign story").fill("We are collecting working phones so local families can stay connected to school, work, and the people they love.");
    await page.getByLabel("Phone goal").fill("50");
    await page.getByRole("button", { name: "Next: review" }).click();
    await expect(page.getByText("Nothing is published by this button.")).toBeVisible();
    await page.getByRole("button", { name: "Create private campaign draft" }).click();
    await expect.poll(() => createRequest).toMatchObject({ name: "Spring Phone Drive", slug: "spring-phone-drive", charityId, phoneGoal: 50 });
    await expect(page.getByRole("heading", { name: "Spring Phone Drive" })).toBeVisible();
  });

  test("partner workspace exposes onboarding, reporting, guided editing, and sanitized media", async ({ page }) => {
    const metrics = { views: 120, donationStarts: 24, submittedDonations: 12, phonesPledged: 14, phonesReceived: 9, phonesProcessed: 7, completedDonations: 6, sources: { social: 80, email: 40 } };
    const financial = { grossProceedsCents: 25000, eligibleCostCents: 5000, allocableBaseCents: 20000, allocationCents: 10000, provisional: true, disbursementStatus: "not_prepared", policyVersions: [] };
    const campaignSummary = { id: "00000000-0000-4000-8000-000000000001", slug: "beta-phone-drive", name: "Beta Phone Drive", status: "draft", charityName: "Community Phones Foundation", reviewState: "editing", phoneGoal: 100, metrics, financial };
    const organization = {
      id: "00000000-0000-4000-8000-000000000003", name: "Community Phones", slug: "community-phones", role: "partner_admin",
      onboarding: { organizationProfile: true, verifiedBeneficiary: true, team: true, campaignTerms: true, campaignContent: false, publicationReview: false },
      campaigns: [campaignSummary], verifiedCharities: [{ id: "00000000-0000-4000-8000-000000000004", name: campaignSummary.charityName, pledgeId: campaign.charityPledgeId }],
      team: [{ userId: "00000000-0000-4000-8000-000000000006", email: "admin@example.com", role: "partner_admin", status: "active" }], invitations: [],
      recentActivity: [{ type: "campaign.create_draft", entityType: "campaign", occurredAt: "2026-08-07T12:00:00Z" }],
    };
    const campaignWorkspace = {
      campaign: campaignSummary,
      draft: { stage: 1, headline: "A phone can help", summary: "A short summary.", story: "A longer factual story.", ctaLabel: "Donate a Phone", blocks: [], toolkit: {}, phoneGoal: 100, startsAt: null, endsAt: null, timezone: "America/New_York", partnerReady: false, reviewState: "editing", lockVersion: 1 },
      metrics, financial, assets: [], revisions: [], reviews: [],
      toolkit: { canonicalUrl: "https://beta.donatebymail.org/c/beta-phone-drive", sourceLinks: { email: "https://beta.donatebymail.org/c/beta-phone-drive?src=email", social: "https://beta.donatebymail.org/c/beta-phone-drive?src=social", qr: "https://beta.donatebymail.org/c/beta-phone-drive?src=qr" } },
    };
    let savedDraft: Record<string, unknown> | null = null;
    await page.route("**/api/partner/session", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true }) }));
    await page.route("**/api/auth/csrf", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrfToken: "e2e-csrf-token" }) }));
    await page.route("**/api/partner/overview", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ partner: { organizations: [organization] } }) }));
    await page.route("**/api/partner/campaigns/00000000-0000-4000-8000-000000000001", async (route) => {
      if (route.request().method() === "PATCH") { savedDraft = route.request().postDataJSON() as Record<string, unknown>; await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: { lockVersion: 2 } }) }); return; }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ workspace: campaignWorkspace }) });
    });
    await page.route("**/api/partner/campaigns/00000000-0000-4000-8000-000000000001/assets", async (route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ asset: { id: "00000000-0000-4000-8000-000000000005" } }) }));
    await page.goto("/partner");
    await expect(page.getByRole("heading", { name: "Community Phones" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "4 of 6 essentials complete" })).toBeVisible();
    await expect(page.getByText("120", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Campaigns", exact: true }).click();
    await page.getByRole("button", { name: "Open campaign" }).click();
    await expect(page.getByRole("heading", { name: "Beta Phone Drive" })).toBeVisible();
    await page.getByLabel("Headline").fill("A phone can help more people");
    await page.getByRole("button", { name: "Save now" }).click();
    await expect(page.getByRole("status")).toContainText("Saved");
    await expect.poll(() => savedDraft?.headline).toBe("A phone can help more people");
    await page.getByRole("button", { name: /Page content/ }).click();
    const fileInputs = page.locator('input[type="file"]');
    await expect(fileInputs).toHaveCount(2);
    await page.getByLabel("Alt text").nth(0).fill("A donated phone ready for mailing");
    await page.getByLabel("Alt text").nth(1).fill("Volunteers preparing donated phones");
    const png = { name: "hero.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]) };
    const webp = { name: "story.webp", mimeType: "image/webp", buffer: Buffer.from("RIFFxxxxWEBP") };
    await fileInputs.nth(0).setInputFiles(png);
    await expect(page.getByText(/Image sanitized and attached/)).toBeVisible();
    await fileInputs.nth(1).setInputFiles(webp);
    await expect(page.getByText(/Image sanitized and attached/)).toBeVisible();
    await page.getByRole("button", { name: /Promotion toolkit/ }).click();
    await expect(page.getByText("Canonical link")).toBeVisible();
    await expect(page.getByRole("link", { name: "Download QR code" })).toBeVisible();
    await page.getByRole("button", { name: "Reports" }).click();
    await expect(page.getByRole("heading", { name: "Campaign results without donor PII" })).toBeVisible();
    await expect(page.getByText("Figures are aggregate and do not include donor-level details or payment credentials.")).toBeVisible();
  });

  test("staff workspace searches a donation and records operational facts", async ({ page }) => {
    const donation = { id: "00000000-0000-4000-8000-000000000010", publicId: "DBM-E2E-STAFF", status: "processing", donorName: "Browser Fixture", donorEmail: "browser@example.com", charityName: "Community Phones Foundation", deviceCount: 1 };
    const detail = { ...donation, donor: { name: donation.donorName, email: donation.donorEmail, address1: "1 Test Way", address2: "", city: "Kissimmee", state: "FL", zip: "34741", country: "US" }, charity: { name: donation.charityName }, devices: [{ id: "00000000-0000-4000-8000-000000000011", donor_brand: "Apple", donor_model: "iPhone 13", receipt_status: "pending", inspection_status: "pending", processing_status: "pending", data_wipe_status: "not_started" }], notes: [], events: [], receivedAt: null, packageCondition: null };
    let staffRole: "staff" | "admin" = "staff";
    let publishedRequest: Record<string, unknown> | null = null;
    await page.route("**/api/staff/session", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, user: { id: "e2e-staff", role: staffRole } }) }));
    await page.route("**/api/auth/csrf", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrfToken: "e2e-csrf-token" }) }));
    await page.route("**/api/staff/donations?*", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ donations: [donation] }) }));
    await page.route("**/api/staff/donations/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const body = path.endsWith("/financials")
        ? { financials: { revision: 1, finalizedAt: null, disbursed: false, activeAllocation: null, allocations: [], sales: [], costs: [] } }
        : { donation: detail };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.route("**/api/staff/finance", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ finance: { policyHolds: 0, failedOutbox: 0, openEscalations: 0, allocations: [], disbursements: [] } }) }));
    await page.route("**/api/staff/campaigns", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ campaigns: { campaigns: [{ id: "00000000-0000-4000-8000-000000000020", name: "Review fixture", slug: "review-fixture", status: "draft", organizationName: "Fixture Org", charityName: "Community Phones Foundation", revisions: [{ id: "00000000-0000-4000-8000-000000000021", version: 3, status: "approved", headline: "Reviewed headline", summary: "Reviewed summary", contentHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }] }] } }) }));
    await page.route("**/api/staff/campaigns/00000000-0000-4000-8000-000000000020/revisions/00000000-0000-4000-8000-000000000021/preview", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ preview: { campaign: { id: "00000000-0000-4000-8000-000000000020", name: "Review fixture", slug: "review-fixture", status: "draft" }, organization: { name: "Fixture Org" }, charity: { name: "Community Phones Foundation", pledgeId: campaign.charityPledgeId }, differsFromPublished: true, changedFields: ["headline", "story"], revision: { id: "00000000-0000-4000-8000-000000000021", version: 3, status: "approved", headline: "Reviewed headline", summary: "Reviewed summary", story: "Full reviewed story.", ctaLabel: "Donate a Phone", contentHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", blocks: [{ type: "callout", content: { heading: "Callout", body: "Reviewed block" } }] } } }) }));
    await page.route("**/api/staff/campaigns/publish", async (route) => { publishedRequest = route.request().postDataJSON() as Record<string, unknown>; await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }); });
    await page.route("**/api/staff/partners", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ partners: { organizations: [] } }) }));
    await page.route("**/api/staff/partner-reviews", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ queue: { applications: [], profiles: [], campaigns: [] } }) }));
    await page.goto("/staff");
    await expect(page.getByRole("heading", { name: "Donation management" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish this exact approved revision" })).toHaveCount(0);
    await page.getByRole("button", { name: "Review exact revision" }).click();
    await expect(page.getByText("Full reviewed story.")).toBeVisible();
    await expect(page.getByText(/Full revision hash:/)).toBeVisible();
    await expect(page.getByText("00000000-0000-4000-8000-000000000021")).toBeVisible();
    await expect(page.getByText("This exact revision must be approved by an administrator before publication.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish this exact approved revision" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "DBM-E2E-STAFF" })).toBeVisible();
    await page.getByRole("button", { name: "DBM-E2E-STAFF" }).click();
    await expect(page.getByRole("heading", { name: "Receive package" })).toBeVisible();
    await page.getByLabel("Package condition").fill("sealed");
    await page.getByRole("button", { name: "Confirm physical receipt" }).click();
    await expect(page.getByRole("status")).toContainText("Saved and audited");

    // The same exact preview gains the publish control only after the server
    // derives an administrator role; the request must carry that exact pair.
    staffRole = "admin";
    await page.reload();
    await page.getByRole("button", { name: "Review exact revision" }).click();
    await expect(page.getByRole("button", { name: "Publish this exact approved revision" })).toBeVisible();
    await page.getByRole("button", { name: "Publish this exact approved revision" }).click();
    await expect.poll(() => publishedRequest).toEqual({ campaignId: "00000000-0000-4000-8000-000000000020", revisionId: "00000000-0000-4000-8000-000000000021" });
  });
});
