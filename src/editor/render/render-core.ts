/**
 * Render-core barrel: low-level utilities consumed by editor/, plugins/, and citations/.
 *
 * High-level render plugins (which may import from editor/ or plugins/) stay in
 * the main render barrel (index.ts).
 */


// ── crossref-render.ts (type exports) ────────────────────────────────────────
export type {
  ClusteredCrossrefWidget,
  CrossrefWidget,
  MixedClusterPart,
  MixedClusterWidget,
  UnresolvedRefWidget,
} from "./crossref-render";
// ── decoration-core.ts ───────────────────────────────────────────────────────
export {
  addMarkerReplacement,
  buildDecorations,
  decorationHidden,
  pushWidgetDecoration,
} from "./decoration-core";
// ── decoration-field.ts ──────────────────────────────────────────────────────
export {
  createDecorationStateField,
  createDecorationsField,
  cursorSensitiveShouldRebuild,
  defaultShouldRebuild,
} from "./decoration-field";
// ── fenced-block-core.ts (all exports) ───────────────────────────────────────
export {
  addCollapsedClosingFence,
  addSingleLineClosingFence,
  buildFencedBlockDecorations,
  createFencedBlockDecorationField,
  type FencedBlockInfo,
  type FencedBlockRenderContext,
  findFencedBlockAt,
  getFencedBlockRenderContext,
  getLineElement,
  hideMultiLineClosingFence,
  isCursorOnCloseFence,
  isCursorOnOpenFence,
} from "./fenced-block-core";
// ── focus-state.ts ───────────────────────────────────────────────────────────
export {
  createBooleanToggleField,
  editorFocusField,
  focusEffect,
  focusTracker,
} from "./focus-state";
// ── inline-shared.ts ─────────────────────────────────────────────────────────
export { MARK_NODES } from "./inline-shared";
// ── math-widget.ts (type exports) ────────────────────────────────────────────
export type { MathWidget } from "./math-widget";
// ── node-collection.ts ───────────────────────────────────────────────────────
export {
  collectNodeRangesExcludingCursor,
  collectNodes,
  cursorInRange,
  type RenderableNode,
} from "./node-collection";
// ── reference-widget.ts ──────────────────────────────────────────────────────
export {
  findReferenceWidgetContainer,
  isReferenceWidgetTarget,
  REFERENCE_WIDGET_SELECTOR,
  type ReferenceItemSpec,
  type ReferenceListSpec,
  type ReferenceRootSpec,
  ReferenceWidget,
  type SimpleTextReferenceSpec,
  SimpleTextReferenceWidget,
} from "./reference-widget";
// ── scroll-anchor.ts ─────────────────────────────────────────────────────────
export {
  captureScrollAnchor,
  mutateWithScrollStabilizedMeasure,
  requestScrollStabilizedMeasure,
  restoreScrollAnchor,
} from "./scroll-anchor";
// ── shell-widget.ts ──────────────────────────────────────────────────────────
export {
  ShellMacroAwareWidget,
  ShellWidget,
} from "./shell-widget";
// ── source-widget.ts ─────────────────────────────────────────────────────────
export {
  MacroAwareWidget,
  RenderWidget,
  resolveLiveWidgetSourceRange,
  type SimpleTextRenderSpec,
  SimpleTextRenderWidget,
  serializeMacros,
  widgetSourceMap,
} from "./source-widget";
// ── table-utils.ts (type exports) ────────────────────────────────────────────
export {
  type Alignment,
  type ParsedTable,
  type TableCell,
  type TableParseResult,
  type TableRow,
} from "./table-utils";
// ── view-plugin-factories.ts ─────────────────────────────────────────────────
export {
  type CursorSensitiveCollectFn,
  createCursorSensitiveViewPlugin,
  createSemanticSensitiveViewPlugin,
  createSimpleViewPlugin,
  cursorSensitiveShouldUpdate,
  defaultShouldUpdate,
} from "./view-plugin-factories";
// ── viewport-diff.ts ─────────────────────────────────────────────────────────
export {
  diffVisibleRanges,
  isPositionInRanges,
  mapVisibleRanges,
  mergeRanges,
  normalizeDirtyRange,
  rangeIntersectsRanges,
  snapshotRanges,
  type VisibleRange,
} from "./viewport-diff";
// ── widget-core.ts ───────────────────────────────────────────────────────────
export {
  BaseRenderWidget,
  cloneRenderedHTMLElement,
  createSimpleTextWidget,
  makeTextElement,
} from "./widget-core";
