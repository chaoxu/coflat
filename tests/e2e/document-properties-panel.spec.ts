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

  // Clicking the title opens the properties form. The form is the sole
  // frontmatter editor — the raw YAML is NOT exposed inline.
  await title.click();
  await expect(page.locator(".cf-doc-properties")).toBeVisible();
  await expect(page.locator(".cf-doc-properties-input")).toHaveCount(5);
  await expect(page.locator(".cf-frontmatter-line")).toHaveCount(0);
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

test("document-properties form: keeps the form open while editing a field (no inline YAML)", async ({ page }) => {
  const h = harness(page);
  await page.goto("/tests/e2e/fixtures/index.html");
  await h.setDoc(DOC);
  await settle(page);

  await page.locator(".cf-doc-title").click();
  await expect(page.locator(".cf-doc-properties")).toBeVisible();

  // Focusing a field blurs the editor; the form must stay open (and the raw YAML
  // must never appear inline).
  const titleInput = page.locator(".cf-doc-properties-input").first();
  await titleInput.click();
  await expect(page.locator(".cf-doc-properties")).toBeVisible();
  await expect(page.locator(".cf-frontmatter-line")).toHaveCount(0);

  // Commit by moving focus to another field (keeps the form open).
  await titleInput.fill("Synced Title");
  await page.locator(".cf-doc-properties-input").nth(2).click();
  await expect.poll(() => h.getDoc()).toContain('title: "Synced Title"');
});

test("document-properties form: Edit as YAML edits the whole frontmatter block", async ({ page }) => {
  const h = harness(page);
  await page.goto("/tests/e2e/fixtures/index.html");
  await h.setDoc(DOC);
  await settle(page);

  await page.locator(".cf-doc-title").click();
  await page.locator(".cf-doc-properties-yaml").click(); // "Edit as YAML"

  const raw = page.locator(".cf-doc-properties-raw-input");
  await expect(raw).toBeVisible();
  await expect(raw).toHaveValue(/title: "Rank reduction"/);

  // Edit the raw YAML directly, including a key the form doesn't model.
  await raw.fill('title: "Raw Edited"\nkeywords: [a, b]');
  await raw.blur();
  await expect.poll(() => h.getDoc()).toContain('title: "Raw Edited"');
  await expect.poll(() => h.getDoc()).toContain("keywords: [a, b]");

  // Back to the form reflects the new title.
  await page.locator(".cf-doc-properties-yaml").click(); // "← Back to form"
  await expect(page.locator(".cf-doc-properties-input").first()).toHaveValue("Raw Edited");
});

test("document-properties form: switching modes commits a pending field edit", async ({ page }) => {
  const h = harness(page);
  await page.goto("/tests/e2e/fixtures/index.html");
  await h.setDoc(DOC);
  await settle(page);

  await page.locator(".cf-doc-title").click();
  // Type into Title but do NOT blur, then switch to YAML — the edit must persist.
  await page.locator(".cf-doc-properties-input").first().fill("Committed On Switch");
  await page.locator(".cf-doc-properties-yaml").click(); // Edit as YAML
  await expect(page.locator(".cf-doc-properties-raw-input")).toHaveValue(/title: "Committed On Switch"/);

  // Type into the raw textarea but do NOT blur, then switch back — must persist.
  await page.locator(".cf-doc-properties-raw-input").fill('title: "Round Tripped"');
  await page.locator(".cf-doc-properties-yaml").click(); // Back to form
  await expect(page.locator(".cf-doc-properties-input").first()).toHaveValue("Round Tripped");
  await expect.poll(() => h.getDoc()).toContain('title: "Round Tripped"');
});

test("document-properties form: mode switch stays open when a field held focus", async ({ page }) => {
  const h = harness(page);
  await page.goto("/tests/e2e/fixtures/index.html");
  await h.setDoc(DOC);
  await settle(page);

  await page.locator(".cf-doc-title").click();
  // Focus a field first, so `formFocused` is the only thing keeping it open.
  await page.locator(".cf-doc-properties-input").first().click();
  await expect(page.locator(".cf-doc-properties")).toBeVisible();

  // Switch to YAML and back — the panel must not close on either switch.
  await page.locator(".cf-doc-properties-yaml").click(); // Edit as YAML
  await expect(page.locator(".cf-doc-properties-raw-input")).toBeVisible();
  await page.locator(".cf-doc-properties-yaml").click(); // Back to form
  await expect(page.locator(".cf-doc-properties-input").first()).toBeVisible();
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

test("document-properties form: + add macro adds distinct rows on each click", async ({ page }) => {
  const h = harness(page);
  await page.goto("/tests/e2e/fixtures/index.html");
  await h.setDoc(DOC);
  await settle(page);

  await page.locator(".cf-doc-title").click();
  await page.locator(".cf-doc-properties-add-macro").click();
  await page.locator(".cf-doc-properties-add-macro").click();
  // Two clicks must yield two distinct macro rows (regression: always used \new).
  await expect(page.locator(".cf-doc-properties-macro-row")).toHaveCount(3); // 1 seed (\cl) + 2 added
  await expect.poll(() => h.getDoc()).toMatch(/\\new\b/);
  await expect.poll(() => h.getDoc()).toMatch(/\\new2\b/);
});

test("document-properties form: add works (no crash) on malformed/non-map math", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  const h = harness(page);
  await page.goto("/tests/e2e/fixtures/index.html");
  await h.setDoc(`---\ntitle: T\nmath: not-a-map\n---\n\nBody.\n`);
  await settle(page);

  await page.locator(".cf-doc-title").click();
  await page.locator(".cf-doc-properties-add-macro").click();
  await settle(page);
  // The non-map math is replaced with a real map; add-macro succeeds, no crash.
  await expect(page.locator(".cf-doc-properties-macro-row")).toHaveCount(1);
  await expect.poll(() => h.getDoc()).toMatch(/\\new\b/);
  expect(errors).toEqual([]);
});

test("document-properties form: does not get stuck open after setDoc replaces the document", async ({ page }) => {
  const h = harness(page);
  await page.goto("/tests/e2e/fixtures/index.html");
  await h.setDoc(DOC);
  await settle(page);

  await page.locator(".cf-doc-title").click();
  await page.locator(".cf-doc-properties-input").first().click(); // focus a field → formFocused=true
  await expect(page.locator(".cf-doc-properties")).toBeVisible();

  // Replace the whole document programmatically (no mode reconfigure) — the
  // panel must not stay open bound to the new doc.
  await page.evaluate(() => {
    (window as unknown as { __coflatEditor: EditorHarness }).__coflatEditor.setDoc(
      "---\ntitle: Fresh\n---\n\nA different document.\n",
    );
  });
  await settle(page);
  await expect(page.locator(".cf-doc-properties")).toHaveCount(0);
});

test("document-properties form: + add property commits a pending field edit", async ({ page }) => {
  const h = harness(page);
  await page.goto("/tests/e2e/fixtures/index.html");
  await h.setDoc(DOC);
  await settle(page);

  await page.locator(".cf-doc-title").click();
  // Type into Title (no blur), then click "+ add property" — Title must commit.
  await page.locator(".cf-doc-properties-input").first().fill("Kept On Add");
  await page.locator(".cf-doc-properties-add-property").click();
  await expect(page.locator(".cf-doc-properties-extra-row")).toHaveCount(1);
  await expect.poll(() => h.getDoc()).toContain('title: "Kept On Add"');
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
