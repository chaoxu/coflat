import { expect, type Page, test } from "@playwright/test";

interface EditorHarness {
  setDoc: (doc: string) => void;
  setMode: (mode: "rich" | "source") => void;
  getDoc: () => string;
}

function harness(page: Page) {
  return {
    setDoc: (doc: string) =>
      page.evaluate((d) => {
        const e = (window as unknown as { __coflatEditor: EditorHarness }).__coflatEditor;
        e.setDoc(d);
        e.setMode("rich");
      }, doc),
    getDoc: () =>
      page.evaluate(() => (window as unknown as { __coflatEditor: EditorHarness }).__coflatEditor.getDoc()),
  };
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  });
}

const DOC = `---
title: "Rank reduction"
id: ztrcpji2
bibliography: reference.bib
math:
  \\cl: "\\\\operatorname{cl}"
---

motivated by a workshop question
`;

test("document-properties panel: chip, expand, edit, macro preview", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon/.test(m.text())) errors.push(m.text());
  });
  const h = harness(page);

  await page.goto("/tests/e2e/fixtures/index.html");
  await h.setDoc(DOC);
  await settle(page);

  // Collapsed chip summarizes the metadata.
  const chip = page.locator(".cf-doc-properties-chip");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("Rank reduction");
  await expect(chip).toContainText("ztrcpji2");
  await expect(page.locator(".cf-doc-properties-panel")).toHaveCount(0);

  // Expand.
  await chip.click();
  await expect(page.locator(".cf-doc-properties-panel")).toBeVisible();
  await expect(page.locator(".cf-doc-properties-input")).toHaveCount(5);
  // Macro row renders a live KaTeX preview.
  await expect(page.locator(".cf-doc-properties-macro-preview .katex")).toBeVisible();

  // Edit the title field → frontmatter updates, body preserved.
  const title = page.locator(".cf-doc-properties-input").first();
  await title.fill("Edited Title");
  await title.blur();
  await expect.poll(() => h.getDoc()).toContain('title: "Edited Title"');
  await expect.poll(() => h.getDoc()).toContain("motivated by a workshop question");

  // Add a macro → math map gains an entry.
  await page.locator(".cf-doc-properties-add-macro").click();
  await expect.poll(() => h.getDoc()).toContain("\\new");

  expect(errors).toEqual([]);
});
