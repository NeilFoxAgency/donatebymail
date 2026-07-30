import { expect, test } from "@playwright/test";

const campaign = {
  slug: "beta-phone-drive",
  name: "Beta Phone Drive",
  charityPledgeId: "11111111-1111-4111-8111-111111111111",
  charityName: "Community Phones Foundation",
  charity: { pledgeId: "11111111-1111-4111-8111-111111111111", name: "Community Phones Foundation", logoUrl: "" },
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
    await expect(page.getByText("Choose a different charity")).toBeVisible();
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

  test("partner workspace edits a campaign and uploads both reviewed image slots", async ({ page }) => {
    const campaignDetail = {
      id: "00000000-0000-4000-8000-000000000001",
      slug: "beta-phone-drive",
      name: "Beta Phone Drive",
      status: "draft",
      charityName: "Community Phones Foundation",
      revisions: [{ id: "00000000-0000-4000-8000-000000000002", version: 1, status: "draft", headline: "A phone can help", summary: "A short summary.", story: "A longer story.", ctaLabel: "Donate a Phone", blocks: [] }],
    };
    await page.route("**/api/partner/session", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true }) }));
    await page.route("**/api/auth/csrf", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrfToken: "e2e-csrf-token" }) }));
    await page.route("**/api/partner/overview", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ partner: { organizations: [{ id: "00000000-0000-4000-8000-000000000003", name: "Community Phones", role: "partner_admin", campaigns: [{ id: campaignDetail.id, slug: campaignDetail.slug, name: campaignDetail.name, status: "draft", charityName: campaignDetail.charityName }], verifiedCharities: [{ id: "00000000-0000-4000-8000-000000000004", name: campaignDetail.charityName, pledgeId: campaign.charityPledgeId }] }] } }) }));
    await page.route("**/api/partner/campaigns/**", async (route) => {
      if (route.request().method() === "POST" || route.request().method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ campaign: campaignDetail, asset: { id: "00000000-0000-4000-8000-000000000005" } }) });
      }
    });
    await page.goto("/partner");
    await expect(page.getByRole("heading", { name: "Phone-drive campaigns" })).toBeVisible();
    await page.getByRole("button", { name: "Edit campaign" }).click();
    await expect(page.getByRole("heading", { name: "Edit Beta Phone Drive" })).toBeVisible();
    const fileInputs = page.locator('input[type="file"]');
    await expect(fileInputs).toHaveCount(2);
    const png = { name: "hero.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]) };
    const webp = { name: "story.webp", mimeType: "image/webp", buffer: Buffer.from("RIFFxxxxWEBP") };
    await fileInputs.nth(0).setInputFiles(png);
    await expect(page.getByRole("status")).toContainText("Hero image uploaded");
    await fileInputs.nth(1).setInputFiles(webp);
    await expect(page.getByRole("status")).toContainText("Story image uploaded");
    await page.getByRole("button", { name: "Save new revision" }).click();
    await expect(page.getByText("A new campaign revision was saved for review.")).toBeVisible();
  });

  test("staff workspace searches a donation and records operational facts", async ({ page }) => {
    const donation = { id: "00000000-0000-4000-8000-000000000010", publicId: "DBM-E2E-STAFF", status: "processing", donorName: "Browser Fixture", donorEmail: "browser@example.com", charityName: "Community Phones Foundation", deviceCount: 1 };
    const detail = { ...donation, donor: { name: donation.donorName, email: donation.donorEmail, address1: "1 Test Way", address2: "", city: "Kissimmee", state: "FL", zip: "34741", country: "US" }, charity: { name: donation.charityName }, devices: [{ id: "00000000-0000-4000-8000-000000000011", donor_brand: "Apple", donor_model: "iPhone 13", receipt_status: "pending", inspection_status: "pending", processing_status: "pending", data_wipe_status: "not_started" }], notes: [], events: [], receivedAt: null, packageCondition: null };
    await page.route("**/api/staff/session", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true }) }));
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
    await page.route("**/api/staff/campaigns", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ campaigns: { campaigns: [] } }) }));
    await page.route("**/api/staff/partners", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ partners: { organizations: [] } }) }));
    await page.goto("/staff");
    await expect(page.getByRole("heading", { name: "Donation management" })).toBeVisible();
    await expect(page.getByRole("button", { name: "DBM-E2E-STAFF" })).toBeVisible();
    await page.getByRole("button", { name: "DBM-E2E-STAFF" }).click();
    await expect(page.getByRole("heading", { name: "Receive package" })).toBeVisible();
    await page.getByLabel("Package condition").fill("sealed");
    await page.getByRole("button", { name: "Confirm physical receipt" }).click();
    await expect(page.getByRole("status")).toContainText("Saved and audited");
  });
});
