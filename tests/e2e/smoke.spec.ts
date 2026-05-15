import { expect, test } from "@playwright/test";

test("editor mounts and accepts input", async ({ page }) => {
  await page.goto("/tests/e2e/fixtures/index.html");

  const cmEditor = page.locator(".cm-editor");
  await expect(cmEditor).toBeVisible();

  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.type("hello playwright");

  await expect(content).toContainText("hello playwright");
});
