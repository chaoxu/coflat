import { expect, type Page } from "@playwright/test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { CSS } from "../../src/core/constants/css-classes";
import {
  getMarkdownParser,
  parseFrontmatter,
} from "../../src/core/parser";
import {
  defaultThemePresetKey,
  themePresetKeys,
} from "../../src/editor/theme-config";
import {
  DEFAULT_PARITY_SOURCE,
  PARITY_SOURCE_KEY,
} from "./fixtures/parity-fixture-data";

export type ParitySurface = "reader" | "editor";
export type ParityPreset = "default" | string;

const FULL_SURFACE_SIGNIFICANT_DELTA = 32;
const ANTIALIAS_EDGE_DELTA = 2;
const MAX_RESIDUAL_SIGNIFICANT_PIXELS = 256;
const MAX_RESIDUAL_SIGNIFICANT_RATIO = 0.00025;
// Keep screenshot chunks inside CodeMirror's rendered viewport. Larger chunks
// can compare reader DOM against CM's virtual spacer nodes instead of editor DOM.
const CORPUS_CHUNK_LINES = 20;

export const PARITY_PIXEL_PRESETS: readonly ParityPreset[] = [
  "default",
  ...themePresetKeys.filter((key) => key !== defaultThemePresetKey),
];

export const NESTED_MATH_PARITY_SOURCE = DEFAULT_PARITY_SOURCE;

