/**
 * Stable browser-test selectors for downstream hosts that need to smoke-test
 * Coflat-rendered surfaces without owning renderer class names locally.
 */
export const COFLAT_BROWSER_SELECTORS = {
  reader: ".cf-reader",
  compactReader: ".cf-reader-compact",
  readerSurface: ".cf-doc-surface",
  themeScope: ".cf-theme-scope",
  heading: ".cf-doc-heading",
  paragraphOrNative: ".cf-doc-paragraph, p",
  unorderedListOrNative: ".cf-doc-list--unordered, ul",
  displayMath: ".cf-doc-display-math",
  mathError: ".cf-math-error",
  katex: ".katex",
  katexDisplay: ".katex-display",
  listMarker: ".cf-list-bullet, .cf-list-number",
  unresolvedCrossref: ".cf-crossref-unresolved",
  unresolvedCitation: ".cf-citation-unresolved",
  citation: ".cf-citation",
  tableWidget: ".cf-table-widget",
  link: ".cf-doc-link",
  codeBlock: ".cf-doc-code-block",
  codeLanguage: ".cf-codeblock-language",
  editorCodeLine: ".cf-codeblock-header, .cf-codeblock-body, .cf-codeblock-last",
  footnoteSection: ".cf-footnote-section",
  bibliographyEntry: ".cf-bibliography-entry",
  bibliographyHeading: ".cf-bibliography-heading",
  bibliographyEntryNumber: ".cf-bibliography-entry-number",
  footnoteBackref: ".cf-footnote-backref",
  inlineMathOrKatex: ".cf-doc-inline-math, .katex",
  referenceWidget: "[data-reference-widget]",
  referenceKey: "[data-ref-key]",
  referenceWidgetId: "[data-ref-id]",
  hoverPreviewTooltip: '.cf-hover-preview-tooltip[data-visible="true"]',
  theoremBlock: ".cf-doc-block--theorem",
  blockHeaderRendered: ".cf-block-header-rendered",
  blockAttrTitle: ".cf-block-attr-title",
  blockHeader: ".cf-block-header",
  editorContent: ".cm-content",
  editorScroller: ".cm-scroller",
  editorRoot: ".cm-editor",
} as const;

export type CoflatBrowserSelector = keyof typeof COFLAT_BROWSER_SELECTORS;

export const COFLAT_BROWSER_ATTRIBUTES = {
  referenceKey: "data-ref-key",
  referenceId: "data-ref-id",
  sectionNumber: "data-section-number",
} as const;

export type CoflatBrowserAttribute = keyof typeof COFLAT_BROWSER_ATTRIBUTES;

type StatMap = Record<string, unknown>;

function stringValue(stats: StatMap, key: string): string {
  const value = stats[key];
  return typeof value === "string" ? value : "";
}

function numberValue(stats: StatMap, key: string): number {
  const value = stats[key];
  return typeof value === "number" ? value : Number.NaN;
}

