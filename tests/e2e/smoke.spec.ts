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

async function comparePngBuffers(page: Page, left: Buffer, right: Buffer) {
  return page.evaluate(async ({ leftBytes, rightBytes }) => {
    async function decode(bytes: number[]) {
      const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("missing canvas 2d context");
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      return { width: bitmap.width, height: bitmap.height, data: Array.from(data) };
    }

    const leftImage = await decode(leftBytes);
    const rightImage = await decode(rightBytes);
    let bestDifferent = Number.POSITIVE_INFINITY;
    let bestTotal = 0;
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) {
        const leftX = Math.max(0, dx);
        const rightX = Math.max(0, -dx);
        const leftY = Math.max(0, dy);
        const rightY = Math.max(0, -dy);
        const width = Math.min(leftImage.width - leftX, rightImage.width - rightX);
        const height = Math.min(leftImage.height - leftY, rightImage.height - rightY);
        let different = 0;
        if (width <= 0 || height <= 0) continue;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const leftOffset = ((y + leftY) * leftImage.width + x + leftX) * 4;
            const rightOffset = ((y + rightY) * rightImage.width + x + rightX) * 4;
            const delta =
              Math.abs(leftImage.data[leftOffset] - rightImage.data[rightOffset]) +
              Math.abs(leftImage.data[leftOffset + 1] - rightImage.data[rightOffset + 1]) +
              Math.abs(leftImage.data[leftOffset + 2] - rightImage.data[rightOffset + 2]) +
              Math.abs(leftImage.data[leftOffset + 3] - rightImage.data[rightOffset + 3]);
            if (delta > 32) different++;
          }
        }
        if (different < bestDifferent) {
          bestDifferent = different;
          bestTotal = width * height;
        }
      }
    }
    return {
      different: bestDifferent,
      height: Math.min(leftImage.height, rightImage.height),
      width: Math.min(leftImage.width, rightImage.width),
      leftHeight: leftImage.height,
      leftWidth: leftImage.width,
      rightHeight: rightImage.height,
      rightWidth: rightImage.width,
      ratio: bestTotal === 0 ? 1 : bestDifferent / bestTotal,
    };
  }, { leftBytes: Array.from(left), rightBytes: Array.from(right) });
}

const FULL_SURFACE_SIGNIFICANT_DELTA = 32;

async function comparePngBuffersSignificant(page: Page, left: Buffer, right: Buffer) {
  return page.evaluate(async ({ leftBytes, rightBytes, significantDelta }) => {
    async function decode(bytes: number[]) {
      const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("missing canvas 2d context");
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      return { width: bitmap.width, height: bitmap.height, data: Array.from(data) };
    }

    const leftImage = await decode(leftBytes);
    const rightImage = await decode(rightBytes);
    if (leftImage.width !== rightImage.width || leftImage.height !== rightImage.height) {
      return {
        different: Number.POSITIVE_INFINITY,
        height: Math.min(leftImage.height, rightImage.height),
        width: Math.min(leftImage.width, rightImage.width),
        leftHeight: leftImage.height,
        leftWidth: leftImage.width,
        rightHeight: rightImage.height,
        rightWidth: rightImage.width,
        ratio: 1,
      };
    }

    let exactDifferent = 0;
    let different = 0;
    for (let i = 0; i < leftImage.data.length; i += 4) {
      const delta =
        Math.abs(leftImage.data[i] - rightImage.data[i]) +
        Math.abs(leftImage.data[i + 1] - rightImage.data[i + 1]) +
        Math.abs(leftImage.data[i + 2] - rightImage.data[i + 2]) +
        Math.abs(leftImage.data[i + 3] - rightImage.data[i + 3]);
      if (delta !== 0) exactDifferent++;
      if (delta > significantDelta) different++;
    }

    return {
      different,
      exactDifferent,
      height: leftImage.height,
      width: leftImage.width,
      leftHeight: leftImage.height,
      leftWidth: leftImage.width,
      rightHeight: rightImage.height,
      rightWidth: rightImage.width,
      ratio: different / (leftImage.width * leftImage.height),
    };
  }, {
    leftBytes: Array.from(left),
    rightBytes: Array.from(right),
    significantDelta: FULL_SURFACE_SIGNIFICANT_DELTA,
  });
}

type ParitySurface = "reader" | "editor";
type ParityPreset = "default" | "modern";

