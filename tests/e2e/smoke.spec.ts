import { expect, type Page, test } from "@playwright/test";
import { parser as baseMarkdownParser } from "@lezer/markdown";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  htmlRenderExtensions,
  parseFrontmatter,
} from "../../src/core/parser";

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

    let different = 0;
    let exactDifferent = 0;
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
const PARITY_SOURCE_KEY = "__coflatParitySource";
const CORPUS_CHUNK_LINES = 55;
const NESTED_MATH_PARITY_SOURCE = `# Default Document

This paragraph includes **bold text**, *italic text*, ~~struck text~~,
==highlighted text==, \`inline code\`, $x + y$, and a
[reference link](https://example.com).

References should align too: [@karger2000] and [@external-page].

## Main Result

### Supporting Lemma $a + b$

- unordered item with $u + v$
- [x] completed task

3. ordered item

| Name | Value |
| --- | ---: |
| Alpha | 1 |

\`\`\`ts
const value = 1;
\`\`\`

$$
x^2 + y^2 = z^2
$$

::: {.definition #def-theme title="Scoped theme"}
A default theme is applied by the host on the nearest scoped root.
:::

::: {.theorem #main-result title="Readable column"}
Every optimal document theme has a readable column, $r$, and stable theorem rails.
:::

::: {.proof title="the readable column theorem"}
The host applies a scoped class, and Coflat surfaces inherit variables from $s$.
:::
`;

function countMarkdownTables(source: string): number {
  const lines = source.split(/\r?\n/);
  let count = 0;
  for (let index = 0; index < lines.length - 1; index++) {
    if (isMarkdownTableStart(lines, index)) count++;
  }
  return count;
}

function isMarkdownTableStart(lines: readonly string[], index: number): boolean {
  return (
    /^\s*\|.*\|\s*$/.test(lines[index] ?? "") &&
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] ?? "")
  );
}

async function setParitySource(page: Page, source?: string) {
  await page.goto("/tests/e2e/fixtures/storage.html");
  await page.evaluate(({ key, source }) => {
    if (source === undefined) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, source);
    }
  }, { key: PARITY_SOURCE_KEY, source });
}

async function waitForParityRenderStable(page: Page, surface: ParitySurface) {
  await page.waitForFunction((surface) => {
    const root = document.querySelector(surface === "reader" ? "#reader-root" : "#editor-root");
    if (!root) return false;
    const unhydratedMath = root.querySelector(
      [
        ".cf-doc-inline-math:not(:has(.katex)):not(.cf-math-error)",
        ".cf-doc-display-math:not(:has(.cf-math-display-content > .katex-display)):not(.cf-math-error)",
      ].join(","),
    );
    if (unhydratedMath !== null) return false;
    if (surface === "editor") {
      const missingListClasses = Array.from(
        document.querySelectorAll("#editor-root .cm-line"),
      ).some((line) => (
        /^\s*(?:[-+*]|\d+[.)])\s+/.test(line.textContent ?? "") &&
        !line.classList.contains("cf-doc-list-item")
      ));
      if (missingListClasses) return false;
    }
    return true;
  }, surface, { timeout: 5000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

async function loadParitySurface(
  page: Page,
  preset: ParityPreset,
  surface: ParitySurface,
  source?: string,
) {
  await setParitySource(page, source);
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
  if (surface === "editor") {
    const expectedTables = countMarkdownTables(source ?? NESTED_MATH_PARITY_SOURCE);
    if (expectedTables > 0) {
      await page.waitForFunction((expectedTables) => (
        document.querySelectorAll("#editor-root .cf-table-widget").length >= expectedTables
      ), expectedTables, { timeout: 5000 });
    }
    await page.waitForFunction(() => {
      const lineTexts = Array.from(
        document.querySelectorAll("#editor-root .cm-content > .cm-line"),
      ).map((line) => line.textContent?.trim() ?? "");
      return !lineTexts.some((line, index) => (
        /^\|.*\|$/.test(line) &&
        /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lineTexts[index + 1] ?? "")
      ));
    }, undefined, { timeout: 5000 });
  }
  await waitForParityRenderStable(page, surface);
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
    const contentNodes = Array.from(root.children).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.height > 0 && rect.width > 0;
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
  source?: string,
) {
  await loadParitySurface(page, preset, surface, source);
  const clip = await parityContentClip(page, surface);
  return page.screenshot({
    clip: {
      x: clip.x,
      y: clip.y,
      width: clip.width,
      height: clip.height,
    },
  });
}

interface CorpusSegment {
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
}

const corpusParser = baseMarkdownParser.configure(htmlRenderExtensions);

function buildLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n" && index + 1 < source.length) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineNumberAt(lineStarts: readonly number[], pos: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= pos) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return high + 1;
}