function stringArrayValue(stats: StatMap, key: string): string[] {
  const value = stats[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function throwDrift(message: string, context: unknown): never {
  throw new Error(`${message}: ${JSON.stringify(context)}`);
}

function hasStableCodeWrapping(surface: StatMap): boolean {
  return (
    surface.whiteSpace === "pre" &&
    surface.wordBreak === "normal" &&
    (surface.overflowWrap === "normal" || surface.overflowWrap === "break-word")
  );
}

export function assertCoflatReaderEditorSurfaceParity(reader: StatMap, editor: StatMap): void {
  const context = { reader, editor };
  for (const key of ["paddingTop", "fontSize", "lineHeight"]) {
    if (reader[key] !== editor[key]) throwDrift(`reader/editor ${key} mismatch`, context);
  }
  if (Math.abs(numberValue(reader, "width") - numberValue(editor, "width")) > 1) {
    throwDrift("reader/editor effective width mismatch", context);
  }
  if (stringArrayValue(reader, "paddingInline").join("/") !== stringArrayValue(editor, "paddingInline").join("/")) {
    throwDrift("reader/editor horizontal padding mismatch", context);
  }
  if (!stringValue(reader, "font").includes("KaTeX_Main") || !stringValue(editor, "font").includes("KaTeX_Main")) {
    throwDrift("reader/editor content font mismatch", context);
  }
  if (reader.katexSize !== reader.displayMathSize) {
    throwDrift("reader display math size mismatch", context);
  }
  if (editor.katexSize && reader.katexSize !== editor.katexSize) {
    throwDrift("reader/editor display math size mismatch", context);
  }
  if (editor.katexDisplayMargin && reader.katexDisplayMargin !== editor.katexDisplayMargin) {
    throwDrift("reader/editor display math margin mismatch", context);
  }
  const readerNumbers = stringArrayValue(reader, "headingNumbers").filter(Boolean).slice(0, 4);
  const editorNumbers = stringArrayValue(editor, "headingNumbers").filter(Boolean).slice(0, readerNumbers.length);
  if (readerNumbers.join("/") !== editorNumbers.join("/")) {
    throwDrift("reader/editor heading numbering mismatch", context);
  }
  if (numberValue(editor, "listMarkers") === 0) {
    throwDrift("editor package list markers missing", context);
  }
}

export function assertCoflatLinkStyleParity(readerLink: StatMap, editorLink: StatMap): void {
  const context = { readerLink, editorLink };
  if (!stringValue(readerLink, "text") || !stringValue(editorLink, "text")) {
    throwDrift("reader/editor link missing text", context);
  }
  for (const [surface, link] of [["reader", readerLink], ["editor", editorLink]] as const) {
    if (!stringValue(link, "line").includes("underline") || link.style !== "dotted") {
      throwDrift(`${surface} link is not dotted underline`, context);
    }
    if (link.underlineOffset !== "2px") {
      throwDrift(`${surface} link underline offset drift`, context);
    }
  }
  for (const key of ["line", "style", "thickness", "underlineOffset", "display"]) {
    if (readerLink[key] !== editorLink[key]) throwDrift(`reader/editor link ${key} mismatch`, context);
  }
  if (readerLink.color !== editorLink.color) throwDrift("reader/editor link color mismatch", context);
}

export function assertCoflatCodeBlockParity(readerCode: StatMap, editorCode: StatMap): void {
  const context = { readerCode, editorCode };
  if (numberValue(readerCode, "count") === 0) throwDrift("reader code blocks missing", readerCode);
  if (numberValue(editorCode, "count") === 0) throwDrift("editor code block lines missing", editorCode);
  if (!stringValue(readerCode, "languageText") || !stringValue(editorCode, "languageText")) {
    throwDrift("code block language labels missing", context);
  }
  const readerSurfaces = [readerCode.pre, readerCode.code].filter((value): value is StatMap =>
    value !== null && typeof value === "object" && !Array.isArray(value)
  );
  for (const surface of readerSurfaces) {
    if (!hasStableCodeWrapping(surface)) {
      throwDrift("reader code block wrapping drift", readerCode);
    }
  }
  const lines = Array.isArray(editorCode.lines)
    ? editorCode.lines.filter((value): value is StatMap => value !== null && typeof value === "object" && !Array.isArray(value))
    : [];
  for (const line of lines) {
    if (!hasStableCodeWrapping(line)) {
      throwDrift("editor code block wrapping drift", editorCode);
    }
  }
  const readerCodeFont = stringValue((readerCode.code as StatMap | undefined) ?? (readerCode.pre as StatMap | undefined) ?? {}, "fontFamily");
  const editorCodeFont = stringValue(lines[0] ?? {}, "fontFamily");
  if (!readerCodeFont.includes("monospace") || !editorCodeFont.includes("monospace")) {
    throwDrift("code block font drift", context);
  }
}

export function assertCoflatFootnoteSectionParity(readerFootnotes: StatMap, editorFootnotes: StatMap): void {
  const context = { readerFootnotes, editorFootnotes };
  if (numberValue(readerFootnotes, "count") < 2 || numberValue(editorFootnotes, "count") < 2) {
    throwDrift("footnote sections missing entries", context);
  }
  if (readerFootnotes.heading !== "Footnotes" || editorFootnotes.heading !== "Footnotes") {
    throwDrift("footnote section heading drift", context);
  }
  if (stringArrayValue(readerFootnotes, "numbers").join(",") !== stringArrayValue(editorFootnotes, "numbers").join(",")) {
    throwDrift("footnote numbering drift", context);
  }
  if (readerFootnotes.hasBackrefs !== true || editorFootnotes.hasBackrefs !== true) {
    throwDrift("footnote backrefs missing", context);
  }
  if (readerFootnotes.hasMath !== true || editorFootnotes.hasMath !== true) {
    throwDrift("footnote math rendering missing", context);
  }
  const text = stringValue(readerFootnotes, "text");
  if (text !== stringValue(editorFootnotes, "text") || !text.includes("This footnote has bold")) {
    throwDrift("footnote content drift", context);
  }
}
