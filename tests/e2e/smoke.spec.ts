import { expect, type Page, test } from "@playwright/test";
import {
  expectLoadedSplitContentPixelsMatch,
  loadParityPairSurface,
  loadParitySurface,
  NESTED_MATH_PARITY_SOURCE,
  PARITY_PIXEL_PRESETS,
  setParitySource,
} from "./parity-harness";

async function setEditorDoc(page: Page, doc: string, mode: "rich" | "source" = "rich") {
  await page.evaluate(({ doc, mode }) => {
    const editor = (window as unknown as {
      __coflatEditor: {
        setDoc: (doc: string) => void;
        setMode: (mode: "rich" | "source") => void;
      };
    }).__coflatEditor;
    editor.setDoc(doc);
    editor.setMode(mode as "rich" | "source");
  }, { doc, mode });
}

async function getEditorDoc(page: Page) {
  return page.evaluate(() => {
    return (window as unknown as {
      __coflatEditor: { getDoc: () => string };
    }).__coflatEditor.getDoc();
  });
}

test("editor mounts and accepts input", async ({ page }) => {
  await page.goto("/tests/e2e/fixtures/index.html");

  const cmEditor = page.locator(".cm-editor");
  await expect(cmEditor).toBeVisible();

  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.type("hello playwright");

  await expect(content).toContainText("hello playwright");
});

test("editor supports ordinary list exit and marker removal while writing", async ({ page }) => {
  await page.goto("/tests/e2e/fixtures/index.html");
  await setEditorDoc(page, "- item", "source");

  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("Meta+ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("After list");
  await expect.poll(() => getEditorDoc(page)).toBe("- item\n\nAfter list");

  await setEditorDoc(page, "- one\n- two", "source");
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __coflatEditor: { focus: () => void; scrollToPosition: (from: number) => void };
    }).__coflatEditor;
    editor.scrollToPosition("- one\n- ".length);
    editor.focus();
  });
  await page.keyboard.press("Backspace");
  await expect.poll(() => getEditorDoc(page)).toBe("- one\ntwo");
});

test("rich editor supports ordinary fenced code and display math writing", async ({ page }) => {
  await page.goto("/tests/e2e/fixtures/index.html");
  await setEditorDoc(page, "", "rich");

  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.type("```js");
  await page.keyboard.press("Enter");
  await page.keyboard.type("const y = 2;");
  await page.keyboard.press("Enter");
  await page.keyboard.type("```");
  await page.keyboard.press("Enter");
  await page.keyboard.type("after");

  await expect.poll(() => getEditorDoc(page)).toBe("```js\nconst y = 2;\n```\nafter");

  await setEditorDoc(page, "", "rich");
  await content.click();
  await page.keyboard.type("$$");
  await page.keyboard.type("x=1");
  await page.keyboard.press("Enter");
  await page.keyboard.type("$$");
  await page.keyboard.press("Enter");
  await page.keyboard.type("after");

  await expect.poll(() => getEditorDoc(page)).toBe("$$\nx=1\n$$\nafter");
});

test("rich editor keeps a usable writing column on narrow viewports", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/tests/e2e/fixtures/index.html");
  await setEditorDoc(page, "# A long heading that should not collapse into a tiny strip", "rich");

  const lineWidth = await page.locator(".cm-line").first().evaluate((el) =>
    Math.round(el.getBoundingClientRect().width)
  );
  expect(lineWidth).toBeGreaterThan(240);
});

test("public demo uses page-level scrolling over the editor", async ({ page }) => {
  await page.goto("/examples/simple/index.html");

  const scroller = page.locator(".cm-scroller");
  await expect(scroller).toBeVisible();

  const scrollStyles = await scroller.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      clientHeight: el.clientHeight,
      overflowY: style.overflowY,
      overscrollBehaviorY: style.overscrollBehaviorY,
      scrollHeight: el.scrollHeight,
    };
  });
  expect(scrollStyles.overflowY).toBe("visible");
  expect(scrollStyles.overscrollBehaviorY).toBe("auto");
  expect(scrollStyles.scrollHeight).toBe(scrollStyles.clientHeight);

  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await scroller.boundingBox();
  if (!box) {
    throw new Error("Missing public demo editor scroller");
  }

  await page.mouse.move(
    box.x + Math.min(40, box.width / 2),
    box.y + Math.min(300, box.height / 2),
  );
  for (let i = 0; i < 8; i += 1) {
    await page.mouse.wheel(0, 700);
  }

  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
  await expect
    .poll(() => page.evaluate(() => document.body.innerText.includes("This footnote has bold")))
    .toBe(true);
});

