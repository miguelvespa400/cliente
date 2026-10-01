import { test, expect } from "./fixtures";

const CAMPAIGN = {
  name: `E2E Campaign ${Date.now()}`,
  location: "Jakarta",
  query: "Restaurant Jakarta Selatan",
  service: "Sistem manajemen restoran berbasis AI",
};

test.describe("Campaigns", () => {
  test("campaigns list page loads", async ({ authedPage: page }) => {
    await page.goto("/campaigns");
    await expect(page.getByRole("heading", { name: /campanhas/i })).toBeVisible();
  });

  test("create campaign form renders all required fields", async ({ authedPage: page }) => {
    await page.goto("/campaigns/new");
    await expect(page.locator("#name")).toBeVisible();
    await expect(page.getByText("Localização", { exact: true })).toBeVisible();
    await expect(page.getByText("Segmento", { exact: true })).toBeVisible();
    await expect(page.getByText("Termos de busca", { exact: true })).toBeVisible();
  });

  test("create campaign → starts scraper → completes with leads", async ({ authedPage: page }) => {
    await page.goto("/campaigns/new");

    // Fill form
    await page.fill("#name", CAMPAIGN.name);
    await page.fill('input[placeholder*="Curitiba, PR"], #location', CAMPAIGN.location);

    // Select industry (first available option)
    await page.locator('[id="industry"], button:has-text("Selecione o segmento")').first().click();
    await page.locator('[role="option"]').first().click();

    // Search query — scoped test id, since the header's global search box
    // also has a placeholder containing "Buscar" and would otherwise match.
    await page.getByTestId("query-input").first().fill(CAMPAIGN.query);

    // Your service
    const serviceField = page.locator('textarea, input[placeholder*="Descreva o que você oferece"]').first();
    if (await serviceField.isVisible()) await serviceField.fill(CAMPAIGN.service);

    // Submit
    await page.click('button[type="submit"]');

    // Should redirect to campaign detail page. Excludes "/campaigns/new"
    // itself, which the bare `[a-z0-9-]+` pattern would otherwise match if
    // the form failed to submit and the page never actually navigated.
    await page.waitForURL(/\/campaigns\/(?!new$)[a-z0-9-]+$/, { timeout: 15000 });
    await expect(page.getByText(CAMPAIGN.name)).toBeVisible();

    // Wait for campaign to complete (scraper uses mock fallback — should finish in < 30s)
    await expect(page.getByText("Concluída")).toBeVisible({ timeout: 45000 });
  });

  test("completed campaign shows leads", async ({ authedPage: page }) => {
    await page.goto("/campaigns");

    // Find first completed campaign and click it
    const completedBadge = page.locator("text=Concluída").first();
    await expect(completedBadge).toBeVisible({ timeout: 10000 });

    // Click the campaign row/card. Excludes the ever-present "Nova campanha"
    // button, whose href ("/campaigns/new") would otherwise match first.
    await page.locator("a[href^='/campaigns/']:not([href='/campaigns/new'])").first().click();
    await page.waitForURL(/\/campaigns\/(?!new$)[a-z0-9-]+$/);

    // Leads section should show at least 1 lead
    await expect(page.locator("text=/Leads \\(\\d+\\)/")).toBeVisible({ timeout: 10000 });
    const leadsText = await page.locator("text=/Leads \\(\\d+\\)/").textContent();
    const count = parseInt(leadsText?.match(/\d+/)?.[0] ?? "0");
    expect(count).toBeGreaterThan(0);
  });
});
