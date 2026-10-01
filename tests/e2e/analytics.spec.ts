import { test, expect } from "./fixtures";

test.describe("Analytics", () => {
  test("analytics page loads without error", async ({ authedPage: page }) => {
    await page.goto("/analytics");
    await expect(page.getByRole("heading", { name: /análises/i })).toBeVisible();
    // Should not show error state
    await expect(page.locator("text=Falha ao carregar")).not.toBeVisible();
    await expect(page.locator("text=Não autorizado")).not.toBeVisible();
  });

  test("overview stats cards render", async ({ authedPage: page }) => {
    await page.goto("/analytics");
    // Stats cards — look for known labels
    const labels = ["Total de leads", "Campanhas ativas", "Taxa de conversão", "Negócios ganhos"];
    for (const label of labels) {
      await expect(page.getByText(label)).toBeVisible({ timeout: 8000 });
    }
  });

  test("dashboard overview page loads", async ({ authedPage: page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("text=Não autorizado")).not.toBeVisible();
  });

  test("integrations page loads", async ({ authedPage: page }) => {
    await page.goto("/integrations");
    await expect(page.getByRole("heading", { name: /integrações/i })).toBeVisible();
    await expect(page.getByText("WhatsApp Business")).toBeVisible();
  });
});
