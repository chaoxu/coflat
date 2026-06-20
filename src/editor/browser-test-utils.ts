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
