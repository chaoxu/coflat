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

test("document-properties form: reveal on title click, edit, macro preview", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon/.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
  const h = harness(page);

  await page.goto("/tests/e2e/fixtures/index.html");
  await h.setDoc(DOC);
  await settle(page);

  // Collapsed by default: title shown, no properties form.
  const title = page.locator(".cf-doc-title");
  await expect(title).toBeVisible();
  await expect(title).toContainText("Rank reduction");
  await expect(page.locator(".cf-doc-properties")).toHaveCount(0);

  // Clicking the title reveals the frontmatter: raw YAML + the properties form.
  await title.click();
  await expect(page.locator(".cf-doc-properties")).toBeVisible();
  await expect(page.locator(".cf-doc-properties-input")).toHaveCount(5);
  // Raw YAML is revealed alongside the form.
  await expect(page.locator(".cf-frontmatter-line").first()).toBeVisible();
  // Macro row renders a live KaTeX preview.
  await expect(page.locator(".cf-doc-properties-macro-preview .katex")).toBeVisible();

  // Edit the title field, committing by moving focus to another field (which
  // keeps the form open). Frontmatter updates; body preserved.
  const titleInput = page.locator(".cf-doc-properties-input").first();
  await titleInput.fill("Edited Title");
  await page.locator(".cf-doc-properties-input").nth(2).click(); // focus the Type field → commits title
  await expect(page.locator(".cf-doc-properties")).toBeVisible();
  await expect.poll(() => h.getDoc()).toContain('title: "Edited Title"');
  await expect.poll(() => h.getDoc()).toContain("motivated by a workshop question");

  // Add a macro → math map gains an entry, form stays open.
  await page.locator(".cf-doc-properties-add-macro").click();
  await expect.poll(() => h.getDoc()).toContain("\\new");
  await expect(page.locator(".cf-doc-properties")).toBeVisible();

  expect(errors).toEqual([]);
});

test("document-properties form: hides when the reveal clears", async ({ page }) => {
  const h = harness(page);
  await page.goto("/tests/e2e/fixtures/index.html");
  await h.setDoc(DOC);
  await settle(page);

  await page.locator(".cf-doc-title").click();
  await expect(page.locator(".cf-doc-properties")).toBeVisible();

  // Move the cursor into the body — the frontmatter reveal (and form) clears.
  await page.evaluate(() => {
    const view = (window as unknown as { __coflatEditorView: { focus(): void; state: { doc: { toString(): string } }; dispatch(t: unknown): void } }).__coflatEditorView;
    view.focus();
    const pos = view.state.doc.toString().indexOf("motivated") + 1;
    view.dispatch({ selection: { anchor: pos } });
  });
  await settle(page);
  await expect(page.locator(".cf-doc-properties")).toHaveCount(0);
});

test("document-properties form: editing a field keeps the YAML revealed and in sync", async ({ page }) => {
  const h = harness(page);
  await page.goto("/tests/e2e/fixtures/index.html");
  await h.setDoc(DOC);
  await settle(page);

  await page.locator(".cf-doc-title").click();
  await expect(page.locator(".cf-frontmatter-line").first()).toBeVisible();

  // Focusing a field blurs the editor; the raw YAML must stay revealed (not
  // collapse back to the title) so the edit is visible.
  const titleInput = page.locator(".cf-doc-properties-input").first();
  await titleInput.click();
  await expect(page.locator(".cf-frontmatter-line").first()).toBeVisible();

  await titleInput.fill("Synced Title");
  await titleInput.blur();
  await expect.poll(() => h.getDoc()).toContain('title: "Synced Title"');
});

test("document-properties form: add property adds an editable row and a frontmatter key", async ({ page }) => {
  const h = harness(page);
  await page.goto("/tests/e2e/fixtures/index.html");
  await h.setDoc(DOC);
  await settle(page);

  await page.locator(".cf-doc-title").click();
  await expect(page.locator(".cf-doc-properties")).toBeVisible();
  await expect(page.locator(".cf-doc-properties-extra-row")).toHaveCount(0);

  await page.locator(".cf-doc-properties-add-property").click();
  // The form stays open and gains an editable key/value row.
  await expect(page.locator(".cf-doc-properties-extra-row")).toHaveCount(1);
  await expect(page.locator(".cf-doc-properties")).toBeVisible();

  // Name and value the property → it lands in the frontmatter.
  await page.locator(".cf-doc-properties-extra-key").first().fill("license");
  await page.locator(".cf-doc-properties-extra-key").first().blur();
  await page.locator(".cf-doc-properties-extra-value").first().fill("CC-BY");
  await page.locator(".cf-doc-properties-extra-value").first().blur();
  await expect.poll(() => h.getDoc()).toMatch(/license:\s*"?CC-BY"?/);
});

test("document-properties form: closes when navigating away after editing", async ({ page }) => {
  const h = harness(page);
  await page.goto("/tests/e2e/fixtures/index.html");
  await h.setDoc(DOC);
  await settle(page);

  await page.locator(".cf-doc-title").click();
  const titleInput = page.locator(".cf-doc-properties-input").first();
  await titleInput.click();
  await titleInput.fill("Edited");
  await expect(page.locator(".cf-doc-properties")).toBeVisible();

  // Click into the document body — the form must close deterministically.
  await page.getByText("motivated by a workshop").click();
  await settle(page);
  await expect(page.locator(".cf-doc-properties")).toHaveCount(0);
  await expect(page.locator(".cf-frontmatter-line")).toHaveCount(0);
});
