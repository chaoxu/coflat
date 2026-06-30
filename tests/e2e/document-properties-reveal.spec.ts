/**
 * Regression: the document-properties panel must not break inline source-reveal.
 *
 * The panel was originally a doc-anchored block widget at position 0. That
 * widget crashed CM6's block renderer ("Cannot destructure 'tile'") whenever a
 * frontmatter edit added or removed a line, and a thrown decoration-field update
 * aborts the WHOLE transaction — including plain cursor moves — so moving the
 * cursor into emphasis like *haha* stopped revealing its `*` markers. The panel
 * is now a `showPanel` top panel (outside the document model); these tests lock
 * that reveal keeps working with the panel present, including across the
 * frontmatter line add/remove edits that used to crash.
 */

import { expect, type Page, test } from "@playwright/test";

interface EditorHarness {
  setDoc: (doc: string) => void;
  setMode: (mode: "rich" | "source") => void;
  getDoc: () => string;
}

function setDoc(page: Page, doc: string) {
  return page.evaluate((d) => {
    const e = (window as unknown as { __coflatEditor: EditorHarness }).__coflatEditor;
    e.setDoc(d);
    e.setMode("rich");
  }, doc);
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  });
}

/** Move the cursor to `pos` and wait past the pointer-driven reveal freeze. */
async function moveCursor(page: Page, pos: number): Promise<void> {
  await page.evaluate((p) => {
    const view = (window as unknown as { __coflatEditorView: { focus(): void; dispatch(t: unknown): void } }).__coflatEditorView;
    view.focus();
    view.dispatch({ selection: { anchor: p } });
  }, pos);
  // Source reveal is frozen for ~100ms after pointer interaction; clear it.
  await page.waitForTimeout(250);
  await settle(page);
}

function revealedDelimiters(page: Page) {
  return page.locator(".cf-source-delimiter").count();
}

const DOC = `---
title: Hi
---

some *haha* text here
`;
const EMPHASIS_INSIDE = DOC.indexOf("haha") + 1;
const OUTSIDE = DOC.indexOf("text") + 1;

test("reveal: cursor into emphasis shows source markers with the panel present", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));

  await page.goto("/tests/e2e/fixtures/index.html");
  await setDoc(page, DOC);
  await settle(page);

  // Panel is present.
  await expect(page.locator(".cf-doc-properties-chip")).toBeVisible();

  await moveCursor(page, OUTSIDE);
  expect(await revealedDelimiters(page)).toBe(0);

  await moveCursor(page, EMPHASIS_INSIDE);
  expect(await revealedDelimiters(page)).toBe(2);

  expect(errors).toEqual([]);
});

test("reveal: survives a frontmatter edit that adds then removes a line", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));

  await page.goto("/tests/e2e/fixtures/index.html");
  await setDoc(page, DOC);
  await settle(page);

  // Add a frontmatter line via the panel (the old block widget crashed here).
  await page.locator(".cf-doc-properties-chip").click();
  await page.locator(".cf-doc-properties-add-macro").click();
  await settle(page);
  // Remove it again.
  await page.locator(".cf-doc-properties-macro-remove").first().click();
  await settle(page);

  // Reveal must still work after the line add/remove churn. Recompute the
  // emphasis position from the live doc — the edits may have shifted offsets.
  const inside = await page.evaluate(() => {
    const view = (window as unknown as { __coflatEditorView: { state: { doc: { toString(): string } } } }).__coflatEditorView;
    return view.state.doc.toString().indexOf("haha") + 1;
  });
  await moveCursor(page, inside);
  expect(await revealedDelimiters(page)).toBe(2);

  expect(errors).toEqual([]);
});