function collectCorpusSegments(source: string): CorpusSegment[] {
  const lineStarts = buildLineStarts(source);
  const frontmatterEnd = parseFrontmatter(source).end;
  const tree = corpusParser.parse(source);
  const segments: CorpusSegment[] = [];

  function addSegment(from: number, to: number): void {
    if (to <= from || source.slice(from, to).trim().length === 0) return;
    segments.push({
      startLine: lineNumberAt(lineStarts, from),
      endLine: lineNumberAt(lineStarts, Math.max(from, to - 1)),
      text: source.slice(from, to),
    });
  }

  if (frontmatterEnd > 0) {
    addSegment(0, frontmatterEnd);
  }

  let child = tree.topNode.firstChild;
  while (child) {
    if (child.to > frontmatterEnd) {
      addSegment(Math.max(child.from, frontmatterEnd), child.to);
    }
    child = child.nextSibling;
  }

  return segments;
}

function chunkCorpusSource(name: string, source: string) {
  const segments = collectCorpusSegments(source);
  const chunks: Array<{ name: string; source: string }> = [];
  let current: CorpusSegment[] = [];
  let currentLines = 0;

  function flush() {
    if (current.length === 0) return;
    const startLine = current[0].startLine;
    const endLine = current[current.length - 1].endLine;
    chunks.push({
      name: `${name}:${startLine}-${endLine}`,
      source: current.map((segment) => segment.text).join("\n\n"),
    });
    current = [];
    currentLines = 0;
  }

  for (const segment of segments) {
    const segmentLines = segment.endLine - segment.startLine + 1;
    if (current.length > 0 && currentLines + segmentLines > CORPUS_CHUNK_LINES) {
      flush();
    }
    current.push(segment);
    currentLines += segmentLines;
  }
  flush();
  return chunks;
}

