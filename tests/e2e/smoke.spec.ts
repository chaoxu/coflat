import { expect, type Page, test } from "@playwright/test";

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
  await expect(theorem.locator("> summary")).toContainText("Theorem (Readable column)");
  await expect(proof.locator("> summary")).toContainText("Proof of the readable column theorem");
  await expect(theorem).toHaveCSS("font-style", "italic");
  await expect(proof).toHaveCSS("font-style", "normal");
  await expect(theorem).toHaveCSS("border-left-width", "2px");
  await expect(proof).toHaveCSS("border-left-width", "1px");

  await theorem.locator("> summary").click();
  await expect(theorem).not.toHaveAttribute("open", "");
  await expect(theorem.locator(".cf-doc-paragraph")).toBeHidden();
});