test("public demo hydrates bibliography citations", async ({ page }) => {
  await page.goto("/examples/simple/index.html");

  await expect.poll(() =>
    page.locator('[data-ref-key="cormen2009"]').count()
  ).toBeGreaterThan(0);

  const firstCitation = page.locator('[data-ref-key="cormen2009"]').first();
  await expect(firstCitation).toContainText("[1]");
  await expect(firstCitation).toHaveClass(/cf-citation/);
  await expect(firstCitation).not.toHaveClass(/cf-crossref-unresolved/);
});

test("blueprint book theme applies to a host-rendered reader document", async ({ page }) => {
  await page.goto("/tests/e2e/fixtures/theme.html");

  const shell = page.locator(".cf-reader-shell");
  const header = page.locator(".cf-reader-header");
  const reader = page.locator(".cf-reader");
  const toc = page.locator(".cf-reader-toc");
  const definition = page.locator(".cf-doc-block--definition");
  const theorem = page.locator(".cf-doc-block--theorem");
  const proof = page.locator(".cf-doc-block--proof");

  await expect(shell).toHaveAttribute("data-cf-theme", "blueprint-book");
  await expect(reader).toContainText("Every optimal document theme");
  await expect(header).toHaveCSS("background-image", /linear-gradient/);
  await expect(toc).toBeVisible();
  await expect(definition).toBeVisible();
  await expect(theorem).toBeVisible();
  await expect(proof).toBeVisible();

  const readerMaxWidth = await reader.evaluate((el) =>
    Math.round(Number.parseFloat(getComputedStyle(el).maxWidth))
  );
  expect(readerMaxWidth).toBeGreaterThanOrEqual(560);
  expect(readerMaxWidth).toBeLessThanOrEqual(800);
  await expect(reader).toHaveCSS("font-family", /KaTeX_Main/);
  await expect(toc).toHaveCSS("background-color", "rgb(102, 150, 187)");
  await expect(theorem).toHaveCSS("border-left-style", "solid");
  await expect(proof).toHaveCSS("border-left-style", "solid");

  await expect(theorem).toHaveAttribute("data-title", "Readable column");
  await expect(proof).toHaveAttribute("data-title", "the readable column theorem");
  await expect(theorem).toHaveAttribute("open", "");
  await expect(theorem.locator("> summary")).toContainText("Theorem 1");
  await expect(theorem.locator("> summary")).toContainText("Readable column");
  await expect(proof).toContainText("Proof");
  await expect(theorem).toHaveCSS("font-style", "italic");
  await expect(proof).toHaveCSS("font-style", "normal");
  await expect(theorem).toHaveCSS("border-left-width", "2px");
  await expect(proof).toHaveCSS("border-left-width", "1px");

  await theorem.locator("> summary").click();
  await expect(theorem).not.toHaveAttribute("open", "");
  await expect(theorem.locator(".cf-doc-paragraph")).toBeHidden();
});