function corpusSources() {
  const dir = process.env.COFLAT_PARITY_CORPUS_DIR;
  if (!dir || !existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .flatMap((name) => {
      const source = readFileSync(join(dir, name), "utf8");
      return chunkCorpusSource(name, source);
    });
}

async function expectFullContentPixelsMatch(
  page: Page,
  source: string | undefined,
  label: string,
  preset: ParityPreset = "default",
) {
  const readerImage = await captureParitySurface(page, preset, "reader", source);
  const editorImage = await captureParitySurface(page, preset, "editor", source);
  const diff = await comparePngBuffersSignificant(page, readerImage, editorImage);

  expect(diff.leftWidth, `${label} reader width`).toBe(diff.rightWidth);
  expect(diff.leftHeight, `${label} reader height`).toBe(diff.rightHeight);
  expect(diff.different, `${label} full-content significant pixel diff`).toBe(0);
}

async function expectCorpusMathSemanticsMatch(
  page: Page,
  source: string,
  label: string,
) {
  async function collect(surface: ParitySurface) {
    await loadParitySurface(page, "default", surface, source);

    async function collectMounted() {
      return page.evaluate((surface) => {
      const rootSelector = surface === "reader" ? ".parity-reader" : ".parity-editor";
      const scoped = (selector: string) => `${rootSelector} ${selector}`;
      const mathKey = (el: Element, index: number) => {
        const htmlEl = el as HTMLElement;
        if (htmlEl.dataset.sourceFrom && htmlEl.dataset.sourceTo) {
          return `${htmlEl.dataset.sourceFrom}:${htmlEl.dataset.sourceTo}`;
        }
        return `dom:${index}:${el.getAttribute("aria-label") ?? el.textContent ?? ""}`;
      };
      const displayMathKeys = Array.from(
        document.querySelectorAll(scoped(".cf-doc-display-math:has(.katex-display)")),
      ).map(mathKey);
      const inlineMathKeys = Array.from(
        document.querySelectorAll(scoped(".cf-doc-inline-math:has(.katex)")),
      ).map(mathKey);

      const stylePairs = [
        [
          ".cf-doc-inline-math .katex",
          ["font-size", "font-style", "font-weight", "color"],
        ],
        [
          ".cf-doc-display-math .katex-display",
          ["font-size", "margin-top", "margin-bottom", "text-align"],
        ],
        [
          ".cf-doc-display-math .katex-display > .katex",
          ["font-size", "color"],
        ],
      ] as const;

      const styles = stylePairs.flatMap(([selector, properties]) => {
        const el = document.querySelector(scoped(selector));
        if (!el) {
          return properties.map((property) => ({
            selector,
            property,
            value: null,
          }));
        }
        const computed = getComputedStyle(el);
        return properties.map((property) => ({
          selector,
          property,
          value: computed.getPropertyValue(property),
        }));
      });

      const missingSharedClasses = Array.from(
        document.querySelectorAll(
          [
            scoped(".cf-doc-inline-math:not(.cf-math-inline)"),
            scoped(".cf-doc-display-math:not(.cf-math-display)"),
            scoped(".cf-math-inline:not(.cf-doc-inline-math)"),
            scoped(".cf-math-display:not(.cf-doc-display-math)"),
            scoped(".cf-doc-display-math:not(:has(.cf-math-display-content))"),
          ].join(","),
        ),
      ).map((el) => ({
        className: (el as HTMLElement).className,
        text: el.textContent?.slice(0, 80),
      }));

      if (surface === "editor") {
        for (const line of Array.from(document.querySelectorAll("#editor-root .cm-line"))) {
          const text = line.textContent ?? "";
          if (
            /^\s*(?:[-+*]|\d+[.)])\s+/.test(text) &&
            !line.classList.contains("cf-doc-list-item")
          ) {
            missingSharedClasses.push({
              className: (line as HTMLElement).className,
              text: text.slice(0, 80),
            });
          }
        }
        for (const el of Array.from(document.querySelectorAll("#editor-root .cf-table-widget th"))) {
          if (
            !el.classList.contains("cf-doc-table-cell") ||
            !el.classList.contains("cf-doc-table-header")
          ) {
            missingSharedClasses.push({
              className: (el as HTMLElement).className,
              text: el.textContent?.slice(0, 80),
            });
          }
        }
        for (const el of Array.from(document.querySelectorAll("#editor-root .cf-table-widget td"))) {
          if (!el.classList.contains("cf-doc-table-cell")) {
            missingSharedClasses.push({
              className: (el as HTMLElement).className,
              text: el.textContent?.slice(0, 80),
            });
          }
        }
      }

      return {
        displayMath: displayMathKeys.length,
        inlineMath: inlineMathKeys.length,
        displayMathKeys,
        inlineMathKeys,
        missingSharedClasses,
        styles,
      };
      }, surface);
    }

    if (surface === "reader") return collectMounted();

    const merged = await collectMounted();
    const displayMathKeys = new Set(merged.displayMathKeys);
    const inlineMathKeys = new Set(merged.inlineMathKeys);
    const positions = await page.evaluate(() => {
      const scroller = document.querySelector("#editor-root .cm-scroller");
      if (!(scroller instanceof HTMLElement)) return [0];
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const step = Math.max(240, Math.floor(scroller.clientHeight * 0.75));
      const values: number[] = [];
      for (let y = 0; y < max; y += step) values.push(y);
      values.push(max);
      return [...new Set(values)];
    });

    for (const position of positions) {
      await page.evaluate((position) => {
        const scroller = document.querySelector("#editor-root .cm-scroller");
        if (scroller instanceof HTMLElement) scroller.scrollTop = position;
      }, position);
      await waitForParityRenderStable(page, surface);
      const current = await collectMounted();
      for (const key of current.displayMathKeys) displayMathKeys.add(key);
      for (const key of current.inlineMathKeys) inlineMathKeys.add(key);
      merged.missingSharedClasses.push(...current.missingSharedClasses);
      merged.styles = merged.styles.map((style, index) =>
        style.value === null ? current.styles[index] : style
      );
    }

    return {
      ...merged,
      displayMath: displayMathKeys.size,
      inlineMath: inlineMathKeys.size,
      displayMathKeys: [...displayMathKeys],
      inlineMathKeys: [...inlineMathKeys],
      missingSharedClasses: merged.missingSharedClasses.filter((value, index, values) =>
        values.findIndex((candidate) =>
          candidate.className === value.className && candidate.text === value.text
        ) === index
      ),
    };
  }

  const reader = await collect("reader");
  const editor = await collect("editor");
  const styleDiffs = reader.styles.flatMap((readerStyle, index) => {
    const editorStyle = editor.styles[index];
    if (readerStyle.value === null && editorStyle.value === null) return [];
    if (readerStyle.value === editorStyle.value) return [];
    return [{
      selector: readerStyle.selector,
      property: readerStyle.property,
      reader: readerStyle.value,
      editor: editorStyle.value,
    }];
  });

  const result = {
    readerDisplayMath: reader.displayMath,
    editorDisplayMath: editor.displayMath,
    readerInlineMath: reader.inlineMath,
    editorInlineMath: editor.inlineMath,
    missingSharedClasses: [...reader.missingSharedClasses, ...editor.missingSharedClasses],
    styleDiffs,
  };

  expect(result.readerDisplayMath, `${label} reader display math count`).toBe(result.editorDisplayMath);
  expect(result.readerInlineMath, `${label} reader inline math count`).toBe(result.editorInlineMath);
  expect(result.missingSharedClasses, `${label} missing shared semantic classes`).toEqual([]);
  expect(result.styleDiffs, `${label} math computed style diffs`).toEqual([]);
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
    [".parity-reader .cf-doc-paragraph", ".parity-editor .cm-line.cf-doc-paragraph:has-text('This paragraph includes')", ["color", "font-family", "font-size", "font-style", "font-weight", "line-height", "white-space", "word-break", "overflow-wrap"]],
    [".parity-reader strong", ".parity-editor .cf-bold", ["font-weight"]],
    [".parity-reader em", ".parity-editor .cf-italic", ["font-style"]],
    [".parity-reader del", ".parity-editor .cf-strikethrough", ["text-decoration-line"]],
    [".parity-reader mark", ".parity-editor .cf-highlight", ["background-color", "border-radius", "padding-left", "padding-right"]],
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
    [".parity-reader .cf-doc-code-block", ".parity-editor .cf-codeblock-last", ["background-color", "font-family", "font-size", "line-height"]],
    [".parity-reader .cf-doc-code-block code", ".parity-editor .cf-codeblock-last", ["font-family", "font-size", "line-height"]],
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

  for (const preset of [null, "modern", "monospace"] as const) {
    await setParitySource(page, NESTED_MATH_PARITY_SOURCE);
    await page.goto(`/tests/e2e/fixtures/parity.html${preset ? `?preset=${preset}` : ""}`);
    for (const [readerSelector, editorSelector, properties] of stylePairs) {
      await expectStylesMatch(readerSelector, editorSelector, properties);
    }
  }
});