interface CompareRect {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

interface CorpusSegment {
  readonly from: number;
  readonly to: number;
  readonly startLine: number;
  readonly endLine: number;
}

export interface CorpusSource {
  readonly name: string;
  readonly pixelRange?: { readonly from: number; readonly to: number };
  readonly source: string;
}

const corpusParser = getMarkdownParser("html-render");
let cachedCorpusDocuments:
  | { readonly dir: string; readonly sources: readonly CorpusSource[] }
  | null = null;

async function compareSplitPngSignificant(
  page: Page,
  image: Buffer,
  rects: { reader: CompareRect; editor: CompareRect },
) {
  return page.evaluate(async ({
    antialiasEdgeDelta,
    imageBytes,
    reader,
    editor,
    significantDelta,
  }) => {
    const blob = new Blob([new Uint8Array(imageBytes)], { type: "image/png" });
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("missing canvas 2d context");
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;

    function assertRectInBounds(rect: CompareRect, label: string) {
      const values = [rect.x, rect.y, rect.width, rect.height];
      if (!values.every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
        throw new Error(`${label} comparison rect is invalid: ${JSON.stringify(rect)}`);
      }
      if (
        rect.x < 0 ||
        rect.y < 0 ||
        rect.x + rect.width > bitmap.width ||
        rect.y + rect.height > bitmap.height
      ) {
        throw new Error(
          `${label} comparison rect is outside screenshot bounds: ${JSON.stringify({
            rect,
            screenshot: { height: bitmap.height, width: bitmap.width },
          })}`,
        );
      }
    }

    assertRectInBounds(reader, "reader");
    assertRectInBounds(editor, "editor");

    if (reader.width !== editor.width || reader.height !== editor.height) {
      return {
        different: Number.POSITIVE_INFINITY,
        height: Math.min(reader.height, editor.height),
        width: Math.min(reader.width, editor.width),
        leftHeight: reader.height,
        leftWidth: reader.width,
        rightHeight: editor.height,
        rightWidth: editor.width,
        ratio: 1,
      };
    }

    function pixelOffset(rect: CompareRect, x: number, y: number): number {
      return ((rect.y + y) * bitmap.width + rect.x + x) * 4;
    }

    function luminanceAt(rect: CompareRect, x: number, y: number): number {
      const offset = pixelOffset(rect, x, y);
      return (
        data[offset] * 0.2126 +
        data[offset + 1] * 0.7152 +
        data[offset + 2] * 0.0722
      );
    }

    function localLuminanceRange(rect: CompareRect, x: number, y: number) {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (let yy = Math.max(0, y - 8); yy <= Math.min(rect.height - 1, y + 8); yy++) {
        for (let xx = Math.max(0, x - 8); xx <= Math.min(rect.width - 1, x + 8); xx++) {
          const value = luminanceAt(rect, xx, yy);
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
      }
      return { max, min };
    }

    function isAntialiasEdge(x: number, y: number): boolean {
      const readerCenter = luminanceAt(reader, x, y);
      const editorCenter = luminanceAt(editor, x, y);
      const readerRange = localLuminanceRange(reader, x, y);
      const editorRange = localLuminanceRange(editor, x, y);
      const readerEdge =
        readerRange.min < readerCenter - antialiasEdgeDelta &&
        readerRange.max > readerCenter + antialiasEdgeDelta;
      const editorEdge =
        editorRange.min < editorCenter - antialiasEdgeDelta &&
        editorRange.max > editorCenter + antialiasEdgeDelta;

      return (
        (readerEdge || editorEdge) &&
        readerCenter >= editorRange.min - significantDelta &&
        readerCenter <= editorRange.max + significantDelta &&
        editorCenter >= readerRange.min - significantDelta &&
        editorCenter <= readerRange.max + significantDelta
      );
    }

    let antialiasDifferent = 0;
    let different = 0;
    let exactDifferent = 0;
    for (let y = 0; y < reader.height; y++) {
      for (let x = 0; x < reader.width; x++) {
        const readerOffset = pixelOffset(reader, x, y);
        const editorOffset = pixelOffset(editor, x, y);
        const delta =
          Math.abs(data[readerOffset] - data[editorOffset]) +
          Math.abs(data[readerOffset + 1] - data[editorOffset + 1]) +
          Math.abs(data[readerOffset + 2] - data[editorOffset + 2]) +
          Math.abs(data[readerOffset + 3] - data[editorOffset + 3]);
        if (!Number.isFinite(delta)) {
          throw new Error(`invalid pixel delta at ${x},${y}`);
        }
        if (delta !== 0) exactDifferent++;
        if (delta > significantDelta) {
          if (isAntialiasEdge(x, y)) {
            antialiasDifferent++;
          } else {
            different++;
          }
        }
      }
    }

    return {
      antialiasDifferent,
      different,
      exactDifferent,
      height: reader.height,
      width: reader.width,
      leftHeight: reader.height,
      leftWidth: reader.width,
      rightHeight: editor.height,
      rightWidth: editor.width,
      ratio: different / (reader.width * reader.height),
    };
  }, {
    antialiasEdgeDelta: ANTIALIAS_EDGE_DELTA,
    editor: rects.editor,
    imageBytes: Array.from(image),
    reader: rects.reader,
    significantDelta: FULL_SURFACE_SIGNIFICANT_DELTA,
  });
}

export async function setParitySource(page: Page, source?: string) {
  await page.goto("/tests/e2e/fixtures/storage.html");
  await page.evaluate(({ key, source }) => {
    if (source === undefined) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, source);
    }
  }, { key: PARITY_SOURCE_KEY, source });
}

async function gotoParityFixture(page: Page, url: string) {
  try {
    await page.goto(url);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("net::ERR_ABORTED")) {
      throw error;
    }
    await page.goto(url);
  }
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

async function disableParityMotion(page: Page) {
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
}