test("theme presets keep reader and CM6 rich editor surfaces visually aligned", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1600 });

  async function expectStylesMatch(
    readerSelector: string,
    editorSelector: string,
    properties: readonly string[],
  ) {
    const reader = page.locator(readerSelector).first();
    const editor = page.locator(editorSelector).first();
    await expect(reader).toBeVisible();
    await expect(editor).toBeVisible();

    for (const property of properties) {
      const expected = await reader.evaluate((el, property) =>
        getComputedStyle(el).getPropertyValue(property),
      property);
      await expect(editor).toHaveCSS(property, expected);
    }
  }

  const stylePairs = [
    [".parity-reader .cf-doc-paragraph", ".parity-editor .cm-line.cf-doc-paragraph:has-text('This paragraph includes')", ["color", "font-family", "font-size", "font-style", "font-weight", "line-height", "white-space", "word-break", "overflow-wrap"]],
    [".parity-reader strong", ".parity-editor .cf-bold", ["font-weight"]],
    [".parity-reader em", ".parity-editor .cf-italic", ["font-style"]],
    [".parity-reader del", ".parity-editor .cf-strikethrough", ["text-decoration-line"]],
    [".parity-reader mark", ".parity-editor .cf-highlight", ["background-color", "border-radius", "color", "padding-left", "padding-right"]],
    [".parity-reader .cf-doc-code-token", ".parity-editor .cf-inline-code", ["background-color", "border-radius", "font-family", "font-size", "padding-left", "padding-right"]],
    [".parity-reader .cf-doc-paragraph .cf-doc-inline-math", ".parity-editor .cm-line.cf-doc-paragraph .cf-doc-inline-math", ["color", "font-size", "font-style", "font-weight"]],
    [".parity-reader .cf-doc-paragraph .cf-doc-inline-math .katex", ".parity-editor .cm-line.cf-doc-paragraph .cf-doc-inline-math .katex", ["color", "font-size", "font-style", "font-weight"]],
    [".parity-reader .cf-doc-heading--h3 .cf-doc-inline-math .katex", ".parity-editor .cm-line.cf-doc-heading--h3 .cf-doc-inline-math .katex", ["color", "font-size", "font-style", "font-weight"]],
    [".parity-reader .cf-doc-list-item .cf-doc-inline-math .katex", ".parity-editor .cm-line:has-text('unordered item') .cf-doc-inline-math .katex", ["color", "font-size", "font-style", "font-weight"]],
    [".parity-reader a", ".parity-editor .cf-link-rendered", ["color", "text-decoration-line", "text-decoration-thickness", "text-underline-offset"]],
    [".parity-reader .cf-doc-heading--h1", ".parity-editor .cm-line.cf-doc-heading--h1", ["color", "font-family", "font-size", "font-style", "font-weight", "line-height", "text-align"]],
    [".parity-reader .cf-doc-heading--h2", ".parity-editor .cm-line.cf-doc-heading--h2", ["color", "font-family", "font-size", "font-style", "font-weight", "line-height"]],
    [".parity-reader .cf-doc-heading--h3", ".parity-editor .cm-line.cf-doc-heading--h3", ["color", "font-family", "font-size", "font-style", "font-weight", "line-height"]],
    [".parity-reader .cf-doc-list--unordered .cf-doc-list-item", ".parity-editor .cf-doc-list--unordered.cf-doc-list-item", ["font-family", "font-size", "line-height"]],
    [".parity-reader .cf-doc-list--ordered .cf-doc-list-item", ".parity-editor .cf-doc-list--ordered.cf-doc-list-item", ["font-family", "font-size", "line-height"]],
    [".parity-reader input[type='checkbox']", ".parity-editor input[type='checkbox']", ["vertical-align", "margin-right"]],
    [".parity-reader .cf-doc-code-block code", ".parity-editor .cf-codeblock-last", ["background-color", "font-family", "font-size", "line-height"]],
    [".parity-reader .cf-doc-table-block", ".parity-editor .cf-table-widget table", ["border-collapse", "font-size"]],
    [".parity-reader .cf-doc-table-header", ".parity-editor .cf-doc-table-header", ["border-bottom-color", "border-bottom-style", "border-bottom-width", "font-weight", "line-height", "padding-left", "padding-right"]],
    [".parity-reader .cf-doc-table-cell:not(.cf-doc-table-header)", ".parity-editor .cf-doc-table-cell:not(.cf-doc-table-header)", ["border-left-color", "border-left-style", "border-left-width", "line-height", "padding-left", "padding-right", "text-align", "vertical-align", "white-space", "word-break", "overflow-wrap"]],
    [".parity-reader .cf-doc-display-math", ".parity-editor .cf-doc-display-math.cf-math-display", ["font-family", "font-size", "line-height", "text-align", "margin-top", "margin-bottom"]],
    [".parity-reader .cf-doc-display-math .katex-display", ".parity-editor .cf-doc-display-math.cf-math-display .katex-display", ["font-size", "margin-top", "margin-bottom", "text-align"]],
    [".parity-reader .cf-doc-display-math .katex-display > .katex", ".parity-editor .cf-doc-display-math.cf-math-display .katex-display > .katex", ["color", "font-size"]],
    [".parity-reader .cf-doc-block--theorem", ".parity-editor .cm-line.cf-doc-block--theorem", ["border-left-color", "border-left-style", "border-left-width", "font-style", "padding-left"]],
    [".parity-reader .cf-doc-block--theorem .cf-doc-inline-math .katex", ".parity-editor .cm-line.cf-doc-block--theorem .cf-doc-inline-math .katex", ["color", "font-size", "font-style", "font-weight"]],
    [".parity-reader .cf-doc-block--proof", ".parity-editor .cm-line.cf-doc-block--proof", ["border-left-color", "border-left-style", "border-left-width", "font-style", "padding-left"]],
    [".parity-reader .cf-doc-block--proof .cf-doc-inline-math .katex", ".parity-editor .cm-line.cf-doc-block--proof .cf-doc-inline-math .katex", ["color", "font-size", "font-style", "font-weight"]],
    [".parity-reader .cf-doc-block--definition", ".parity-editor .cm-line.cf-doc-block--definition", ["font-style"]],
  ] as const;

  for (const preset of PARITY_PIXEL_PRESETS) {
    await setParitySource(page, NESTED_MATH_PARITY_SOURCE);
    await page.goto(`/tests/e2e/fixtures/parity.html${preset === "default" ? "" : `?preset=${preset}`}`);
    for (const [readerSelector, editorSelector, properties] of stylePairs) {
      await expectStylesMatch(readerSelector, editorSelector, properties);
    }
  }
});

test("theme presets keep full reader and CM6 content pixels aligned", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1600 });

  for (const preset of PARITY_PIXEL_PRESETS) {
    await loadParityPairSurface(page, preset);
    await expectLoadedSplitContentPixelsMatch(page, preset);
  }
});
