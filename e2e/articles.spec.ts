import { expect, test } from "@playwright/test";

const article = {
  id: "00000000-0000-4000-8000-000000000101",
  slug: "phone-data-basics",
  title: "Phone data basics",
  excerpt: "A short guide for preparing an old phone.",
  authorName: "Donate by Mail",
  publishedAt: "2026-08-01T12:00:00Z",
  seoTitle: "Phone data basics | Donate by Mail",
  seoDescription: "Prepare an old phone for donation.",
  contentBlocks: [
    { type: "heading", level: 2, text: "Before you mail" },
    { type: "paragraph", text: "Back up and sign out before sending your phone." },
    { type: "list", items: ["Back up your photos", "Remove account locks"] },
    { type: "link", label: "Prepare your phone", href: "/prepare-phone.html" },
  ],
  contentHash: "a".repeat(64), revisionId: "00000000-0000-4000-8000-000000000102", version: 1,
};

test.describe("editorial article surface", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: false }) }));
    await page.route("**/api/articles**", async (route) => {
      if (route.request().url().endsWith("phone-data-basics")) await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, article }) });
      else await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, articles: [article] }) });
    });
  });

  test("lists and renders typed article blocks with metadata", async ({ page }) => {
    await page.goto("/articles");
    await expect(page.getByRole("heading", { name: "Blog" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Phone data basics" })).toBeVisible();
    await page.getByRole("link", { name: "Phone data basics" }).click();
    await expect(page).toHaveURL(/\/articles\/phone-data-basics$/);
    await expect(page.getByRole("heading", { name: "Before you mail" })).toBeVisible();
    await expect(page.getByText("<script>", { exact: false })).toHaveCount(0);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", article.seoDescription);
    await expect(page.locator('script[data-article-structured-data="true"]')).toHaveCount(1);
  });

  test("stays within the viewport on a small screen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/articles");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });

  test("keeps the donor CTA prominent and groups secondary navigation", async ({ page }) => {
    await page.goto("/articles");
    await expect(page.locator("a.skip-link")).toHaveCount(1);
    await expect(page.locator("a.skip")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Donate a phone" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "How it works" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "For nonprofits" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Help and FAQs" }).first()).toBeVisible();
    const desktopMore = page.locator(".desktop-nav .nav-menu");
    await desktopMore.locator("summary").click();
    await expect(desktopMore).toHaveAttribute("open", "");
    await page.getByRole("heading", { name: "Blog" }).click();
    await expect(desktopMore).not.toHaveAttribute("open", "");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("link", { name: "Donate a phone" }).last()).toBeVisible();
    await page.getByText("More", { exact: true }).last().click();
    await expect(page.getByRole("link", { name: "Blog" }).last()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".mobile-nav .nav-menu")).not.toHaveAttribute("open", "");
  });
});