async function waitForParityEditorVisibleTables(page: Page) {
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

export async function loadParitySurface(
  page: Page,
  preset: ParityPreset,
  surface: ParitySurface,
  source?: string,
) {
  await setParitySource(page, source);
  const params = new URLSearchParams({ surface });
  if (preset !== "default") params.set("preset", preset);
  await gotoParityFixture(page, `/tests/e2e/fixtures/parity.html?${params.toString()}`);
  await disableParityMotion(page);
  if (surface === "editor") {
    await waitForParityEditorVisibleTables(page);
  }
  await waitForParityRenderStable(page, surface);
  await page.mouse.move(0, 0);
}

export async function loadParityPairSurface(
  page: Page,
  preset: ParityPreset,
  source?: string,
) {
  await setParitySource(page, source);
  const params = new URLSearchParams();
  if (preset !== "default") params.set("preset", preset);
  const query = params.toString();
  await gotoParityFixture(page, `/tests/e2e/fixtures/parity.html${query ? `?${query}` : ""}`);
  await disableParityMotion(page);
  await waitForParityEditorVisibleTables(page);
  await waitForParityRenderStable(page, "reader");
  await waitForParityRenderStable(page, "editor");
  await page.mouse.move(0, 0);
}

export async function expectLoadedSplitContentPixelsMatch(
  page: Page,
  label: string,
  sourceRange?: { readonly from: number; readonly to: number },
) {
  await page.evaluate(async (sourceRange) => {
    const scroller = document.querySelector("#editor-root .cm-scroller");
    if (sourceRange) {
      (
        window as typeof window & {
          __coflatScrollEditorToPosition?: (from: number) => void;
        }
      ).__coflatScrollEditorToPosition?.(sourceRange.from);
    } else if (scroller instanceof HTMLElement) {
      scroller.scrollTop = 0;
    }
    document.body.dataset.surface = "compare";
    window.dispatchEvent(new Event("resize"));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, sourceRange);
  await waitForParityEditorVisibleTables(page);
  await page.waitForFunction(() => {
    const readerRoot = document.querySelector("#reader-root");
    const editorRoot = document.querySelector("#editor-root .cm-content");
    return readerRoot instanceof HTMLElement &&
      editorRoot instanceof HTMLElement &&
      readerRoot.getBoundingClientRect().width > 0 &&
      editorRoot.getBoundingClientRect().width > 0;
  });
  let clip = await parityPairContentClip(page, sourceRange);
  const viewport = page.viewportSize();
  if (sourceRange && viewport && clip.y + clip.height > viewport.height) {
    await page.evaluate((y) => {
      window.scrollTo(0, Math.max(0, y - 16));
    }, clip.y);
    await page.evaluate(async () => {
      window.dispatchEvent(new Event("resize"));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    await waitForParityEditorVisibleTables(page);
    clip = await parityPairContentClip(page, sourceRange);
  }
  if (viewport && clip.y + clip.height > viewport.height) {
    await page.setViewportSize({
      ...viewport,
      height: Math.ceil(clip.y + clip.height),
    });
    await page.evaluate(async () => {
      window.dispatchEvent(new Event("resize"));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    await waitForParityEditorVisibleTables(page);
    clip = await parityPairContentClip(page, sourceRange);
  }
  const image = await page.screenshot({
    clip: {
      x: clip.x,
      y: clip.y,
      width: clip.width,
      height: clip.height,
    },
  });
  const diff = await compareSplitPngSignificant(page, image, {
    reader: clip.reader,
    editor: clip.editor,
  });

  expect(diff.leftWidth, `${label} reader width`).toBe(diff.rightWidth);
  expect(diff.leftHeight, `${label} reader height`).toBe(diff.rightHeight);
  const residualBudget = Math.min(
    MAX_RESIDUAL_SIGNIFICANT_PIXELS,
    Math.ceil(diff.width * diff.height * MAX_RESIDUAL_SIGNIFICANT_RATIO),
  );
  expect(
    diff.different,
    `${label} full-content non-antialiased pixel diff (exact=${diff.exactDifferent}, antialias=${diff.antialiasDifferent}, budget=${residualBudget})`,
  ).toBeLessThanOrEqual(residualBudget);
}

export async function expectLoadedSelectorsPixelsMatch(
  page: Page,
  label: string,
  selectors: { readonly reader: string; readonly editor: string },
) {
  const clip = await page.evaluate((selectors) => {
    const readerElement = document.querySelector(selectors.reader);
    const editorElement = document.querySelector(selectors.editor);
    if (!(readerElement instanceof HTMLElement) || !(editorElement instanceof HTMLElement)) {
      throw new Error(`missing comparison selectors: ${JSON.stringify(selectors)}`);
    }
    const readerBounds = readerElement.getBoundingClientRect();
    const editorBounds = editorElement.getBoundingClientRect();
    const x = Math.floor(Math.min(readerBounds.left, editorBounds.left));
    const y = Math.floor(Math.min(readerBounds.top, editorBounds.top));
    const right = Math.ceil(Math.max(readerBounds.right, editorBounds.right));
    const bottom = Math.ceil(Math.max(readerBounds.bottom, editorBounds.bottom));
    const toRect = (bounds: DOMRect) => ({
      height: Math.ceil(bounds.height),
      width: Math.ceil(bounds.width),
      x: Math.floor(bounds.left) - x,
      y: Math.floor(bounds.top) - y,
    });
    return {
      height: bottom - y,
      reader: toRect(readerBounds),
      editor: toRect(editorBounds),
      width: right - x,
      x,
      y,
    };
  }, selectors);
  const image = await page.screenshot({
    clip: {
      x: clip.x,
      y: clip.y,
      width: clip.width,
      height: clip.height,
    },
  });
  const diff = await compareSplitPngSignificant(page, image, {
    reader: clip.reader,
    editor: clip.editor,
  });

  expect(diff.leftWidth, `${label} reader width`).toBe(diff.rightWidth);
  expect(diff.leftHeight, `${label} reader height`).toBe(diff.rightHeight);
  const residualBudget = Math.min(
    MAX_RESIDUAL_SIGNIFICANT_PIXELS,
    Math.ceil(diff.width * diff.height * MAX_RESIDUAL_SIGNIFICANT_RATIO),
  );
  expect(
    diff.different,
    `${label} selector pixel diff (exact=${diff.exactDifferent}, antialias=${diff.antialiasDifferent}, budget=${residualBudget})`,
  ).toBeLessThanOrEqual(residualBudget);
}

async function parityPairContentClip(
  page: Page,
  sourceRange?: { readonly from: number; readonly to: number },
) {
  return page.evaluate((sourceRange) => {
    const readerRoot = document.querySelector("#reader-root");
    const editorRoot = document.querySelector("#editor-root .cm-content");
    if (!(readerRoot instanceof HTMLElement) || !(editorRoot instanceof HTMLElement)) {
      throw new Error("missing parity roots");
    }

    type SourceRange = { readonly from: number; readonly to: number };
    type EditorViewLike = {
      readonly state: {
        readonly doc: {
          readonly length: number;
          lineAt(pos: number): { readonly from: number; readonly to: number };
        };
      };
      posAtCoords(coords: { readonly x: number; readonly y: number }, precise?: boolean): number | null;
      posAtDOM(node: Node, offset?: number): number;
    };
    const editorView = (
      window as typeof window & {
        __coflatEditor?: { readonly view?: EditorViewLike };
        __coflatEditorView?: EditorViewLike | null;
      }
    ).__coflatEditorView ?? (
      window as typeof window & { __coflatEditor?: { readonly view?: EditorViewLike } }
    ).__coflatEditor?.view;

    function sourceRangeFromData(el: Element): SourceRange | null {
      const htmlEl = el as HTMLElement;
      const from = Number(htmlEl.dataset.sourceFrom);
      const to = Number(htmlEl.dataset.sourceTo);
      if (Number.isFinite(from) && Number.isFinite(to) && to >= from) {
        return { from, to };
      }
      return null;
    }

    function sourceRangeFromEditorElement(el: Element): SourceRange | null {
      const explicit = sourceRangeFromData(el);
      if (explicit) return explicit;
      if (!editorView) return null;

      try {
        if ((el as HTMLElement).classList.contains("cm-line")) {
          const from = editorView.posAtDOM(el, 0);
          if (!Number.isFinite(from)) return null;
          const line = editorView.state.doc.lineAt(from);
          return {
            from: line.from,
            to: Math.min(editorView.state.doc.length, line.to + 1),
          };
        }
        const from = editorView.posAtDOM(el, 0);
        if (!Number.isFinite(from)) return null;
        const to = editorView.posAtDOM(el, el.childNodes.length);
        return {
          from: Math.max(0, Math.min(from, to)),
          to: Math.min(editorView.state.doc.length, Math.max(from, to)),
        };
      } catch {
        return null;
      }
    }

    function overlaps(candidate: SourceRange | null): boolean {
      if (!sourceRange) return true;
      return candidate !== null && candidate.to > sourceRange.from && candidate.from < sourceRange.to;
    }

    function pageRect(el: Element) {
      const rect = el.getBoundingClientRect();
      return {
        bottom: rect.bottom + window.scrollY,
        height: rect.height,
        left: rect.left + window.scrollX,
        right: rect.right + window.scrollX,
        top: rect.top + window.scrollY,
        width: rect.width,
      };
    }

    function surfaceRect(root: HTMLElement, surface: "reader" | "editor") {
      const rootRect = root.getBoundingClientRect();
      const candidates = surface === "reader" && sourceRange
        ? Array.from(root.querySelectorAll("[data-source-from][data-source-to]"))
        : Array.from(root.children);
      const contentNodes = candidates.filter((el) => {
        const rect = el.getBoundingClientRect();
        if (!(rect.height > 0 && rect.width > 0)) return false;
        if (!sourceRange) return true;
        const candidate = surface === "reader"
          ? sourceRangeFromData(el)
          : sourceRangeFromEditorElement(el);
        return overlaps(candidate);
      });
      if (contentNodes.length === 0) {
        throw new Error(`no ${surface} content nodes overlap ${JSON.stringify(sourceRange)}`);
      }
      const top = sourceRange
        ? Math.min(...contentNodes.map((el) => pageRect(el).top))
        : rootRect.top + window.scrollY;
      const bottom = Math.max(
        top,
        ...contentNodes.map((el) => pageRect(el).bottom),
      );
      return {
        height: Math.ceil(bottom - top + 32),
        width: Math.round(rootRect.width),
        x: Math.round(rootRect.x + window.scrollX),
        y: Math.round(sourceRange ? top : rootRect.y + window.scrollY),
      };
    }

    const reader = surfaceRect(readerRoot, "reader");
    const editor = surfaceRect(editorRoot, "editor");
    const x = Math.min(reader.x, editor.x);
    const y = Math.min(reader.y, editor.y);
    const right = Math.max(reader.x + reader.width, editor.x + editor.width);
    const bottom = Math.max(reader.y + reader.height, editor.y + editor.height);

    return {
      editor: {
        ...editor,
        x: editor.x - x,
        y: editor.y - y,
      },
      height: bottom - y,
      reader: {
        ...reader,
        x: reader.x - x,
        y: reader.y - y,
      },
      width: right - x,
      x,
      y,
    };
  }, sourceRange);
}

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
      from,
      to,
      startLine: lineNumberAt(lineStarts, from),
      endLine: lineNumberAt(lineStarts, Math.max(from, to - 1)),
    });
  }

  if (frontmatterEnd > 0) {
    addSegment(0, frontmatterEnd);
  }

  let child = tree.topNode.firstChild;
  while (child) {
    if (child.name === "FootnoteDef") {
      child = child.nextSibling;
      continue;
    }
    if (child.to > frontmatterEnd) {
      addSegment(Math.max(child.from, frontmatterEnd), child.to);
    }
    child = child.nextSibling;
  }

  return segments;
}

function chunkCorpusSource(name: string, source: string): CorpusSource[] {
  const segments = collectCorpusSegments(source);
  const chunks: CorpusSource[] = [];
  let current: CorpusSegment[] = [];
  let currentLines = 0;

  function flush() {
    if (current.length === 0) return;
    const startLine = current[0].startLine;
    const endLine = current[current.length - 1].endLine;
    const from = current[0].from;
    const to = current[current.length - 1].to;
    chunks.push({
      name: `${name}:${startLine}-${endLine}`,
      pixelRange: { from, to },
      source,
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

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function corpusMarkdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return corpusMarkdownFiles(path);
      return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
    })
    .sort();
}

export function corpusDocuments(): CorpusSource[] {
  const dir = process.env.COFLAT_PARITY_CORPUS_DIR;
  if (!dir || !isDirectory(dir)) return [];
  if (cachedCorpusDocuments?.dir === dir) {
    return [...cachedCorpusDocuments.sources];
  }

  const sources = corpusMarkdownFiles(dir)
    .map((path) => {
      const name = relative(dir, path);
      const source = readFileSync(path, "utf8");
      return { name, source };
    });
  cachedCorpusDocuments = { dir, sources };
  return [...sources];
}

export function corpusSources(): CorpusSource[] {
  return corpusDocuments()
    .flatMap(({ name, source }) => chunkCorpusSource(name, source));
}

export async function expectLoadedCorpusMathSemanticsMatch(
  page: Page,
  label: string,
) {
  async function collect(surface: ParitySurface) {
    async function collectMounted() {
      return page.evaluate(({ surface, crossrefClass }) => {
        const rootSelector = surface === "reader" ? ".parity-reader" : ".parity-editor";
        const scoped = (selector: string) => `${rootSelector} ${selector}`;
        const scopedAny = (...selectors: string[]) =>
          selectors.map((selector) => scoped(selector)).join(", ");
        type SourceRange = { readonly from: number; readonly to: number };
        type EditorViewLike = {
          readonly state: {
            readonly doc: {
              readonly length: number;
              lineAt(pos: number): { readonly from: number; readonly number: number; readonly to: number };
            };
          };
          posAtCoords(coords: { readonly x: number; readonly y: number }, precise?: boolean): number | null;
          posAtDOM(node: Node, offset?: number): number;
        };
        const editorView = (
          window as typeof window & {
            __coflatEditor?: { readonly view?: EditorViewLike };
            __coflatEditorView?: EditorViewLike | null;
          }
        ).__coflatEditorView ?? (
          window as typeof window & { __coflatEditor?: { readonly view?: EditorViewLike } }
        ).__coflatEditor?.view;
        const sourceRangeFromData = (el: Element): SourceRange | null => {
          const htmlEl = el as HTMLElement;
          const from = Number(htmlEl.dataset.sourceFrom);
          const to = Number(htmlEl.dataset.sourceTo);
          if (Number.isFinite(from) && Number.isFinite(to) && to >= from) {
            return { from, to };
          }
          return null;
        };
        const sourceRangeFromEditorElement = (el: Element): SourceRange | null => {
          const explicit = sourceRangeFromData(el);
          if (explicit) return explicit;
          if (!editorView) return null;
          try {
            if ((el as HTMLElement).classList.contains("cm-line")) {
              const from = editorView.posAtDOM(el, 0);
              if (!Number.isFinite(from)) return null;
              const line = editorView.state.doc.lineAt(from);
              return {
                from: line.from,
                to: Math.min(editorView.state.doc.length, line.to + 1),
              };
            }
            const from = editorView.posAtDOM(el, 0);
            if (!Number.isFinite(from)) return null;
            const to = editorView.posAtDOM(el, el.childNodes.length);
            return {
              from: Math.max(0, Math.min(from, to)),
              to: Math.min(editorView.state.doc.length, Math.max(from, to)),
            };
          } catch {
            return null;
          }
        };
        const sourceRangeFor = surface === "reader"
          ? sourceRangeFromData
          : sourceRangeFromEditorElement;
        const sourceKey = (el: Element, index: number): string => {
          const range = sourceRangeFor(el);
          if (range) return `${range.from}:${range.to}`;
          return `dom:${index}:${el.getAttribute("aria-label") ?? el.textContent ?? ""}`;
        };
        const classToken = (el: Element, prefix: string): string | null => (
          Array.from((el as HTMLElement).classList).find((name) => name.startsWith(prefix)) ?? null
        );
        const visibleText = (el: Element): string => (
          (el.textContent ?? "")
            .replace(/\s+/g, " ")
            .replace(/^▼\s*/, "")
            .trim()
        );
        const mathKey = (el: Element, index: number) => {
          return sourceKey(el, index);
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
              scoped(`[data-ref-key]:not(.${crossrefClass})`),
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

        const titleTexts = Array.from(
          document.querySelectorAll(scoped(".cf-doc-title")),
        ).map(visibleText);
        const headingInventory = Array.from(
          document.querySelectorAll(scoped(".cf-doc-heading")),
        ).map((el, index) => [
          classToken(el, "cf-doc-heading--h") ?? "cf-doc-heading--unknown",
          (el as HTMLElement).dataset.sectionNumber ?? "",
          visibleText(el),
        ].join("|"));
        const linkInventory = Array.from(
          document.querySelectorAll(scopedAny("a[href]", ".cf-link-rendered")),
        )
          .filter((el) => {
            const href = el.getAttribute("href") ?? (el as HTMLElement).dataset.url ?? "";
            return !href.startsWith("#fn");
          })
          .map((el) => [
            el.getAttribute("href") ?? (el as HTMLElement).dataset.url ?? "",
            (el as HTMLElement).dataset.cfLinkLayout ?? "",
            visibleText(el),
          ].join("|"));
        const listItemInventory = Array.from(
          document.querySelectorAll(scoped(".cf-doc-list-item")),
        ).map(visibleText);
        const blockKeys = Array.from(
          document.querySelectorAll(
            surface === "reader"
              ? scoped(".cf-doc-block:not(.cf-doc-block--figure):not(.cf-doc-block--table)")
              : scoped(".cm-line.cf-doc-block.cf-block-header"),
          ),
        ).map((el) => {
          const blockKind = classToken(el, "cf-doc-block--") ?? "cf-doc-block--unknown";
          return [blockKind, sourceKey(el, 0)].join("|");
        });
        const figureKeys = Array.from(
          document.querySelectorAll(scoped(".cf-image-wrapper")),
        ).map((el, index) => sourceKey(el, index));
        const tableKeys = Array.from(
          document.querySelectorAll(
            surface === "reader"
              ? scoped(".cf-doc-table-block")
              : scoped("#editor-root .cm-content > .cf-table-widget"),
          ),
        ).map((el, index) => sourceKey(el, index));
        const semanticInventory = [
          ...titleTexts.map((value) => `title|${value}`),
          ...headingInventory.map((value) => `heading|${value}`),
          ...linkInventory.map((value) => `link|${value}`),
          ...listItemInventory.map((value) => `list-item|${value}`),
        ].sort();

        return {
          blockKeys,
          displayMath: displayMathKeys.length,
          figureKeys,
          inlineMath: inlineMathKeys.length,
          displayMathKeys,
          inlineMathKeys,
          missingSharedClasses,
          semanticInventory,
          styles,
          tableKeys,
        };
      }, { surface, crossrefClass: CSS.crossref });
    }

    function withStructuralSummaries<T extends {
      blockKeys: readonly string[];
      figureKeys: readonly string[];
      semanticInventory: readonly string[];
      tableKeys: readonly string[];
    }>(collected: T): T {
      const blockCounts = new Map<string, number>();
      for (const key of collected.blockKeys) {
        const kind = key.split("|", 1)[0] ?? "cf-doc-block--unknown";
        blockCounts.set(kind, (blockCounts.get(kind) ?? 0) + 1);
      }
      return {
        ...collected,
        semanticInventory: [
          ...collected.semanticInventory,
          ...Array.from(blockCounts)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([kind, count]) => `block-count|${kind}|${count}`),
          `figure-count|${collected.figureKeys.length}`,
          `table-count|${collected.tableKeys.length}`,
        ].sort(),
      };
    }

    if (surface === "reader") return withStructuralSummaries(await collectMounted());

    const merged = await collectMounted();
    const displayMathKeys = new Set(merged.displayMathKeys);
    const inlineMathKeys = new Set(merged.inlineMathKeys);
    const semanticInventory = new Set(merged.semanticInventory);
    const blockKeys = new Set(merged.blockKeys);
    const figureKeys = new Set(merged.figureKeys);
    const tableKeys = new Set(merged.tableKeys);
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
      await waitForParityEditorVisibleTables(page);
      const current = await collectMounted();
      for (const key of current.blockKeys) blockKeys.add(key);
      for (const key of current.displayMathKeys) displayMathKeys.add(key);
      for (const key of current.inlineMathKeys) inlineMathKeys.add(key);
      for (const key of current.semanticInventory) semanticInventory.add(key);
      for (const key of current.figureKeys) figureKeys.add(key);
      for (const key of current.tableKeys) tableKeys.add(key);
      merged.missingSharedClasses.push(...current.missingSharedClasses);
      merged.styles = merged.styles.map((style, index) =>
        style.value === null ? current.styles[index] : style
      );
    }

    await page.evaluate(() => {
      const scroller = document.querySelector("#editor-root .cm-scroller");
      if (scroller instanceof HTMLElement) scroller.scrollTop = 0;
    });

    return withStructuralSummaries({
      ...merged,
      blockKeys: [...blockKeys],
      displayMath: displayMathKeys.size,
      figureKeys: [...figureKeys],
      inlineMath: inlineMathKeys.size,
      displayMathKeys: [...displayMathKeys],
      inlineMathKeys: [...inlineMathKeys],
      semanticInventory: [...semanticInventory].sort(),
      missingSharedClasses: merged.missingSharedClasses.filter((value, index, values) =>
        values.findIndex((candidate) =>
          candidate.className === value.className && candidate.text === value.text
        ) === index
      ),
      tableKeys: [...tableKeys],
    });
  }

  const reader = await collect("reader");
  const editor = await collect("editor");
  const bySourceStart = (left: string, right: string) => {
    const leftStart = Number(left.split(":", 1)[0]);
    const rightStart = Number(right.split(":", 1)[0]);
    if (Number.isFinite(leftStart) && Number.isFinite(rightStart) && leftStart !== rightStart) {
      return leftStart - rightStart;
    }
    return left.localeCompare(right);
  };
  const sourceOrder = (keys: readonly string[]) => [...keys].sort(bySourceStart);
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
    readerDisplayMathKeys: sourceOrder(reader.displayMathKeys),
    editorDisplayMathKeys: sourceOrder(editor.displayMathKeys),
    readerInlineMath: reader.inlineMath,
    editorInlineMath: editor.inlineMath,
    readerInlineMathKeys: sourceOrder(reader.inlineMathKeys),
    editorInlineMathKeys: sourceOrder(editor.inlineMathKeys),
    missingSharedClasses: [...reader.missingSharedClasses, ...editor.missingSharedClasses],
    readerSemanticInventory: reader.semanticInventory,
    editorSemanticInventory: editor.semanticInventory,
    styleDiffs,
  };

  expect(result.readerDisplayMath, `${label} reader display math count`).toBe(result.editorDisplayMath);
  expect(result.readerDisplayMathKeys, `${label} display math source keys`).toEqual(result.editorDisplayMathKeys);
  expect(result.readerInlineMath, `${label} reader inline math count`).toBe(result.editorInlineMath);
  expect(result.readerInlineMathKeys, `${label} inline math source keys`).toEqual(result.editorInlineMathKeys);
  expect(result.readerSemanticInventory, `${label} semantic inventory`).toEqual(result.editorSemanticInventory);
  expect(result.missingSharedClasses, `${label} missing shared semantic classes`).toEqual([]);
  expect(result.styleDiffs, `${label} math computed style diffs`).toEqual([]);
}