test("default theme keeps key reader and CM6 rich editor pixels aligned", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 3600 });

  const visualPairs = [
    [".parity-reader .cf-doc-heading--h3", ".parity-editor .cm-line.cf-doc-heading--h3"],
    [".parity-reader input[type='checkbox']", ".parity-editor input[type='checkbox']"],
    [".parity-reader .cf-doc-table-header", ".parity-editor .cf-doc-table-header"],
    [".parity-reader .cf-doc-block--definition .cf-block-header-rendered", ".parity-editor .cf-doc-block--definition .cf-block-header-rendered"],
    [".parity-reader .cf-doc-block--theorem .cf-block-header-rendered", ".parity-editor .cf-doc-block--theorem .cf-block-header-rendered"],
    [".parity-reader .cf-doc-block--proof .cf-block-header-rendered", ".parity-editor .cf-doc-block--proof .cf-block-header-rendered"],
  ] as const;

  for (const [readerSelector, editorSelector] of visualPairs) {
    await loadParitySurface(page, "default", "reader");
    const reader = page.locator(readerSelector).first();
    await expect(reader).toBeVisible();
    const readerImage = await reader.screenshot({ animations: "disabled" });

    await loadParitySurface(page, "default", "editor");
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
    await expectFullContentPixelsMatch(page, undefined, preset, preset);
  }
});

test("Cosheaf corpus documents keep reader and CM6 parity", async ({ page }) => {
  test.setTimeout(240_000);
  const sources = corpusSources();
  test.skip(
    sources.length === 0,
    "Set COFLAT_PARITY_CORPUS_DIR to a checked-out Cosheaf markdown corpus.",
  );

  await page.setViewportSize({ width: 1280, height: 3600 });

  for (const { name, source } of sources) {
    await expectCorpusMathSemanticsMatch(page, source, name);
    for (const preset of ["default", "modern"] as const) {
      await expectFullContentPixelsMatch(page, source, `${name} ${preset}`, preset);
    }
  }
});
