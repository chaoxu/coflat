import { expect, type Locator, type Page, test } from "@playwright/test";

interface EditorHarness {
  setDoc: (doc: string) => void;
  setMode: (mode: "rich" | "source") => void;
}

interface EditorViewHarness {
  state: {
    selection: { main: { from: number; to: number } };
    sliceDoc: (from: number, to: number) => string;
  };
}

async function setDoc(page: Page, doc: string): Promise<void> {
  await page.evaluate((d) => {
    const editor = (window as unknown as { __coflatEditor: EditorHarness }).__coflatEditor;
    editor.setDoc(d);
    editor.setMode("rich");
  }, doc);
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  });
}

async function textRect(
  locator: Locator,
  text: string,
): Promise<{ left: number; top: number; height: number; width: number }> {
  return locator.evaluate((el, t) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const index = (node.nodeValue ?? "").indexOf(t);
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + t.length);
        const rect = range.getClientRects()[0];
        if (!rect) throw new Error(`no rect for ${t}`);
        return { left: rect.left, top: rect.top, height: rect.height, width: rect.width };
      }
      node = walker.nextNode();
    }
    throw new Error(`no text node for ${t}`);
  }, text);
}

async function dragBetweenText(
  page: Page,
  locator: Locator,
  start: string,
  end: string,
): Promise<void> {
  const a = await textRect(locator, start);
  const b = await textRect(locator, end);
  await page.mouse.move(a.left + 2, a.top + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.left + b.width - 2, b.top + b.height / 2, { steps: 8 });
  await page.mouse.up();
  await settle(page);
}

async function selectedText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const view = (window as unknown as { __coflatEditorView?: EditorViewHarness | null })
      .__coflatEditorView;
    if (!view) return "";
    const { from, to } = view.state.selection.main;
    return view.state.sliceDoc(from, to);
  });
}

// Regression for cosheaf #200: a title-less frontmatter block must hide as a
// clean CM block, so the first body line keeps its paragraph-flow rendering and
// stays mouse-drag selectable.
const DOC =
  "---\nid: ztrcpji2\n---\n\nmotivated by a workshop question with enough rendered words to drag.\n\nsecond paragraph with plenty of words to drag here.\n";

test("first line after frontmatter is mouse-drag selectable", async ({ page }) => {
  await page.goto("/tests/e2e/fixtures/index.html");
  await setDoc(page, DOC);
  await settle(page);

  const firstLine = page.locator(".cm-line", { hasText: "motivated by a workshop" }).first();
  await dragBetweenText(page, firstLine, "motivated", "drag");

  await expect.poll(() => selectedText(page)).toContain("motivated by a workshop");
});
