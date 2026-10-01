import { test, expect } from "./fixtures";

test.describe("Settings", () => {
  test("settings page loads all sections", async ({ authedPage: page }) => {
    await page.goto("/settings");
    // "Configuração de IA" / "Chaves de API do Prospex" live under the "IA e chaves de API"
    // tab, which is not the default tab and isn't rendered until activated.
    await page.getByRole("tab", { name: "IA e chaves de API" }).click();
    await expect(page.getByRole("heading", { name: /Chaves de API do Prospex/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Configuração de IA" })).toBeVisible();
  });

  test("create API key → appears in list", async ({ authedPage: page }) => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "IA e chaves de API" }).click();

    const keyName = `E2E Key ${Date.now()}`;

    // Fill key name input
    const nameInput = page.getByPlaceholder(/Nome da chave/i);
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill(keyName);

    // The create button is icon-only, identified by its accessible name.
    await page.getByRole("button", { name: "Criar chave de API" }).click();

    // New key should appear in the list
    await expect(page.getByText(keyName)).toBeVisible({ timeout: 5000 });
  });

  test("created API key shows px_ prefix", async ({ authedPage: page }) => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "IA e chaves de API" }).click();

    const nameInput = page.getByPlaceholder(/Nome da chave/i);
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill(`Prefix Test ${Date.now()}`);
    await page.getByRole("button", { name: "Criar chave de API" }).click();

    // The revealed key is shown in a read-only input's value, not as text
    // content, so it must be read via inputValue() rather than a text locator.
    const revealedKey = page.locator('input[readonly]');
    await expect(revealedKey).toBeVisible({ timeout: 5000 });
    await expect(revealedKey).toHaveValue(/^px_/);
  });

  test("delete API key removes it from list", async ({ authedPage: page }) => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "IA e chaves de API" }).click();

    const keyName = `Delete Test ${Date.now()}`;
    const nameInput = page.getByPlaceholder(/Nome da chave/i);
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill(keyName);
    await page.getByRole("button", { name: "Criar chave de API" }).click();
    await expect(page.getByText(keyName)).toBeVisible({ timeout: 5000 });

    // Delete it — find the row via its testid, click delete, confirm in the dialog.
    const row = page.getByTestId("key-row").filter({ hasText: keyName });
    await row.getByRole("button", { name: "Excluir chave de API" }).click();
    await page.getByRole("button", { name: "Excluir chave", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 8000 });
    await expect(row).not.toBeVisible();
  });

  test("save AI configuration", async ({ authedPage: page }) => {
    await page.goto("/settings");
    await page.getByRole("tab", { name: "IA e chaves de API" }).click();

    const apiKeyInput = page.locator('input[placeholder*="sk-"], input[placeholder*="chave do seu provedor"]').first();
    const saveBtn = page.locator('button:has-text("Salvar"), button:has-text("Atualizar")').first();

    if (await apiKeyInput.isVisible() && await saveBtn.isVisible()) {
      await apiKeyInput.fill("sk-test-placeholder-key");
      await saveBtn.click();
      // Should not crash — success feedback or no error
      await expect(page.locator("text=erro").or(page.locator(".text-red-400"))).not.toBeVisible({ timeout: 3000 });
    }
  });
});
