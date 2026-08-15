import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoAxeViolations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations, result.violations.map(({ id,help,nodes }) => `${id}: ${help} (${nodes.length})`).join("\n")).toEqual([]);
}

async function mockPartner(page: Page) {
  const zeroMetrics = { views: 0, donationStarts: 0, submittedDonations: 0, phonesPledged: 0, phonesReceived: 0, phonesProcessed: 0, completedDonations: 0 };
  const zeroFinancial = { grossProceedsCents: 0, eligibleCostCents: 0, allocableBaseCents: 0, allocationCents: 0, provisional: true, disbursementStatus: "not_prepared" };
  await page.route("**/api/partner/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await page.route("**/api/auth/csrf", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"csrfToken":"fixture"}' }));
  await page.route("**/api/partner/overview", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ partner: { organizations: [{
    id: "00000000-0000-4000-8000-000000000001", name: "Accessible Charity", slug: "accessible-charity", role: "partner_viewer",
    onboarding: { organizationProfile: true, verifiedBeneficiary: true, team: true, campaignTerms: false, campaignContent: false, publicationReview: false },
    campaigns: [{ id: "00000000-0000-4000-8000-000000000002", slug: "accessible-campaign", name: "Accessible Campaign", status: "published", charityName: "Accessible Charity", reviewState: "editing", metrics: zeroMetrics, financial: zeroFinancial }],
    verifiedCharities: [], team: [], invitations: [], recentActivity: [],
  }] } }) }));
}

async function mockPartnerOnboarding(page: Page) {
  await page.route("**/api/partner/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await page.route("**/api/partner/overview", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ partner: { organizations: [{
    id: "00000000-0000-4000-8000-000000000040", name: "Accessible Charity", slug: "accessible-charity", role: "partner_admin",
    onboarding: { organizationProfile: true, verifiedBeneficiary: true, team: false, campaignTerms: false, campaignContent: false, launchDates: false, toolkit: false, publicationReview: false },
    campaigns: [], verifiedCharities: [{ id: "00000000-0000-4000-8000-000000000041", name: "Accessible Charity", pledgeId: "11111111-1111-4111-8111-111111111111" }],
    team: [], invitations: [], recentActivity: [],
  }] } }) }));
  await page.route("**/api/partner/organizations/00000000-0000-4000-8000-000000000040/campaign-slugs/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"available":true}' }));
}

const PUBLIC_STATIC_PATHS = [
  "/",
  "/about.html",
  "/accessibility.html",
  "/articles.html",
  "/contact.html",
  "/data-security.html",
  "/donate-phone.html",
  "/for-nonprofits.html",
  "/get-involved.html",
  "/how-it-works.html",
  "/phone-drives.html",
  "/prepare-phone.html",
  "/privacy.html",
  "/receipts.html",
  "/resources.html",
  "/team.html",
  "/terms.html",
  "/transparency.html",
] as const;

test.describe("responsive and accessible production-readiness surfaces", () => {
  test("every public static page has no axe violations", async ({ page }) => {
    for (const path of PUBLIC_STATIC_PATHS) {
      await page.goto(path);
      await expectNoAxeViolations(page);
      if (path === "/for-nonprofits.html") await expect(page.getByRole("link", { name: "See the setup steps" })).toBeVisible();
    }
  });

  test("public, intake, sign-in confirmation, and partner workspace have no axe violations", async ({ page }) => {
    for (const path of ["/", "/partner/apply", "/auth/confirm?error=invalid"]) {
      await page.goto(path);
      await expectNoAxeViolations(page);
    }
    await mockPartner(page);
    await page.goto("/partner");
    await expect(page.getByRole("heading", { name: "Accessible Charity" })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("first campaign onboarding has no axe violations at each step", async ({ page }) => {
    await mockPartnerOnboarding(page);
    await page.goto("/partner");
    await page.getByRole("button", { name: "Campaigns", exact: true }).click();
    await page.getByRole("button", { name: "Start my first campaign" }).click();
    await expectNoAxeViolations(page);
    await page.getByLabel("Campaign name").fill("Spring phone drive");
    await expect(page.getByRole("status")).toContainText("link is available");
    await page.getByRole("button", { name: "Next: choose support" }).click();
    await expectNoAxeViolations(page);
    await page.getByLabel("Verified nonprofit").selectOption("00000000-0000-4000-8000-000000000041");
    await page.getByRole("button", { name: "Next: tell the story" }).click();
    await expectNoAxeViolations(page);
  });

  test("key public and partner-intake pages do not overflow common viewports", async ({ page }) => {
    for (const viewport of [{ width: 320, height: 700 }, { width: 430, height: 850 }, { width: 768, height: 900 }, { width: 1366, height: 900 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(viewport);
      for (const path of ["/", "/partner/apply"]) {
        await page.goto(path);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      }
    }
  });

  test("navigation remains keyboard usable and layout survives 200 percent text", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto("/partner/apply");
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await expect(page.getByRole("heading", { name: "Tell us about the campaign you want to run." })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
  });
});
