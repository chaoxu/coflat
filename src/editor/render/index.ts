// ── Re-export everything from render-core (low-level, no editor/plugins deps) ─

export { isPdfTarget } from "../lib/pdf-target";
export { checkboxRenderPlugin } from "./checkbox-render";
export { cm6RichRenderExtensions } from "./cm6-rich-render-extensions";
export {
  type CodeBlockInfo,
  codeBlockRenderPlugin,
  codeBlockStructureField,
  collectCodeBlocks,
} from "./code-block-render";
export {
  containerAttributesField,
  containerAttributesPlugin,
} from "./container-attributes";
export {
  CrossrefWidget,
  UnresolvedRefWidget,
} from "./crossref-render";
export { debugInspectorPlugin, toggleDebugInspector } from "./debug-inspector";
export { fenceGuidePlugin } from "./fence-guide";
export { focusModeExtension, toggleFocusMode } from "./focus-mode";
export { frontmatterDecoration, frontmatterDecorationField } from "./frontmatter-render";
export { hoverPreviewExtension } from "./hover-preview";
export {
  ImagePreviewWidget,
  imageRenderPlugin,
} from "./image-render";
// ── High-level render plugins ────────────────────────────────────────────────
export { renderInlineMarkdown } from "./inline-render";
export { sharedInlineRenderExtensions } from "./inline-render-extensions";
export { markdownRenderPlugin } from "./markdown-render";
export { mathPreviewPlugin } from "./math-preview";
export {
  findActiveMath,
  getDisplayMathContentEnd,
  MATH_TYPES,
  MathWidget,
  mathRenderPlugin,
  renderKatex,
  stripMathDelimiters,
} from "./math-render";
export {
  ERROR_COOLDOWN_MS,
  type MediaEntryBase,
  type PdfPreviewEntry,
  type PdfPreviewUpdate,
  pdfPreviewEffect,
  pdfPreviewField,
  pdfPreviewRemoveEffect,
  requestPdfPreview,
} from "./pdf-preview-cache";
export {
  blockRenderPlugin,
} from "./plugin-render";
export {
  collectReferenceRanges,
  planReferenceRendering,
  type ReferenceRenderItem,
  referenceRenderDependenciesChanged,
  referenceRenderPlugin,
} from "./reference-render";
export * from "./render-core";
export { balanceHiddenFenceClipboardText, richClipboardOutputFilter } from "./rich-clipboard";
export {
  searchHighlightPlugin,
  shouldUpdateSearchHighlights,
} from "./search-highlight";
export { sectionNumberPlugin } from "./section-counter";
export {
  collectFootnotes,
  footnoteInlineExpandedField,
  footnoteInlineToggleEffect,
  sidenoteRenderPlugin,
  sidenotesCollapsedEffect,
  sidenotesCollapsedField,
} from "./sidenote-render";
export { insertTable, tableRenderPlugin } from "./table-render";
export {
  addColumn,
  addRow,
  deleteColumn,
  deleteRow,
  detectAlignment,
  formatTable,
  moveColumn,
  moveRow,
  parseTable,
  serializeTable,
  setAlignment,
} from "./table-utils";