async function loadParitySurface(
  page: Page,
  preset: ParityPreset,
  surface: ParitySurface,
) {
  const params = new URLSearchParams({ surface });
  if (preset !== "default") params.set("preset", preset);
  await page.goto(`/tests/e2e/fixtures/parity.html?${params.toString()}`);
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
      .cm-cursor {
        display: none !important;
      }
    `,
  });
  await page.mouse.move(0, 0);
}

async function parityContentClip(page: Page, surface: ParitySurface) {
  return page.evaluate((surface) => {
    const root = surface === "reader"
      ? document.querySelector("#reader-root")
      : document.querySelector("#editor-root .cm-content");
    if (!(root instanceof HTMLElement)) {
      throw new Error(`missing ${surface} parity root`);
    }
    const rootRect = root.getBoundingClientRect();
    const contentNodes = surface === "reader"
      ? Array.from(root.querySelectorAll(":scope > *"))
      : Array.from(root.querySelectorAll(".cm-line")).filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.height > 0;
      });
    const bottom = Math.max(
      rootRect.top,
      ...contentNodes.map((el) => el.getBoundingClientRect().bottom),
    );
    return {
      height: Math.ceil(bottom - rootRect.top + 32),
      width: Math.round(rootRect.width),
      x: Math.round(rootRect.x),
      y: Math.round(rootRect.y),
    };
  }, surface);
}

async function captureParitySurface(
  page: Page,
  preset: ParityPreset,
  surface: ParitySurface,
  height: number,
) {
  await loadParitySurface(page, preset, surface);
  const clip = await parityContentClip(page, surface);
  return page.screenshot({
    clip: {
      x: clip.x,
      y: clip.y,
      width: clip.width,
      height,
    },
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
    [".parity-reader .cf-doc-paragraph", ".parity-editor .cm-line.cf-doc-paragraph:has-text('This paragraph includes')", ["color", "font-family", "font-size", "font-style", "font-weight", "line-height"]],
    [".parity-reader strong", ".parity-editor .cf-bold", ["font-weight"]],
    [".parity-reader em", ".parity-editor .cf-italic", ["font-style"]],
    [".parity-reader del", ".parity-editor .cf-strikethrough", ["text-decoration-line"]],
    [".parity-reader mark", ".parity-editor .cf-highlight", ["background-color", "border-radius", "padding-left", "padding-right"]],
    [".parity-reader .cf-doc-code-token", ".parity-editor .cf-inline-code", ["background-color", "border-radius", "font-family", "font-size", "padding-left", "padding-right"]],
    [".parity-reader .cf-doc-inline-math", ".parity-editor .cf-math-inline", ["color", "font-size", "font-style", "font-weight"]],
    [".parity-reader a", ".parity-editor .cf-link-rendered", ["color", "text-decoration-line", "text-decoration-thickness", "text-underline-offset"]],
    [".parity-reader .cf-doc-heading--h1", ".parity-editor .cm-line.cf-doc-heading--h1", ["color", "font-family", "font-size", "font-style", "font-weight", "line-height", "text-align"]],
    [".parity-reader .cf-doc-heading--h2", ".parity-editor .cm-line.cf-doc-heading--h2", ["color", "font-family", "font-size", "font-style", "font-weight", "line-height"]],
    [".parity-reader .cf-doc-heading--h3", ".parity-editor .cm-line.cf-doc-heading--h3", ["color", "font-family", "font-size", "font-style", "font-weight", "line-height"]],
    [".parity-reader .cf-doc-list--unordered", ".parity-editor .cm-line:has-text('unordered item')", ["font-family", "font-size", "line-height"]],
    [".parity-reader .cf-doc-list--ordered", ".parity-editor .cm-line:has-text('ordered item')", ["font-family", "font-size", "line-height"]],
    [".parity-reader input[type='checkbox']", ".parity-editor input[type='checkbox']", ["vertical-align", "margin-right"]],
    [".parity-reader .cf-doc-code-block", ".parity-editor .cf-codeblock-last", ["background-color", "font-family", "font-size", "line-height"]],
    [".parity-reader .cf-doc-code-block code", ".parity-editor .cf-codeblock-last", ["font-family", "font-size", "line-height"]],
    [".parity-reader .cf-doc-table-block", ".parity-editor .cf-table-widget table", ["border-collapse", "font-size"]],
    [".parity-reader .cf-doc-table-header", ".parity-editor .cf-table-widget th", ["border-bottom-color", "border-bottom-style", "border-bottom-width", "font-weight", "line-height", "padding-left", "padding-right"]],
    [".parity-reader .cf-doc-table-cell:not(.cf-doc-table-header)", ".parity-editor .cf-table-widget td", ["border-left-color", "border-left-style", "border-left-width", "line-height", "padding-left", "padding-right"]],
    [".parity-reader .cf-doc-display-math", ".parity-editor .cf-doc-display-math.cf-math-display", ["font-family", "font-size", "line-height", "text-align", "margin-top", "margin-bottom"]],
    [".parity-reader .cf-doc-block--theorem", ".parity-editor .cm-line.cf-doc-block--theorem", ["border-left-color", "border-left-style", "border-left-width", "font-style", "padding-left"]],
    [".parity-reader .cf-doc-block--proof", ".parity-editor .cm-line.cf-doc-block--proof", ["border-left-color", "border-left-style", "border-left-width", "font-style", "padding-left"]],
    [".parity-reader .cf-doc-block--definition", ".parity-editor .cm-line.cf-doc-block--definition", ["font-style"]],
  ] as const;

  for (const preset of [null, "modern", "monospace"] as const) {
    await page.goto(`/tests/e2e/fixtures/parity.html${preset ? `?preset=${preset}` : ""}`);
    for (const [readerSelector, editorSelector, properties] of stylePairs) {
      await expectStylesMatch(readerSelector, editorSelector, properties);
    }
  }
});

test("default theme keeps key reader and CM6 rich editor pixels aligned", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1600 });

  const visualPairs = [
    [".parity-reader .cf-doc-heading--h3", ".parity-editor .cm-line.cf-doc-heading--h3"],
    [".parity-reader input[type='checkbox']", ".parity-editor input[type='checkbox']"],
    [".parity-reader .cf-doc-table-header", ".parity-editor .cf-table-widget th"],
    [".parity-reader .cf-doc-block--definition .cf-block-header-rendered", ".parity-editor .cf-doc-block--definition .cf-block-header-rendered"],
    [".parity-reader .cf-doc-block--theorem .cf-block-header-rendered", ".parity-editor .cf-doc-block--theorem .cf-block-header-rendered"],
    [".parity-reader .cf-doc-block--proof .cf-block-header-rendered", ".parity-editor .cf-doc-block--proof .cf-block-header-rendered"],
  ] as const;

  for (const [readerSelector, editorSelector] of visualPairs) {
    await page.goto("/tests/e2e/fixtures/parity.html?surface=reader");
    const reader = page.locator(readerSelector).first();
    await expect(reader).toBeVisible();
    const readerImage = await reader.screenshot({ animations: "disabled" });

    await page.goto("/tests/e2e/fixtures/parity.html?surface=editor");
    const editor = page.locator(editorSelector).first();
    await expect(editor).toBeVisible();
    const editorImage = await editor.screenshot({ animations: "disabled" });

    const diff = await comparePngBuffers(page, readerImage, editorImage);
    expect(Math.abs(diff.leftWidth - diff.rightWidth), `${readerSelector} width`).toBeLessThanOrEqual(2);
    expect(Math.abs(diff.leftHeight - diff.rightHeight), `${readerSelector} height`).toBeLessThanOrEqual(2);
    expect(diff.ratio, `${readerSelector} pixel diff`).toBeLessThanOrEqual(0.1);
  }
});

test("default and modern themes keep full reader and CM6 content pixels aligned", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1600 });

  for (const preset of ["default", "modern"] as const) {
    await loadParitySurface(page, preset, "reader");
    const readerClip = await parityContentClip(page, "reader");
    await loadParitySurface(page, preset, "editor");
    const editorClip = await parityContentClip(page, "editor");
    const height = Math.max(readerClip.height, editorClip.height);

    const readerImage = await captureParitySurface(page, preset, "reader", height);
    const editorImage = await captureParitySurface(page, preset, "editor", height);
    const diff = await comparePngBuffersSignificant(page, readerImage, editorImage);

    expect(diff.leftWidth, `${preset} reader width`).toBe(diff.rightWidth);
    expect(diff.leftHeight, `${preset} reader height`).toBe(diff.rightHeight);
    expect(diff.different, `${preset} full-content significant pixel diff`).toBe(0);
  }
});
