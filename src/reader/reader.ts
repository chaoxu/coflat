/**
 * `@chaoxu/coflat/reader` — read-only renderer for FORMAT.md.
 *
 * See READER.md and THEMING.md for the public contract.
 *
 * Node-importable: no `@codemirror/view`, no React, no KaTeX, no pdfjs,
 * no citation-js.
 */

import type { SyntaxNode, Tree } from "@lezer/common";
import createDOMPurify from "dompurify";
import {
  appendBibliographyBacklinks,
  bibliographyEntryId,
  renderBibliographySectionHtml,
} from "../core/bibliography-surface";
import {
  renderBlockCaptionHtml,
} from "../core/block-caption-surface";
import {
  renderBlockDisclosureHtml,
  renderBlockLabelContentHtml,
  renderBlockLabelHtml,
  renderBlockSummaryHtml as renderBlockSummarySurfaceHtml,
  renderInlineBlockHeadingContainerHtml,
} from "../core/block-heading-surface";
import { blockPresentationPlan } from "../core/block-presentation";
import {
  blockLineCost,
  blockquoteRenderPlan,
  codeBlockRenderPlan,
  dispatchBlockNodeRender,
  displayMathRenderPlan,
  documentRenderPlan,
  emitBlockChildrenRenderPlan,
  emitDocumentRenderPlan,
  fencedDivNumberingInfo,
  fencedDivRenderPlan,
  footnoteDefinitionRenderPlan,
  headingLevelFor,
  headingRenderPlan,
  horizontalRuleRenderPlan,
  type ListItemRenderPlan,
  listRenderPlan,
  paragraphRenderPlan,
  type TableRowRenderPlan,
  tableRenderPlan,
} from "../core/block-render-plan";
import {
  blockContainerSurfaceAttrs,
  renderBlankLineHtml,
  renderBlockquoteHtml,
  renderHorizontalRuleHtml,
} from "../core/block-surface";
import { renderCodeBlockHtml } from "../core/code-block-surface";
import {
  CSS,
  hostReferenceClassNames,
} from "../core/constants/css-classes";
import { NODE } from "../core/constants/node-types";
import {
  createDisclosureToggleButton,
  type DisclosureToggleLabels,
  READER_BLOCK_DISCLOSURE_LABELS,
  READER_SECTION_DISCLOSURE_LABELS,
  syncDisclosureToggle,
} from "../core/disclosure-toggle";
import {
  DOCUMENT_SURFACE_CLASS,
} from "../core/document-surface-classes";
import {
  type DocumentSurfacePolicy,
  documentSurfacePolicy,
} from "../core/document-surface-policy";
import {
  fencedDivContainerOptions,
  fencedDivSurfaceChromePlan,
} from "../core/fenced-div-surface";
import { renderReaderFootnoteReferenceHtml } from "../core/footnote-reference-surface";
import {
  footnoteSectionPlanFromNumberedEntries,
  renderFootnoteSectionHtml,
} from "../core/footnote-section-surface";
import {
  renderHeadingSurfaceHtml,
} from "../core/heading-surface";
import {
  createHoverPreviewBodyElement,
  createHoverPreviewCitationBodyElement,
  createHoverPreviewElementWithChild,
  createHoverPreviewHeaderElement,
  createHoverPreviewTextElement,
  createUnresolvedHoverPreviewElement,
} from "../core/hover-preview-surface";
import {
  buildInlineFragments,
  type InlineFragment,
  inlineFragmentsPlainText,
} from "../core/inline-fragments";
import { renderInlineMarkHtml } from "../core/inline-mark-surface";
import { inlineSurfacePolicy } from "../core/inline-surface-policy";
import { escapeHtml } from "../core/lib/html-escape";
import { buildKatexOptions } from "../core/lib/katex-options";
import { buildLineOffsets, lineAt } from "../core/lib/line-offsets";
import { isSafeUrl } from "../core/lib/url-utils";
import { applyLinkSurface, renderLinkSurfaceHtml } from "../core/link-surface";
import {
  type ListItemSurfaceEmissionPlan,
  listSurfaceEmissionPlan,
} from "../core/list-emission-plan";
import {
  renderListItemSurfaceHtml,
  renderListSurfaceHtml,
  renderReadOnlyTaskCheckboxHtml,
} from "../core/list-surface";
import {
  renderDisplayMathPlaceholderHtml,
  replaceDisplayMathContent,
} from "../core/math-display-surface";
import { renderInlineMathPlaceholderHtml } from "../core/math-inline-surface";
import { displayMathLatexRange } from "../core/math-source";
import {
  isUnresolvedLocalMediaUrl,
  mediaKindForSrc,
  renderImageSurfaceHtml,
  renderMediaLoadingHtml,
  renderPdfSurfaceHtml,
  syncInlineImageSizeOnLoad,
} from "../core/media-surface";
import {
  type DocumentOutlineEntry,
} from "../core/outline-surface";
import { renderParagraphHtml } from "../core/paragraph-surface";
import { parseFrontmatter, parseMarkdownSource } from "../core/parser";
import type { NumberingScheme } from "../core/parser/frontmatter";
import {
  fencedDivPreviewBodyRange,
  type ReferencePreviewContentPlan,
  type ReferencePreviewEntry,
  referencePreviewContentPlanFromEntry,
  referencePreviewContentPlanFromSource,
  referencePreviewEntryFromTarget,
  referencePreviewSurfacePlan,
} from "../core/reference-preview-source";
import {
  referencePresentationRouteSurfacePlan,
  referencePresentationRouteText,
  renderReferenceRouteSurfaceHtml,
} from "../core/reference-surface";
import {
  blockReferenceTarget,
  type DocumentReferenceTarget,
  equationReferenceTarget,
  headingReferenceTarget,
  resolvedCrossrefFromReferenceTarget,
  setPreferredDocumentReferenceTarget,
} from "../core/reference-targets";
import {
  appendCitedKeysFromReferenceIds as coreAppendCitedKeysFromReferenceIds,
  bibliographyEntries as coreBibliographyEntries,
  bibliographyEntryFor as coreBibliographyEntryFor,
  citeInline as coreCiteInline,
  isCitationKey as coreIsCitationKey,
} from "../core/references/citation-rendering";
import {
  formatBlockReferenceLabel,
} from "../core/references/format";
import { resolveNociteIds } from "../core/references/nocite";
import {
  classifyReferenceTarget,
  createHostReferenceRouteResolver,
  planReferencePresentation,
  type ReferencePresentationContext,
  type ReferencePresentationInput,
  type ReferencePresentationRoute,
  type ResolvedCrossref,
} from "../core/references/presentation";
import {
  type BlockCounterState,
  type BlockNumberingSpecLookup,
  blockTitleOverridesFromConfig,
  computeBlockNumbers,
  createConfiguredBlockNumberingSpecLookup,
  displayTitleForBlockType,
  type FencedDivNumberingInfo,
} from "../core/semantics/block-numbering";
import {
  type EquationNumberCounter,
  initialEquationNumberCounter,
  nextEquationNumber,
} from "../core/semantics/equation-numbering";
import {
  createFootnoteEmissionState,
  footnoteEmissionSectionEntries,
  type MutableFootnoteEmissionState,
  registerFootnoteDefinition,
  registerFootnoteReference,
  snapshotFootnoteEmissionState,
} from "../core/semantics/footnote-emission-state";
import {
  reserveExplicitHeadingAnchorIds,
} from "../core/semantics/heading-anchors";
import {
  type HeadingNumberCounters,
  initialHeadingNumberCounters,
  nextHeadingNumber,
} from "../core/semantics/heading-numbering";
import {
  nextHeadingOutlineProjectionEntry,
} from "../core/semantics/outline-plan";
import {
  type RenderedSourceAnchor,
  type RenderedSourceAnchorGranularity,
  type SourceLineRange,
  sourceRangeAttrs,
  sourceRangeFromElement,
} from "../core/source-range-surface";
import {
  renderTablePlanHtml,
} from "../core/table-surface";

export type {
  SourcePosition,
  SourcePositionScrollOptions,
} from "../core/source-range-surface";
export {
  applyReaderSourceDecorations,
  applySourceRangeAttrs,
  closestMathSourceCarrier,
  closestSourceRangeCarrier,
  type ElementSourceRangeOptions,
  isSourceRangeCarrier,
  mapDomNodeToSource,
  mapDomPointToSource,
  mapDomRangeToSource,
  type ParseSourceRangeOptions,
  parseSourceOffset,
  type ReaderSourceDecoration,
  type RenderedSourceAnchor,
  type RenderedSourceAnchorGranularity,
  type RenderedSourceAnchorLookupOptions,
  renderedAnchorsForSourceLineRange,
  renderedAnchorsForSourceRange,
  renderedSourceAnchorsFromDom,
  type SourceLineRange,
  type SourceRange,
  type SourceRangeAttrsOptions,
  type SourceRangeCarrierOptions,
  scrollReaderToSourcePosition,
  sourceElementAtPosition,
  sourceLineRangeFromElement,
  sourceRangeAttrs,
  sourceRangeFromDataset,
  sourceRangeFromElement,
  sourceRangeFromValues,
  type VisibleSourcePositionOptions,
  visibleSourcePositionInScroller,
} from "../core/source-range-surface";

import type {
  CitationFormatter,
  DocumentContext,
  LinkResolver,
  RefResolver,
} from "../core/document-context-types";

export type { CoflatThemeManifest, CoflatThemeTarget } from "../core/theme-manifest";
export {
  blueprintBookThemeManifest,
  COFLAT_READER_CLASS,
  COFLAT_READER_DOCUMENT_CLASS,
  COFLAT_READER_SHELL_CLASS,
  COFLAT_READER_TOC_CLASS,
  COFLAT_THEME_SCOPE_CLASS,
} from "../core/theme-manifest";

import {
  orderElementsVisibleFirst,
  scheduleHydrationYield,
} from "./hydration-scheduler";
import { noteLezerInvocation } from "./reader-internal";

export type {
  DocumentContext,
  LinkResolver,
  RefResolver,
} from "../core/document-context-types";

import type { TooltipPlan } from "../core/hover-tooltip";

export type {
  BlockCounterEntry,
  ConditionalWriteResult,
  FileEntry,
  FileSystem,
} from "../core/lib/file-system-types";

// ---------------------------------------------------------------------------
// Parser (lazy: only constructed when the fast path can't handle the input).
//
// The mode name is a compatibility label for older reader/preview callers.
// Reader and editor now share one configured Coflat parser profile.
// ---------------------------------------------------------------------------

function parseSource(source: string): Tree {
  noteLezerInvocation();
  return parseMarkdownSource(source, "html-render");
}

// ---------------------------------------------------------------------------
// Fast path sieve.
// ---------------------------------------------------------------------------

/**
 * If none of these match, the source is plain inline text with no markup at
 * all, so a bare HTML-escape reproduces the Lezer path exactly and the fast
 * path is safe. Anything else falls through to the real parser. The char class
 * covers inline delimiters — emphasis (`* _ ~`), escapes (`\`), highlight (`=`),
 * citations (`@`), bullets (`- + *`), links/code/math, headings (`#`),
 * blockquote/HTML (`< >`) and pipes — plus `\n` (multi-line always parses) and
 * a literal `-`, which already forces `---` frontmatter, setext underlines and
 * thematic breaks through the parser. `[ \t]$` bails on trailing horizontal
 * whitespace, which CommonMark strips from paragraph text. The anchored
 * alternatives cover the only line-start block constructs whose lead char is
 * not already a delimiter above: ordered lists (`1.`/`1)`, with or without
 * trailing content) and leading-indent content. Hand-rolling these semantics
 * here silently diverged from the canonical render — see the reader parity tests.
 */
const FAST_PATH_RE = /[$*_~=@+\\[:`#^<>\n|-]|[ \t]$|^(?:\d{1,9}[.)](?:[ \t]|$)|[ \t])/m;

// ---------------------------------------------------------------------------
// HTML / text escaping.
// ---------------------------------------------------------------------------

const paragraphClasses = DOCUMENT_SURFACE_CLASS.paragraph;

function blockDisplayTitle(ctx: WalkContext, type: string): string {
  return displayTitleForBlockType(type, ctx.blockTitles);
}

function computeReaderBlockNumbers(
  source: string,
  tree: Tree,
  getSpec: BlockNumberingSpecLookup,
  numbering: NumberingScheme,
  frontmatterEnd: number,
): BlockCounterState {
  const blocks: FencedDivNumberingInfo[] = [];
  tree.iterate({
    enter(node) {
      if (node.name !== NODE.FencedDiv) return;
      if (node.from < frontmatterEnd) return false;
      const info = fencedDivNumberingInfo(source, node.node);
      if (info) blocks.push(info);
    },
  });
  return computeBlockNumbers(blocks, getSpec, numbering);
}

function cloneHeadingCounters(
  counters: HeadingNumberCounters,
): HeadingNumberCounters {
  return {
    appendix: counters.appendix,
    values: [...counters.values],
  };
}

function renderInlineSnippet(ctx: WalkContext, source: string): BlockResult {
  const tree = parseSource(source);
  const snippetCtx: WalkContext = {
    ...ctx,
    source,
    lineOffsets: null,
    sourcePositions: false,
    mathSourcePositions: false,
    collectOutline: false,
    outline: [],
    usedHeadingIds: new Set(),
    headingCounters: cloneHeadingCounters(ctx.headingCounters),
    blockNumbers: ctx.blockNumbers,
    blockNumbering: ctx.blockNumbering,
    blockNumberingSpec: ctx.blockNumberingSpec,
    blockTitles: ctx.blockTitles,
    footnotes: createFootnoteEmissionState(),
    // Snippet renders (e.g. a fenced-div title) use a throwaway citedKeys, so a
    // citation appearing only inside a block title is shown inline but not added
    // to the document's References list — consistent with extractReferences,
    // which excludes fenced-div attributes from the citation grammar.
    citedKeys: [],
    catalog: ctx.catalog,
    buildCatalog: ctx.buildCatalog,
  };
  const root = tree.topNode;
  const first = root.firstChild;
  if (first?.name === NODE.Paragraph && first.nextSibling === null) {
    return renderInline(snippetCtx, first, first.from, first.to);
  }
  return {
    html: escapeHtml(source),
    text: source,
    hasMath: false,
  };
}

function renderInlineSnippetFragments(
  ctx: WalkContext,
  source: string,
  fragments: readonly InlineFragment[],
): BlockResult {
  const snippetCtx: WalkContext = {
    ...ctx,
    source,
    lineOffsets: null,
    sourcePositions: false,
    mathSourcePositions: false,
    collectOutline: false,
    outline: [],
    usedHeadingIds: new Set(),
    headingCounters: cloneHeadingCounters(ctx.headingCounters),
    blockNumbers: ctx.blockNumbers,
    blockNumbering: ctx.blockNumbering,
    blockNumberingSpec: ctx.blockNumberingSpec,
    blockTitles: ctx.blockTitles,
    footnotes: createFootnoteEmissionState(),
    citedKeys: [],
    catalog: ctx.catalog,
    buildCatalog: ctx.buildCatalog,
  };
  return renderInlineFragmentsForReader(snippetCtx, fragments, 0, source.length);
}

function renderBlockSummary(
  ctx: WalkContext,
  type: string,
  title: string | undefined,
  titleFragments: readonly InlineFragment[],
  number: number | undefined,
): BlockResult {
  const plan = blockPresentationPlan({
    blockType: type,
    displayTitle: blockDisplayTitle(ctx, type),
    number,
    title,
  });
  if (!plan.showTitleInHeader) {
    return {
      html: renderBlockLabelHtml(plan.label),
      text: plan.label,
      hasMath: false,
    };
  }
  const renderedTitle = renderInlineSnippetFragments(ctx, plan.title ?? "", titleFragments);
  return (
    {
      html: renderBlockSummarySurfaceHtml(plan.label, renderedTitle.html),
      text: `${plan.label} (${renderedTitle.text})`,
      hasMath: renderedTitle.hasMath,
    }
  );
}

/**
 * A semantic-block header + body. The disclosure toggle is NOT emitted here:
 * the static render stays clean (no inert control, no glyph in the heading's
 * textContent), and `hydrateReaderDisclosures` creates+inserts the toggle on
 * collapsible blocks at hydration time — mirroring section disclosures (#43).
 */
function renderBlockHeader(summaryHtml: string, bodyHtml: string): string {
  return renderBlockDisclosureHtml(summaryHtml, bodyHtml);
}

function renderBlockCaption(
  ctx: WalkContext,
  type: string,
  title: string,
  titleFragments: readonly InlineFragment[],
  number: number | undefined,
  sourceFrom: number,
  sourceTo: number,
): BlockResult {
  const renderedTitle = renderInlineSnippetFragments(ctx, title, titleFragments);
  const label = formatBlockReferenceLabel(blockDisplayTitle(ctx, type), number);
  return {
    html: renderBlockCaptionHtml(label, renderedTitle.html, sourcePosAttrs(ctx, sourceFrom, sourceTo)),
    text: `${label} ${renderedTitle.text}`,
    hasMath: renderedTitle.hasMath,
  };
}

function addRootClass(html: string, className: string): string {
  return html.replace(/^<([a-z][\w:-]*)([^>]*)>/i, (match, tag: string, attrs: string) => {
    const classAttr = attrs.match(/\sclass="([^"]*)"/);
    if (classAttr?.[1]) {
      const classes = classAttr[1].split(/\s+/);
      if (classes.includes(className)) return match;
      return `<${tag}${attrs.replace(classAttr[0], ` class="${classAttr[1]} ${className}"`)}>`;
    }
    return `<${tag} class="${className}"${attrs}>`;
  });
}

function addClassToLastHtmlBlock(blocks: BlockResult[], className: string): void {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (!blocks[index].html) continue;
    blocks[index] = {
      ...blocks[index],
      html: addRootClass(blocks[index].html, className),
    };
    return;
  }
}

// ---------------------------------------------------------------------------
// Fast-path inline renderer.
//
// FAST_PATH_RE guarantees the source contains no inline markup, so rendering is
// a pure HTML-escape with an identity source->text map. Returns a sanitize-safe
// HTML *fragment* (no outer tags) plus the linear `sourceToText` map for the
// corresponding `renderToText` call.
// ---------------------------------------------------------------------------

interface FastInlineResult {
  html: string;
  text: string;
  sourceToText: Uint32Array;
}

function fastRenderInline(source: string): FastInlineResult {
  const sourceToText = new Uint32Array(source.length + 1);
  for (let i = 0; i <= source.length; i++) sourceToText[i] = i;
  return { html: escapeHtml(source), text: source, sourceToText };
}

// ---------------------------------------------------------------------------
// Walker types.
// ---------------------------------------------------------------------------

type ReaderReferenceCatalog = ReadonlyMap<string, DocumentReferenceTarget>;

export type ReaderReferencePreviewEntry = ReferencePreviewEntry;

export type ReaderReferencePreviewIndex = Readonly<Record<string, ReaderReferencePreviewEntry>>;

type ReaderReferencePreviewCatalog = Map<string, ReaderReferencePreviewEntry>;

function setPreferredReaderReferenceTarget(
  ctx: WalkContext,
  id: string,
  target: DocumentReferenceTarget,
  previewEntry?: ReaderReferencePreviewEntry,
): boolean {
  if (!setPreferredDocumentReferenceTarget(ctx.catalog, id, target)) return false;
  if (previewEntry) {
    ctx.referencePreviewIndex.set(id, previewEntry);
  }
  return true;
}

interface Resolvers {
  linkResolver?: LinkResolver;
  refResolver?: RefResolver;
  citationFormatter?: CitationFormatter;
  citationKeys?: ReadonlySet<string>;
  /** In-document crossref catalog for self-resolution (opt-in via
   *  RenderOptions.resolveReferences); built by a first walk. */
  referenceCatalog?: ReaderReferenceCatalog;
  resolveAssetUrl?: (path: string) => string;
  documentPath?: string;
}

interface WalkContext {
  source: string;
  resolvers: Resolvers;
  lineOffsets: Uint32Array | null;
  /** When true, emit 1-based source line attributes on block elements. */
  sourceLineAttribution: boolean;
  /** When true, emit `data-source-from`/`data-source-to` byte offsets on
   *  every block element, inline mark, math placeholder, and plain-text
   *  span (the latter wrapped in `<span class="cf-text">`). */
  sourcePositions: boolean;
  /** When true, emit source offsets on math placeholders only. */
  mathSourcePositions: boolean;
  /** Semantic block disclosure policy for this document surface. */
  semanticBlockDisclosures: "interactive" | "static";
  /** Shared document-surface policy for inline and reference presentation choices. */
  surfacePolicy: DocumentSurfacePolicy;
  /** When true, emit ids on all headings and accumulate {@link outline}. */
  collectOutline: boolean;
  /** When true, emit stable rendered source anchors and return a source map. */
  sourceMap: boolean;
  sourceAnchors: RenderedSourceAnchor[];
  sourceAnchorCounts: Map<string, number>;
  /** Headings in document order; populated only when {@link collectOutline}. */
  outline: ReaderOutlineEntry[];
  /** Heading ids already emitted, for slug de-duplication. */
  usedHeadingIds: Set<string>;
  headingCounters: HeadingNumberCounters;
  blockNumbers: BlockCounterState;
  blockNumbering: NumberingScheme;
  blockNumberingSpec: BlockNumberingSpecLookup;
  blockTitles: ReadonlyMap<string, string>;
  equationCounter: EquationNumberCounter;
  /** Render-time footnote state. Reader truncation snapshots and rolls this back. */
  footnotes: MutableFootnoteEmissionState<string>;
  /** Bibliography keys cited (bracketed `[@key]` resolved as a citation), in
   *  first-appearance order; drives IEEE numbering + the References list. Only
   *  populated when the host supplies `citationKeys` + `citationFormatter`. */
  citedKeys: string[];
  /** In-document crossref targets (id → label) recorded as the walk numbers
   *  each heading/equation/block, so a second walk can resolve `[@id]` to the
   *  same number the target carries. Built only when `buildCatalog`. */
  catalog: Map<string, DocumentReferenceTarget>;
  /** In-document targets with source ranges for reader hover previews. */
  referencePreviewIndex: ReaderReferencePreviewCatalog;
  /** When true, record into {@link catalog} during numbering (first walk of a
   *  `resolveReferences` render). */
  buildCatalog: boolean;
  /** When true, record into {@link referencePreviewIndex}. */
  buildReferencePreviews: boolean;
  /** When false (RenderOptions.sectionNumbering === false), headings display
   *  as unnumbered even though the numbering walk still advances (for crossref
   *  resolution). Defaults to true. */
  numberHeadings: boolean;
  layoutGaps: ReaderLayoutGap[];
  emittedLayoutGapIds: Set<string>;
}

export interface ReaderLayoutGap {
  id: string;
  sourceLine: number;
  placement?: "before" | "after";
  height?: number;
  className?: string;
}

function sourcePosAttrs(ctx: WalkContext, from: number, to: number): string {
  if (!ctx.sourcePositions) return "";
  return sourceRangeAttrs({ sourceRange: { from, to } }) + sourceAnchorAttrs(ctx, "inline", "inline", from, to);
}

function mathSourcePosAttrs(ctx: WalkContext, from: number, to: number): string {
  if (!ctx.mathSourcePositions) return "";
  return sourceRangeAttrs({ sourceRange: { from, to } }) + sourceAnchorAttrs(ctx, "inline-math", "inline", from, to);
}

function anchorIdPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "anchor";
}

function sourceLineRange(ctx: WalkContext, from: number, to: number): SourceLineRange | undefined {
  if (!ctx.lineOffsets) return undefined;
  return {
    from: lineAt(ctx.lineOffsets, from),
    to: lineAt(ctx.lineOffsets, Math.max(from, to - 1)),
  };
}

function sourceAnchorAttrs(
  ctx: WalkContext,
  kind: string,
  granularity: RenderedSourceAnchorGranularity,
  from: number,
  to: number,
): string {
  if (!ctx.sourceMap) return "";
  const key = `${granularity}:${kind}:${from}:${to}`;
  const previous = ctx.sourceAnchorCounts.get(key) ?? 0;
  ctx.sourceAnchorCounts.set(key, previous + 1);
  const base = `cf-${anchorIdPart(granularity)}-${anchorIdPart(kind)}-${from}-${to}`;
  const id = previous === 0 ? base : `${base}-${previous + 1}`;
  const selector = `[data-cf-anchor-id="${id}"]`;
  const lineRange = sourceLineRange(ctx, from, to);
  ctx.sourceAnchors.push({
    id,
    kind,
    granularity,
    sourceRange: { from, to },
    ...(lineRange ? { lineRange } : {}),
    selector,
  });
  const blockKindAttr = granularity === "block" ? ` data-cf-block-kind="${kind}"` : "";
  return (
    ` data-cf-anchor-id="${id}" data-cf-anchor-kind="${kind}"` +
    ` data-cf-anchor-granularity="${granularity}"${blockKindAttr}`
  );
}

// ---------------------------------------------------------------------------
// Inline rendering (text-only output side-channel optional).
// ---------------------------------------------------------------------------

function renderInlineFragmentsForReader(
  ctx: WalkContext,
  fragments: readonly InlineFragment[],
  from: number,
  to: number,
): { html: string; text: string; hasMath: boolean } {
  let html = "";
  let text = "";
  let hasMath = false;
  const policy = inlineSurfacePolicy(ctx.surfacePolicy.bodyInlineSurface);

  const renderChildren = (children: readonly InlineFragment[]) =>
    renderInlineFragmentsForReader(ctx, children, from, to);
  const rangeFor = (fragment: InlineFragment) => fragment.sourceRange ?? { from, to };
  const sourceAttrsFor = (fragment: InlineFragment) => {
    const range = rangeFor(fragment);
    return sourcePosAttrs(ctx, range.from, range.to);
  };
  const mathSourceAttrsFor = (fragment: InlineFragment) => {
    const range = rangeFor(fragment);
    return mathSourcePosAttrs(ctx, range.from, range.to);
  };

  for (const fragment of fragments) {
    switch (fragment.kind) {
      case "text":
        html += ctx.sourcePositions
          ? `<span class="${CSS.text}"${sourceAttrsFor(fragment)}>${escapeHtml(fragment.text)}</span>`
          : escapeHtml(fragment.text);
        text += fragment.text;
        break;
      case "emphasis": {
        const inner = renderChildren(fragment.children);
        html += renderInlineMarkHtml("emphasis", inner.html, { sourceAttrs: sourceAttrsFor(fragment) });
        text += inner.text;
        hasMath ||= inner.hasMath;
        break;
      }
      case "strong": {
        const inner = renderChildren(fragment.children);
        html += renderInlineMarkHtml("strong", inner.html, { sourceAttrs: sourceAttrsFor(fragment) });
        text += inner.text;
        hasMath ||= inner.hasMath;
        break;
      }
      case "strikethrough": {
        const inner = renderChildren(fragment.children);
        html += renderInlineMarkHtml("strikethrough", inner.html, { sourceAttrs: sourceAttrsFor(fragment) });
        text += inner.text;
        hasMath ||= inner.hasMath;
        break;
      }
      case "highlight": {
        const inner = renderChildren(fragment.children);
        html += renderInlineMarkHtml("highlight", inner.html, { sourceAttrs: sourceAttrsFor(fragment) });
        text += inner.text;
        hasMath ||= inner.hasMath;
        break;
      }
      case "code":
        html += renderInlineMarkHtml("code", escapeHtml(fragment.text), { sourceAttrs: sourceAttrsFor(fragment) });
        text += fragment.text;
        break;
      case "math":
        html += renderInlineMathPlaceholderHtml(fragment.latex, fragment.raw, { sourceAttrs: mathSourceAttrsFor(fragment) });
        text += fragment.raw;
        hasMath = true;
        break;
      case "link": {
        const label = renderChildren(fragment.children);
        const href = fragment.href?.trim() ?? "";
        if (policy.links === "inert") {
          html += label.html;
          text += label.text;
          hasMath ||= label.hasMath;
          break;
        }
        let resolvedHref = href;
        let className: string | undefined;
        let title: string | undefined;
        if (ctx.resolvers.linkResolver?.resolve) {
          const resolved = ctx.resolvers.linkResolver.resolve(
            href,
            inlineFragmentsPlainText(fragment.children),
            {
              from: ctx.resolvers.documentPath,
              documentPath: ctx.resolvers.documentPath,
              raw: "",
              sourceRange: rangeFor(fragment),
              surface: ctx.surfacePolicy.referenceHostSurface,
            },
          );
          if (resolved) {
            if (resolved.href !== undefined) resolvedHref = resolved.href;
            if (resolved.className !== undefined) className = resolved.className;
            if (resolved.title !== undefined) title = resolved.title;
          }
        }
        html += isSafeUrl(resolvedHref)
          ? renderLinkSurfaceHtml(resolvedHref, label.html, {
            className,
            title,
            sourceAttrs: sourceAttrsFor(fragment),
          })
          : label.html;
        text += label.text;
        hasMath ||= label.hasMath;
        break;
      }
      case "reference": {
        if (policy.references === "inert") {
          html += escapeHtml(fragment.rawText);
          text += fragment.rawText;
          break;
        }
        const hasResolverContext = ctx.resolvers.refResolver
          || ctx.resolvers.referenceCatalog
          || (ctx.resolvers.citationFormatter && ctx.resolvers.citationKeys);
        const looksLikeLocalCrossref = fragment.ids.some((id) => id.includes(":"));
        if (fragment.parenthetical && !hasResolverContext && !looksLikeLocalCrossref) {
          const raw = `[${fragment.rawText}]`;
          html += ctx.sourcePositions && fragment.sourceRange
            ? `<span class="${CSS.text}"${sourceAttrsFor(fragment)}>${escapeHtml(raw)}</span>`
            : escapeHtml(raw);
          text += raw;
          break;
        }
        const canResolveNarrative = fragment.parenthetical
          || hasResolverContext;
        if (!canResolveNarrative) {
          html += escapeHtml(fragment.rawText);
          text += fragment.rawText;
          break;
        }
        const raw = fragment.parenthetical ? `[${fragment.rawText}]` : fragment.rawText;
        const range = rangeFor(fragment);
        const ref = emitReferenceCluster(
          ctx,
          [...fragment.ids],
          [...fragment.locators],
          raw,
          range.from,
          range.to,
          fragment.parenthetical ? "bracketed" : "narrative",
        );
        html += ref.html;
        text += ref.text;
        hasMath ||= ref.hasMath;
        break;
      }
      case "image": {
        let src = fragment.src?.trim() ?? "";
        const alt = inlineFragmentsPlainText(fragment.alt);
        if (policy.images === "alt-text") {
          html += ctx.sourcePositions
            ? `<span class="${CSS.text}"${sourceAttrsFor(fragment)}>${escapeHtml(alt)}</span>`
            : escapeHtml(alt);
          text += alt;
          break;
        }
        if (ctx.resolvers.resolveAssetUrl && isReaderLocalAssetSrc(src)) {
          try {
            const resolved = ctx.resolvers.resolveAssetUrl(resolveReaderAssetPath(ctx.resolvers.documentPath, src));
            if (typeof resolved === "string") src = resolved;
          } catch (_error) {
            // Asset resolution is host-provided; fall back to the authored URL.
          }
        }
        if (!isSafeUrl(src)) {
          html += ctx.sourcePositions
            ? `<span class="${CSS.text}"${sourceAttrsFor(fragment)}>${escapeHtml(alt)}</span>`
            : escapeHtml(alt);
        } else if (isUnresolvedLocalMediaUrl(src)) {
          html += renderMediaLoadingHtml(src, alt, sourceAttrsFor(fragment));
        } else if (mediaKindForSrc(src) === "pdf") {
          html += renderPdfSurfaceHtml(src, alt, sourceAttrsFor(fragment));
        } else {
          html += renderImageSurfaceHtml(src, alt, sourceAttrsFor(fragment));
        }
        text += alt;
        break;
      }
      case "footnote-ref": {
        if (policy.footnotes === "raw-superscript") {
          html += `<sup${sourceAttrsFor(fragment)}>${escapeHtml(fragment.id)}</sup>`;
          text += fragment.id;
          break;
        }
        const { number } = registerFootnoteReference(ctx.footnotes, fragment.id);
        html += renderReaderFootnoteReferenceHtml(number, fragment.id, sourceAttrsFor(fragment));
        text += `[${number}]`;
        break;
      }
      case "hard-break":
        html += policy.hardBreaks === "line-break"
          ? `<br${sourceAttrsFor(fragment)}>`
          : " ";
        text += " ";
        break;
    }
  }

  return { html, text, hasMath };
}

/** Render the inline content inside a node range [from, to). Returns HTML + plain text. */
function renderInline(
  ctx: WalkContext,
  parent: SyntaxNode,
  from: number,
  to: number,
): { html: string; text: string; hasMath: boolean } {
  return renderInlineFragmentsForReader(
    ctx,
    buildInlineFragments(parent, ctx.source, from, to, {
      sourceRanges: ctx.sourcePositions || ctx.mathSourcePositions,
    }),
    from,
    to,
  );
}

function readerCatalogCrossref(ctx: WalkContext, id: string): ResolvedCrossref | null {
  const catalogTarget = ctx.resolvers.referenceCatalog?.get(id);
  return catalogTarget ? resolvedCrossrefFromReferenceTarget(catalogTarget) : null;
}

function readerReferencePresentationContext(ctx: WalkContext): ReferencePresentationContext {
  const resolveCrossref = (id: string) => readerCatalogCrossref(ctx, id);
  return {
    classify(id) {
      const resolved = classifyReferenceTarget(resolveCrossref, id);
      if (resolved.kind === "crossref") return resolved;
      return coreIsCitationKey(ctx.resolvers.citationKeys, id)
        ? { kind: "citation", id }
        : resolved;
    },
    cite(ids, locators, extras) {
      return coreCiteInline(ctx.resolvers.citationFormatter, ids, locators, extras) ?? "";
    },
    citeNarrative(id) {
      return ctx.resolvers.citationFormatter?.citeNarrative(id) ?? id;
    },
    resolveHostReference: createHostReferenceRouteResolver({
      resolver: ctx.resolvers.refResolver,
      resolveCrossref,
      documentPath: ctx.resolvers.documentPath,
      surface: ctx.surfacePolicy.referenceHostSurface,
    }),
  };
}

function readerReferenceInput(
  ids: readonly string[],
  locators: readonly (string | undefined)[],
  raw: string,
  from: number,
  to: number,
  mode: "bracketed" | "narrative",
): ReferencePresentationInput {
  return {
    bracketed: mode === "bracketed",
    ids,
    locators,
    raw,
    sourceRange: { from, to },
  };
}

function renderReaderReferenceRouteHtml(
  ctx: WalkContext,
  input: ReferencePresentationInput,
  route: ReferencePresentationRoute,
  sourceAttrs: string,
): string {
  return renderReferenceRouteSurfaceHtml(referencePresentationRouteSurfacePlan(
    input,
    route,
    {
      hasCrossrefTarget: (id) => ctx.resolvers.referenceCatalog?.has(id) ?? false,
      sourceAttrs,
    },
  ));
}

function emitReferenceCluster(
  ctx: WalkContext,
  ids: string[],
  locators: (string | undefined)[],
  raw: string,
  from: number,
  to: number,
  mode: "bracketed" | "narrative" = "bracketed",
): { html: string; text: string; hasMath: boolean } {
  const sourceAttrs = ctx.sourcePositions ? sourcePosAttrs(ctx, from, to) : "";
  const input = readerReferenceInput(ids, locators, raw, from, to, mode);
  const route = planReferencePresentation(readerReferencePresentationContext(ctx), input);
  const shouldKeepUnknownCitationInert = route?.kind === "unresolved"
    && !ctx.sourcePositions
    && ids.every((id) => !id.includes(":"));
  if (!route || shouldKeepUnknownCitationInert) {
    return {
      html: escapeHtml(raw),
      text: raw,
      hasMath: false,
    };
  }
  coreAppendCitedKeysFromReferenceIds(ctx.citedKeys, ids, ctx.resolvers.citationKeys, {
    isLocalTarget: (id) => readerCatalogCrossref(ctx, id) !== null,
  });
  return {
    html: renderReaderReferenceRouteHtml(ctx, input, route, sourceAttrs),
    text: referencePresentationRouteText(route),
    hasMath: false,
  };
}

// ---------------------------------------------------------------------------
// Block rendering.
// ---------------------------------------------------------------------------

type TruncateSpec = { lines: number } | { chars: number };

export type ReaderOutlineEntry = DocumentOutlineEntry;

export interface RenderOptions {
  /** If true, emit `data-source-line` on every block-level element. */
  sourceLineAttribution?: boolean;
  /**
   * If true, emit a stable `id` on every heading (an explicit Pandoc `{#id}`
   * when present, else a deduplicated slug) and return an {@link ReaderOutlineEntry}
   * list in document order. Off by default — the un-opted output is
   * byte-identical to the form without it (only explicitly-labeled headings
   * carry ids).
   */
  outline?: boolean;
  /**
   * If true, the reader resolves in-document crossrefs (`[@eq:…]`, `[@thm:…]`,
   * `[@sec:…]`) itself — numbering them from the document and falling back to
   * the host `refResolver` only for ids it doesn't own (e.g. cross-file or
   * workspace refs). Implemented as a first numbering walk that builds the
   * catalog, then a resolving walk. Off by default (host resolves everything).
   */
  resolveReferences?: boolean;
  /**
   * If true, return a Lezer-backed in-document preview index keyed by explicit
   * heading/equation/block ids. Hosts can pass it to hydrateReaderHoverPreviews
   * so hover cards use the same target ownership the reader used while numbering.
   */
  referencePreviews?: boolean;
  /** If true, emit `data-source-from`/`data-source-to` byte offsets on
   *  every block element, every inline mark (`<strong>`, `<em>`, `<del>`,
   *  `<code>`, `<a>`, `<sup class="cf-footnote-ref">`, `<span data-math>`,
   *  citation/crossref spans), and wrap contiguous plain-text runs in
   *  `<span class="cf-text" data-source-from=… data-source-to=…>`. Off by
   *  default — output is byte-identical to the un-opted form. */
  sourcePositions?: boolean;
  /**
   * If true, emit stable `data-cf-anchor-id` metadata on rendered block and
   * inline source carriers and return a rendered source map. Implies
   * `sourcePositions` and line-range attribution for anchors.
   */
  sourceMap?: boolean;
  /** If true, emit `data-source-from`/`data-source-to` on math spans only. */
  mathSourcePositions?: boolean;
  /** Block-boundary truncation budget. */
  truncate?: TruncateSpec;
  /** Current document path forwarded to host resolvers. */
  documentPath?: string;
  /**
   * Emit interactive disclosure controls for semantic blocks. Defaults to true.
   * Set false for inert preview surfaces such as hover cards.
   */
  interactiveBlockDisclosures?: boolean;
  /**
   * Display section numbers on headings. Defaults to true. When false, every
   * heading renders as if unnumbered (no `data-section-number`, the
   * `cf-doc-heading--unnumbered` class, and no `number` on outline entries), so
   * neither the explicit nor the CSS-counter numbering shows — a host-level
   * toggle that avoids restyling `.cf-*` internals. The internal numbering walk
   * still runs, so in-document `[@sec:…]` crossrefs keep resolving to their
   * numbers (coflat#47).
   */
  sectionNumbering?: boolean;
  /**
   * Host-controlled block-boundary layout gaps. The reader resolves each
   * 1-based source line to the first rendered block whose source line range
   * contains it and emits a placeholder gap before or after that block.
   *
   * This is intentionally document-layout metadata, not diff semantics: hosts
   * own PR/gap pairing and only ask Coflat to insert placeholders at safe
   * rendered boundaries.
   */
  layoutGaps?: readonly ReaderLayoutGap[];
}

export interface TruncatedInfo {
  sourceFrom: number;
  sourceTo: number;
}

interface BlockResult {
  html: string;
  text: string;
  hasMath: boolean;
}

function emptyBlock(): BlockResult {
  return { html: "", text: "", hasMath: false };
}

function combineBlocks(blocks: BlockResult[]): BlockResult {
  const htmls: string[] = [];
  const texts: string[] = [];
  let hasMath = false;
  for (const b of blocks) {
    if (b.html) htmls.push(b.html);
    if (b.text) texts.push(b.text);
    if (b.hasMath) hasMath = true;
  }
  return { html: htmls.join(""), text: texts.join("\n\n"), hasMath };
}

/** Block-level convenience: emits both `data-source-line` (if
 *  `sourceLineAttribution`) and `data-source-from`/`data-source-to` (if
 *  `sourcePositions`). Pass the block node's `from`/`to`. */
function blockSourceAttrs(ctx: WalkContext, from: number, to: number, kind = "block"): string {
  const lineRange = sourceLineRange(ctx, from, to);
  return sourceRangeAttrs({
    sourceLine: ctx.sourceLineAttribution && !ctx.sourceMap ? lineRange?.from ?? null : null,
    sourceLineRange: ctx.sourceMap ? lineRange ?? null : null,
    sourceRange: ctx.sourcePositions ? { from, to } : null,
  }) + sourceAnchorAttrs(ctx, kind, "block", from, to);
}

function blockMathSourceAttrs(ctx: WalkContext, from: number, to: number, kind = "display-math"): string {
  const lineRange = sourceLineRange(ctx, from, to);
  return sourceRangeAttrs({
    sourceLine: ctx.sourceLineAttribution && !ctx.sourceMap ? lineRange?.from ?? null : null,
    sourceLineRange: ctx.sourceMap ? lineRange ?? null : null,
    sourceRange: ctx.mathSourcePositions ? { from, to } : null,
  }) + sourceAnchorAttrs(ctx, kind, "block", from, to);
}

function normalizeLayoutGaps(gaps: readonly ReaderLayoutGap[] | undefined): ReaderLayoutGap[] {
  if (!gaps?.length) return [];
  const out: ReaderLayoutGap[] = [];
  const seen = new Set<string>();
  for (const gap of gaps) {
    if (!gap.id || seen.has(gap.id)) continue;
    if (!Number.isInteger(gap.sourceLine) || gap.sourceLine < 1) continue;
    seen.add(gap.id);
    out.push({
      id: gap.id,
      sourceLine: gap.sourceLine,
      placement: gap.placement === "after" ? "after" : "before",
      ...(Number.isFinite(gap.height) && gap.height !== undefined && gap.height >= 0 ? { height: gap.height } : {}),
      ...(gap.className ? { className: gap.className } : {}),
    });
  }
  return out;
}

function layoutGapsForBlock(ctx: WalkContext, from: number, to: number, placement: "before" | "after"): ReaderLayoutGap[] {
  if (ctx.layoutGaps.length === 0) return [];
  const lineRange = sourceLineRange(ctx, from, to);
  if (!lineRange) return [];
  return ctx.layoutGaps.filter((gap) =>
    !ctx.emittedLayoutGapIds.has(gap.id) &&
    (gap.placement ?? "before") === placement &&
    lineRange.from <= gap.sourceLine &&
    gap.sourceLine <= lineRange.to
  );
}

function renderLayoutGap(gap: ReaderLayoutGap): string {
  const classes = ["cf-doc-layout-gap", ...safeClassTokens(gap.className)];
  const style = gap.height === undefined ? "" : ` style="height:${gap.height}px"`;
  return `<div class="${classes.join(" ")}" data-cf-layout-gap-id="${escapeHtml(gap.id)}"${style} aria-hidden="true"></div>`;
}

function safeClassTokens(className: string | undefined): string[] {
  if (!className) return [];
  return className.split(/\s+/).filter((token) => /^[A-Za-z0-9_-]+$/.test(token));
}

function emitBlockWithLayoutGaps(ctx: WalkContext, blocks: BlockResult[], block: BlockResult, from: number, to: number): void {
  const before = layoutGapsForBlock(ctx, from, to, "before");
  for (const gap of before) {
    blocks.push({ html: renderLayoutGap(gap), text: "", hasMath: false });
    ctx.emittedLayoutGapIds.add(gap.id);
  }
  blocks.push(block);
  const after = layoutGapsForBlock(ctx, from, to, "after");
  for (const gap of after) {
    blocks.push({ html: renderLayoutGap(gap), text: "", hasMath: false });
    ctx.emittedLayoutGapIds.add(gap.id);
  }
}

function renderBlock(ctx: WalkContext, node: SyntaxNode): BlockResult {
  return dispatchBlockNodeRender(node, {
    document: () => renderParagraph(ctx, node),
    heading: () => renderHeading(ctx, node),
    paragraph: () => renderParagraph(ctx, node),
    list: () => renderList(ctx, node),
    blockquote: () => renderBlockquote(ctx, node),
    codeBlock: () => renderFencedCode(ctx, node),
    horizontalRule: () => renderHorizontalRule(ctx, node),
    table: () => renderTable(ctx, node),
    fencedDiv: () => renderFencedDiv(ctx, node),
    footnoteDefinition: () => renderFootnoteDef(ctx, node),
    displayMath: () => {
      const plan = displayMathRenderPlan(ctx.source, node);
      const raw = ctx.source.slice(plan.sourceRange.from, plan.sourceRange.to);
      const equationId = plan.equationId;
      let equationNumber: number | undefined;
      if (equationId) {
        const result = nextEquationNumber(ctx.equationCounter);
        ctx.equationCounter = result.counter;
        equationNumber = result.number;
      }
      const target = equationId && equationNumber !== undefined
        ? equationReferenceTarget({
          from: plan.sourceRange.from,
          to: plan.sourceRange.to,
          id: equationId,
          number: equationNumber,
          latex: plan.latex,
        })
        : null;
      if (ctx.buildReferencePreviews && equationId && target && equationNumber !== undefined) {
        const range = displayMathLatexRange(ctx.source, node);
        const previewEntry = referencePreviewEntryFromTarget(target, {
          fallbackId: equationId,
          bodyRange: range,
          sourceRange: plan.sourceRange,
        });
        setPreferredReaderReferenceTarget(ctx, equationId, target, previewEntry ?? undefined);
      } else if (ctx.buildCatalog && equationId && target) {
        setPreferredReaderReferenceTarget(ctx, equationId, target);
      }
      return {
        html: renderDisplayMathPlaceholderHtml(plan.latex, raw, {
          equationNumber,
          id: equationId ?? undefined,
          sourceAttrs: blockMathSourceAttrs(ctx, plan.sourceRange.from, plan.sourceRange.to, "display-math"),
        }),
        text: raw,
        hasMath: true,
      };
    },
    ignored: () =>
      // Drop frontmatter / HTML blocks from rendered output. Sanitizer
      // would strip raw HTML anyway; explicit drop avoids re-injection.
      emptyBlock(),
    fallback: () => renderParagraph(ctx, node),
  });
}

/** Reserve every explicit `{#id}` heading id so auto-slugs yield to author-set
 *  anchors (explicit ids win; an auto-slug that would collide gets suffixed). */
function reserveExplicitHeadingIds(ctx: WalkContext, tree: Tree, frontmatterEnd: number): void {
  const headings: Array<{ id?: string }> = [];
  tree.iterate({
    enter(node) {
      if (!headingLevelFor(node.name)) return;
      // The last frontmatter YAML line, underlined by the closing `---`, parses
      // as a Setext heading. Skip anything inside the frontmatter byte range so
      // a `{#id}` appearing in a YAML value cannot reserve — and thereby steal —
      // a real heading's anchor id.
      if (node.from < frontmatterEnd) return false;
      const plan = headingRenderPlan(ctx.source, node.node);
      headings.push({ id: plan.attributes?.id });
      // A heading can't contain another heading — skip its inline subtree.
      return false;
    },
  });
  ctx.usedHeadingIds = reserveExplicitHeadingAnchorIds(headings);
}

function renderHeading(ctx: WalkContext, node: SyntaxNode): BlockResult {
  const plan = headingRenderPlan(ctx.source, node, {
    sourceRanges: ctx.sourcePositions || ctx.mathSourcePositions,
  });
  const inner = renderInlineFragmentsForReader(
    ctx,
    plan.fragments,
    plan.contentRange.from,
    plan.contentRange.to,
  );
  // The numbering walk always advances (and records the catalog), so crossrefs
  // resolve even when numbers aren't shown; `displayUnnumbered` only hides the
  // number — when sectionNumbering is off, every heading renders unnumbered.
  const headingNumberResult = nextHeadingNumber(
    {
      appendixBoundary: !!plan.attributes?.appendixBoundary,
      level: plan.level,
      unnumbered: !!plan.attributes?.unnumbered,
    },
    ctx.headingCounters,
  );
  ctx.headingCounters = headingNumberResult.counters;
  const headingNumber = headingNumberResult.number;
  const headingTitle = plan.text.trim();
  const headingTarget = headingReferenceTarget({
    from: plan.sourceRange.from,
    to: plan.sourceRange.to,
    id: plan.attributes?.id,
    number: headingNumber,
    text: headingTitle,
  });
  if (ctx.buildReferencePreviews && plan.attributes?.id) {
    const previewEntry = referencePreviewEntryFromTarget(headingTarget, {
      fallbackId: plan.attributes.id,
      headingLevel: plan.level,
      sourceRange: plan.sourceRange,
    });
    setPreferredReaderReferenceTarget(ctx, plan.attributes.id, headingTarget, previewEntry ?? undefined);
  } else if (ctx.buildCatalog && plan.attributes?.id) {
    setPreferredReaderReferenceTarget(ctx, plan.attributes.id, headingTarget);
  }
  const displayUnnumbered = !!plan.attributes?.unnumbered || !ctx.numberHeadings;

  // Default: an id only for explicitly-labeled headings (byte-identical to the
  // pre-outline output). With `opts.outline`, every heading gets a stable id
  // (explicit `{#id}` or a deduplicated slug) and contributes an outline entry.
  let headingId = plan.attributes?.id;
  if (ctx.collectOutline) {
    const outlineEntry = nextHeadingOutlineProjectionEntry({
      from: plan.sourceRange.from,
      text: plan.text,
      id: headingId,
      level: plan.level,
      number: headingNumber,
    }, ctx.usedHeadingIds, {
      markdown: () => ctx.source.slice(plan.contentRange.from, plan.contentRange.to),
      html: () => inner.html,
      displayUnnumbered: () => displayUnnumbered,
    });
    headingId = outlineEntry.id;
    ctx.outline.push({
      id: outlineEntry.id,
      text: outlineEntry.text,
      html: outlineEntry.html,
      level: outlineEntry.level,
      ...(outlineEntry.number ? { number: outlineEntry.number } : {}),
    });
  }
  return {
    html: renderHeadingSurfaceHtml(
      inner.html,
      {
        level: plan.level,
        id: headingId,
        sectionNumber: headingNumber,
        unnumbered: displayUnnumbered,
      },
      blockSourceAttrs(ctx, plan.sourceRange.from, plan.sourceRange.to, `heading-${plan.level}`),
    ),
    text: plan.text,
    hasMath: plan.hasMath,
  };
}

function renderParagraph(ctx: WalkContext, node: SyntaxNode): BlockResult {
  const plan = paragraphRenderPlan(ctx.source, node, {
    sourceRanges: ctx.sourcePositions || ctx.mathSourcePositions,
  });
  const inner = renderInlineFragmentsForReader(
    ctx,
    plan.fragments,
    plan.contentRange.from,
    plan.contentRange.to,
  );
  return {
    html: renderParagraphHtml(inner.html, blockSourceAttrs(ctx, plan.sourceRange.from, plan.sourceRange.to, "paragraph")),
    text: plan.text,
    hasMath: plan.hasMath,
  };
}

function renderHorizontalRule(ctx: WalkContext, node: SyntaxNode): BlockResult {
  const plan = horizontalRuleRenderPlan(node);
  return {
    html: renderHorizontalRuleHtml(blockSourceAttrs(ctx, plan.sourceRange.from, plan.sourceRange.to, "horizontal-rule")),
    text: "",
    hasMath: false,
  };
}

function renderList(ctx: WalkContext, node: SyntaxNode): BlockResult {
  const plan = listRenderPlan(ctx.source, node);
  const surfacePlan = listSurfaceEmissionPlan(plan);
  const items = plan.items.map((item, index) => renderListItem(ctx, item, surfacePlan.items[index]));

  return {
    html: renderListSurfaceHtml(
      surfacePlan.options,
      items.map((b) => b.html).join(""),
      blockSourceAttrs(ctx, plan.sourceRange.from, plan.sourceRange.to, plan.ordered ? "ordered-list" : "bullet-list"),
    ),
    text: items.map((b) => b.text).join("\n"),
    hasMath: items.some((b) => b.hasMath),
  };
}

function renderListItem(
  ctx: WalkContext,
  plan: ListItemRenderPlan,
  surfacePlan: ListItemSurfaceEmissionPlan,
): BlockResult {
  const blocks: BlockResult[] = [];
  for (const childPlan of surfacePlan.childPlans) {
    switch (childPlan.kind) {
      case "task": {
        if (!plan.task) break;
        const inner = renderInline(
          ctx,
          childPlan.node,
          plan.task.trimmedContentRange.from,
          plan.task.trimmedContentRange.to,
        );
        blocks.push({
          html: renderParagraphHtml(
            inner.html,
            blockSourceAttrs(ctx, plan.task.trimmedContentRange.from, plan.task.trimmedContentRange.to, "task-paragraph"),
          ),
          text: inner.text,
          hasMath: inner.hasMath,
        });
        break;
      }
      case "inline-paragraph":
      case "block":
        blocks.push(renderBlock(ctx, childPlan.node));
        break;
    }
  }

  // If the only block is a paragraph, unwrap it to bare inline (tight item).
  let inner: string;
  let text: string;
  const hasMath = blocks.some((b) => b.hasMath);
  if (plan.inlineOnly && blocks.length === 1 && blocks[0].html.startsWith(`<p class="${paragraphClasses}"`)) {
    // Strip outer <p>…</p>.
    inner = blocks[0].html.replace(new RegExp(`^<p class="${paragraphClasses}"[^>]*>`), "").replace(/<\/p>$/, "");
    text = blocks[0].text;
  } else {
    inner = blocks.map((b) => b.html).join("");
    text = blocks.map((b) => b.text).join("\n");
  }

  if (plan.task) {
    const cb = `${renderReadOnlyTaskCheckboxHtml(plan.task.checked)} `;
    inner = cb + inner;
    text = (plan.task.checked ? "[x] " : "[ ] ") + text;
  }
  return {
    html: renderListItemSurfaceHtml(
      surfacePlan.options,
      surfacePlan.markerNumber,
      inner,
      blockSourceAttrs(ctx, plan.sourceRange.from, plan.sourceRange.to, plan.task ? "task-list-item" : "list-item"),
    ),
    text,
    hasMath,
  };
}

function renderBlockquote(ctx: WalkContext, node: SyntaxNode): BlockResult {
  const plan = blockquoteRenderPlan(node);
  const blocks = emitBlockChildrenRenderPlan(plan.children, {
    emitBlank: () => undefined,
    emitChild: (childPlan) => renderBlock(ctx, childPlan.node),
  });
  return {
    html: renderBlockquoteHtml(
      blocks.map((b) => b.html).join(""),
      blockSourceAttrs(ctx, plan.sourceRange.from, plan.sourceRange.to, "blockquote"),
    ),
    text: blocks.map((b) => b.text).join("\n"),
    hasMath: blocks.some((b) => b.hasMath),
  };
}

function renderFencedCode(ctx: WalkContext, node: SyntaxNode): BlockResult {
  const plan = codeBlockRenderPlan(ctx.source, node);
  return {
    html: renderCodeBlockHtml(
      plan.language,
      plan.code,
      blockSourceAttrs(ctx, plan.sourceRange.from, plan.sourceRange.to, "code-block"),
    ),
    text: plan.code,
    hasMath: false,
  };
}

function renderTable(ctx: WalkContext, node: SyntaxNode): BlockResult {
  const plan = tableRenderPlan(ctx.source, node, {
    sourceRanges: ctx.sourcePositions || ctx.mathSourcePositions,
  });

  const textRowsByFrom = new Map<number, string[]>();
  let hasMath = false;
  const html = renderTablePlanHtml(plan, {
    tableAttrs: blockSourceAttrs(ctx, plan.sourceRange.from, plan.sourceRange.to, "table"),
    rowAttrs: (row) => blockSourceAttrs(ctx, row.sourceRange.from, row.sourceRange.to, row.header ? "table-header-row" : "table-row"),
    renderCell: (cell, row) => {
      const inner = renderInlineFragmentsForReader(
        ctx,
        cell.fragments,
        cell.contentRange.from,
        cell.contentRange.to,
      );
      const rowTexts = textRowsByFrom.get(row.sourceRange.from) ?? [];
      rowTexts.push(inner.text);
      textRowsByFrom.set(row.sourceRange.from, rowTexts);
      if (inner.hasMath) hasMath = true;
      return inner.html;
    },
  });
  const textRows = [plan.header, ...plan.rows]
    .filter((row): row is TableRowRenderPlan => row !== null)
    .map((row) => (textRowsByFrom.get(row.sourceRange.from) ?? []).join("\t"));
  return {
    html,
    text: textRows.join("\n"),
    hasMath,
  };
}

function renderBlankLine(ctx: WalkContext, from: number, to: number): BlockResult {
  const lineRange = sourceLineRange(ctx, from, to);
  return {
    html: renderBlankLineHtml(sourceRangeAttrs({
      sourceLine: ctx.sourceLineAttribution && !ctx.sourceMap ? lineRange?.from ?? null : null,
      sourceLineRange: ctx.sourceMap ? lineRange ?? null : null,
      sourceRange: ctx.sourcePositions ? { from, to } : null,
    })),
    text: "",
    hasMath: false,
  };
}

function renderFencedDiv(ctx: WalkContext, node: SyntaxNode): BlockResult {
  const plan = fencedDivRenderPlan(ctx.source, node, {
    displayTitleForBlockType: (blockType) => blockDisplayTitle(ctx, blockType),
    numberForFencedDiv: (block) => ctx.blockNumbers.byPosition.get(block.from)?.number,
    semanticBlockDisclosures: ctx.semanticBlockDisclosures,
  });

  const blocks: BlockResult[] = [];
  emitBlockChildrenRenderPlan(plan.children, {
    emitBlank: (range) => blocks.push(renderBlankLine(ctx, range.from, range.to)),
    emitChild: (childPlan) => {
      const block = renderBlock(ctx, childPlan.node);
      blocks.push(block);
      return block;
    },
  });

  const normalizedClassName = plan.primaryClassName;
  const chrome = fencedDivSurfaceChromePlan(plan);
  if (chrome.decorateLastBodyBlockWithQed) {
    addClassToLastHtmlBlock(blocks, CSS.blockQed);
  }
  const attrs = blockContainerSurfaceAttrs(fencedDivContainerOptions(plan));
  const body = combineBlocks(blocks);
  const sourceAttrs = blockSourceAttrs(ctx, plan.sourceRange.from, plan.sourceRange.to, normalizedClassName ?? "fenced-div");
  const caption = chrome.captionSlot === "below" && plan.title && normalizedClassName
    ? renderBlockCaption(ctx, normalizedClassName, plan.title, plan.titleFragments, plan.number, node.from, node.to)
    : emptyBlock();
  const blockTarget = plan.id && normalizedClassName
    ? blockReferenceTarget({
      from: plan.sourceRange.from,
      to: plan.sourceRange.to,
      id: plan.id,
      blockType: normalizedClassName,
      displayTitle: plan.displayTitle ?? blockDisplayTitle(ctx, normalizedClassName),
      title: plan.title,
      number: plan.number,
    })
    : null;
  if (ctx.buildReferencePreviews && plan.id && normalizedClassName && blockTarget) {
    const bodyRange = fencedDivPreviewBodyRange(ctx.source, {
      fullRange: plan.sourceRange,
      bodyRange: plan.bodyRange,
    });
    const previewEntry = referencePreviewEntryFromTarget(blockTarget, {
      fallbackId: plan.id,
      bodyRange,
      sourceRange: plan.sourceRange,
    });
    setPreferredReaderReferenceTarget(ctx, plan.id, blockTarget, previewEntry ?? undefined);
  } else if (ctx.buildCatalog && plan.id && blockTarget) {
    setPreferredReaderReferenceTarget(ctx, plan.id, blockTarget);
  }
  const summary = normalizedClassName
    ? renderBlockSummary(ctx, normalizedClassName, plan.title, plan.titleFragments, plan.number)
    : emptyBlock();
  const summaryHtml = summary.html;
  const selfClosingTitle = chrome.titleSlot === "self-closing-paragraph"
    ? renderInlineFragmentsForReader(ctx, plan.titleFragments, node.from, node.to)
    : emptyBlock();
  const standaloneTitle = chrome.titleSlot === "standalone-label"
    ? renderInlineFragmentsForReader(ctx, plan.titleFragments, node.from, node.to)
    : emptyBlock();
  const blockBodyHtml = selfClosingTitle.html
    ? renderParagraphHtml(selfClosingTitle.html)
    : body.html;
  const abstractLabelHtml = normalizedClassName === "abstract" && summary.text
    ? `<div class="${CSS.docAbstractLabel}">${renderBlockLabelHtml(summary.text)}</div>`
    : "";
  const bodyHtml = abstractLabelHtml
    ? abstractLabelHtml + blockBodyHtml + caption.html
    : standaloneTitle.html
    ? renderBlockLabelContentHtml(standaloneTitle.html) + body.html + caption.html
    : blockBodyHtml + caption.html;
  const html = chrome.bodySlot === "inline-heading"
    ? renderInlineBlockHeadingContainerHtml(attrs, sourceAttrs, summaryHtml, bodyHtml)
    : chrome.bodySlot === "disclosure"
    ? `<div${attrs}${sourceAttrs}${chrome.setInitialOpenState ? ' data-cf-block-open="true"' : ""}>${renderBlockHeader(summaryHtml, bodyHtml)}</div>`
    : `<div${attrs}${sourceAttrs}>${bodyHtml}</div>`;

  return {
    html,
    text: [selfClosingTitle.text, standaloneTitle.text, body.text, caption.text].filter(Boolean).join("\n\n"),
    hasMath: summary.hasMath || selfClosingTitle.hasMath || standaloneTitle.hasMath || body.hasMath || caption.hasMath,
  };
}

function renderFootnoteDef(ctx: WalkContext, node: SyntaxNode): BlockResult {
  const plan = footnoteDefinitionRenderPlan(ctx.source, node, {
    sourceRanges: ctx.sourcePositions || ctx.mathSourcePositions,
  });
  if (!plan) return emptyBlock();

  const renderedBody = renderInlineFragmentsForReader(
    ctx,
    plan.fragments,
    plan.bodyRange.from,
    plan.bodyRange.to,
  );
  const { html, hasMath } = renderedBody;

  // Register / update footnote entry. Forward-ref may have already assigned a
  // number; the shared emitted-footnote state preserves it.
  registerFootnoteDefinition(ctx.footnotes, plan.id, html);

  // FootnoteDef itself emits no inline output; the footnotes list is
  // appended at the end of the document. Propagate hasMath so math
  // inside a footnote body still triggers KaTeX hydration when the
  // list renders.
  return { html: "", text: "", hasMath };
}

function renderFootnotesList(ctx: WalkContext): string {
  if (ctx.footnotes.numbering.orderedIds.length === 0) return "";
  const plannedEntries = footnoteSectionPlanFromNumberedEntries(
    footnoteEmissionSectionEntries(
      ctx.footnotes,
      (entry) => entry.hasRef || Boolean(entry.body),
    ),
  );
  return renderFootnoteSectionHtml(
    plannedEntries.map((entry) => ({
      ...entry,
      html: entry.body ?? "",
    })),
  );
}

// Pandoc `nocite:` frontmatter — bibliography entries without an in-text
// citation. Appended after the walk so they follow every real citation,
// matching the editor's bibliography pipeline.
function appendNociteCitedKeys(
  ctx: WalkContext,
  nocite: readonly string[] | undefined,
): void {
  const keys = ctx.resolvers.citationKeys;
  if (!keys) return;
  const nociteIds = resolveNociteIds(nocite, keys, {
    isLocalTarget: (id) => readerCatalogCrossref(ctx, id) !== null,
  });
  for (const id of nociteIds) {
    if (!ctx.citedKeys.includes(id)) ctx.citedKeys.push(id);
  }
}

// The References list, emitted from the same citeproc formatter that produced
// the inline labels — so the reader renders citations end to end instead of the
// host bolting a bibliography on. Mirrors the editor's bibliography DOM so the
// shared stylesheet lays out the [N] columns. Only present when citations were
// actually resolved (host supplied citationKeys + citationFormatter).
function renderReferencesList(ctx: WalkContext): string {
  const formatter = ctx.resolvers.citationFormatter;
  if (!formatter || ctx.citedKeys.length === 0) return "";
  const entries = coreBibliographyEntries(formatter, ctx.citedKeys);
  if (entries.length === 0) return "";
  return renderBibliographySectionHtml(entries);
}

// ---------------------------------------------------------------------------
// Top-level walk.
// ---------------------------------------------------------------------------

function walkDocument(
  source: string,
  tree: Tree,
  resolvers: Resolvers,
  opts: RenderOptions,
): BlockResult & {
  truncated?: TruncatedInfo;
  outline: ReaderOutlineEntry[];
  catalog: Map<string, DocumentReferenceTarget>;
  referencePreviewIndex: ReaderReferencePreviewCatalog;
  sourceMap: RenderedSourceAnchor[];
  mathMacros?: Record<string, string>;
} {
  const frontmatter = parseFrontmatter(source);
  const frontmatterEnd = frontmatter.end;
  const blockConfig = frontmatter.config.blocks;
  const buildCatalog = !!(opts.resolveReferences || opts.referencePreviews);
  const surfacePolicy = opts.interactiveBlockDisclosures === false
    ? documentSurfacePolicy("hover-preview")
    : documentSurfacePolicy("reader");
  const blockNumbering = frontmatter.config.numbering ?? "grouped";
  const blockNumberingSpec = createConfiguredBlockNumberingSpecLookup(blockConfig);
  const ctx: WalkContext = {
    source,
    resolvers,
    lineOffsets: opts.sourceLineAttribution || opts.sourceMap || opts.layoutGaps?.length ? buildLineOffsets(source) : null,
    sourceLineAttribution: !!opts.sourceLineAttribution,
    sourcePositions: !!(opts.sourcePositions || opts.sourceMap),
    mathSourcePositions: !!(opts.sourcePositions || opts.sourceMap || opts.mathSourcePositions),
    semanticBlockDisclosures: surfacePolicy.semanticBlockDisclosures,
    surfacePolicy,
    collectOutline: !!opts.outline,
    outline: [],
    usedHeadingIds: new Set(),
    headingCounters: initialHeadingNumberCounters(),
    blockNumbering,
    blockNumberingSpec,
    blockTitles: blockTitleOverridesFromConfig(blockConfig),
    blockNumbers: computeReaderBlockNumbers(
      source,
      tree,
      blockNumberingSpec,
      blockNumbering,
      frontmatterEnd,
    ),
    equationCounter: initialEquationNumberCounter(),
    footnotes: createFootnoteEmissionState(),
    citedKeys: [],
    catalog: new Map(),
    referencePreviewIndex: new Map(),
    buildCatalog,
    buildReferencePreviews: !!opts.referencePreviews,
    numberHeadings: opts.sectionNumbering !== false,
    layoutGaps: normalizeLayoutGaps(opts.layoutGaps),
    emittedLayoutGapIds: new Set(),
    sourceMap: !!opts.sourceMap,
    sourceAnchors: [],
    sourceAnchorCounts: new Map(),
  };

  if (ctx.collectOutline) reserveExplicitHeadingIds(ctx, tree, frontmatterEnd);

  const truncate = opts.truncate;
  const budgetKind: "lines" | "chars" | null = truncate
    ? "lines" in truncate ? "lines" : "chars"
    : null;
  const budget = truncate
    ? "lines" in truncate ? truncate.lines : truncate.chars
    : Infinity;

  const root = tree.topNode;
  const blocks: BlockResult[] = [];
  if (frontmatter.config.title) {
    const title = frontmatter.config.title;
    // A document title is a single line of inline markdown — render it inline
    // (like fenced-div block titles and the editor's title widget), not as a
    // full block document, so it never sprouts headings/lists/paragraphs.
    const renderedTitle = renderInlineSnippet(ctx, title);
    blocks.push({
      html: `<div class="${CSS.docHeader}"${blockSourceAttrs(ctx, 0, frontmatterEnd, "document-title")}><div class="${CSS.docTitle}">${renderedTitle.html}</div></div>`,
      text: title,
      hasMath: renderedTitle.hasMath,
    });
  }
  let topCount = blocks.length;
  let used = 0;
  let truncated: TruncatedInfo | undefined;
  const documentPlan = documentRenderPlan(source, root, { leadingBlockCount: blocks.length });
  let pendingBlankRanges: Array<{ from: number; to: number }> = [];
  const flushPendingBlankRanges = () => {
    for (const range of pendingBlankRanges) {
      blocks.push(renderBlankLine(ctx, range.from, range.to));
    }
    pendingBlankRanges = [];
  };

  emitDocumentRenderPlan(documentPlan, {
    emitBlank: (range) => {
      if (!truncated) {
        pendingBlankRanges.push(range);
      }
    },
    emitChild: (childPlan) => {
      if (truncated) return;
      const child = childPlan.node;
      if (budgetKind) {
        // Snapshot footnote state so we can roll back if we end up not emitting.
        const footnoteSnapshot = snapshotFootnoteEmissionState(ctx.footnotes);
        const headingCounterSnapshot = cloneHeadingCounters(ctx.headingCounters);
        const outlineLen = ctx.outline.length;
        const usedHeadingIdsSnapshot = new Set(ctx.usedHeadingIds);
        const citedKeysLen = ctx.citedKeys.length;
        // A fenced div records nested + its own catalog entries (post-order), so a
        // full snapshot is needed — a dropped block must not leave a catalog entry
        // that a later [@id] resolves to a number whose target was truncated away.
        const catalogSnapshot = ctx.buildCatalog ? new Map(ctx.catalog) : null;
        const referencePreviewIndexSnapshot = ctx.buildReferencePreviews
          ? new Map(ctx.referencePreviewIndex)
          : null;
        const rendered = renderBlock(ctx, child);
        const cost = budgetKind === "lines"
          ? blockLineCost(source, child)
          : rendered.text.length;
        if (used > 0 && used + cost > budget) {
          // Roll back footnote side-effects, then stop before this block.
          ctx.footnotes = footnoteSnapshot;
          ctx.headingCounters = headingCounterSnapshot;
          ctx.outline.length = outlineLen;
          ctx.usedHeadingIds = usedHeadingIdsSnapshot;
          ctx.citedKeys.length = citedKeysLen;
          if (catalogSnapshot) ctx.catalog = catalogSnapshot;
          if (referencePreviewIndexSnapshot) {
            ctx.referencePreviewIndex = referencePreviewIndexSnapshot;
          }
          pendingBlankRanges = [];
          truncated = { sourceFrom: child.from, sourceTo: source.length };
          return;
        }
        // Either used===0 (must emit at least this block, even if it busts
        // budget — atomic blocks) or budget still has room. Emit.
        flushPendingBlankRanges();
        emitBlockWithLayoutGaps(ctx, blocks, rendered, child.from, child.to);
        used += cost;
        topCount++;
        return;
      }
      flushPendingBlankRanges();
      topCount++;
      emitBlockWithLayoutGaps(ctx, blocks, renderBlock(ctx, child), child.from, child.to);
    },
    emitTrailingBlank: (range) => {
      if (!truncated) {
        blocks.push(renderBlankLine(ctx, range.from, range.to));
      }
    },
  });

  // If the document has exactly one top-level block AND it is a Paragraph
  // (and no math) AND we did not truncate, unwrap the `<p>` to preserve the
  // existing bare-inline shape that callers (and existing tests) rely on for
  // short inputs.
  let combined: BlockResult;
  if (
    !truncated &&
    topCount === 1 &&
    blocks.length === 1 &&
    blocks[0].html.startsWith(`<p class="${paragraphClasses}"`)
  ) {
    const stripped = blocks[0].html
      .replace(new RegExp(`^<p class="${paragraphClasses}"[^>]*>`), "")
      .replace(/<\/p>$/, "");
    combined = { html: stripped, text: blocks[0].text, hasMath: blocks[0].hasMath };
  } else {
    combined = combineBlocks(blocks);
  }

  if (truncated) {
    const marker = `<span class="${CSS.truncationMarker}" data-source-from="${truncated.sourceFrom}" data-source-to="${truncated.sourceTo}"></span>`;
    combined = {
      html: combined.html + marker,
      text: combined.text,
      hasMath: combined.hasMath,
    };
  }

  appendNociteCitedKeys(ctx, frontmatter.config.nocite);
  const references = renderReferencesList(ctx);
  if (references) {
    combined = {
      html: combined.html + references,
      text: combined.text,
      hasMath: combined.hasMath,
    };
  }
  const footnotes = renderFootnotesList(ctx);
  if (footnotes) {
    combined = {
      html: combined.html + footnotes,
      text: combined.text,
      hasMath: combined.hasMath,
    };
  }
  return {
    ...combined,
    truncated,
    outline: ctx.outline,
    catalog: ctx.catalog,
    referencePreviewIndex: ctx.referencePreviewIndex,
    sourceMap: ctx.sourceAnchors,
    // Surface the document's frontmatter `math:` macros so the host can forward
    // them to `hydrateMath` without re-parsing. Mirrors the editor, where the
    // same `config.math` feeds `mathMacrosField` and every math render path.
    mathMacros: frontmatter.config.math,
  };
}

// ---------------------------------------------------------------------------
// DOMPurify sanitization.
// ---------------------------------------------------------------------------

const ALLOWED_TAGS = [
  "p", "br", "span", "div", "details", "summary",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "blockquote",
  "pre", "code",
  "em", "strong", "del", "mark", "i", "b",
  "a", "img", "object", "button",
  "hr",
  "table", "thead", "tbody", "tr", "th", "td",
  "sup", "sub",
  "input",
];
const ALLOWED_ATTR = [
  "href", "src", "data", "alt", "title", "class", "id", "start", "open",
  "type", "checked", "disabled", "tabindex", "aria-disabled", "aria-expanded", "aria-label",
  "data-math", "data-lang", "data-checked", "data-align",
  "data-ref-key", "data-ref-mode", "data-source-line",
  "style",
];
// Pandoc attribute keys can have arbitrary names — we allow any `data-*`.
const ALLOWED_ATTR_RE = /^data-[a-z0-9-]+$/i;

let _purify: ReturnType<typeof createDOMPurify> | null = null;
let _purifyTried = false;

function getPurify(): ReturnType<typeof createDOMPurify> | null {
  if (_purifyTried) return _purify;
  _purifyTried = true;
  if (typeof window === "undefined") return null;
  try {
    const p = createDOMPurify(window);
    p.addHook("afterSanitizeAttributes", (node) => {
      const href = node.getAttribute("href");
      if (href && !isSafeUrl(href)) node.removeAttribute("href");
      const src = node.getAttribute("src");
      if (src && !isSafeUrl(src)) node.removeAttribute("src");
      const data = node.getAttribute("data");
      if (data && !isSafeUrl(data)) node.removeAttribute("data");
    });
    _purify = p;
    return p;
  } catch {
    return null;
  }
}

function sanitize(html: string): string {
  const p = getPurify();
  if (!p) return html;
  return p.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ADD_TAGS: ALLOWED_TAGS,
    ALLOW_DATA_ATTR: true,
    ADD_ATTR: ALLOWED_ATTR,
  });
}
void ALLOWED_ATTR_RE;

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Render a FORMAT.md source string to sanitized HTML.
 *
 * Supported output:
 * - Headings (h1–h6), paragraphs, bullet + ordered + task lists,
 *   blockquotes, fenced and indented code blocks, horizontal rules,
 *   tables (with alignment), fenced divs, footnotes.
 * - Inline: bold, italic, strikethrough, highlight, inline code, links,
 *   autolinks, images, footnote refs, math placeholders, citation +
 *   crossref placeholders.
 *
 * Output shape:
 * - Every emitted block-level element carries a `cf-*` class for theming.
 *   See THEMING.md for the full list.
 * - If the source contains a single paragraph and no other blocks, the
 *   output is the bare inline HTML *without* a surrounding `<p>`. This
 *   preserves the fast-path shape so short snippets (search hits,
 *   notification bodies) don't get gratuitously wrapped. Documents with
 *   any block structure or multiple paragraphs wrap each paragraph in
 *   `<p class="cf-doc-paragraph">`.
 * - Math nodes emit `<span class="cf-doc-inline-math cf-math-inline" data-math="…">`
 *   placeholders preserving the source verbatim. `hydrateMath` hydrates
 *   these with KaTeX.
 * - When `RefResolver` is absent (or it returns null), references emit
 *   `cf-crossref-unresolved` placeholders carrying `data-ref-key`.
 *
 * Sanitization: when a DOM window is available (browser or jsdom), HTML
 * is passed through DOMPurify before return. Tag and attribute allowlists
 * are inlined; the renderer only emits a known shape with escaped text.
 *
 * `opts.sourceLineAttribution` (default `false`) adds `data-source-line`
 * to every emitted block-level element with the 1-based source line of
 * its start position. Off by default to keep output small.
 *
 * `opts.sourcePositions` (default `false`) adds `data-source-from` and
 * `data-source-to` byte offsets on every block element, every inline
 * mark (`<strong>`, `<em>`, `<del>`, `<code>`, `<a>`, `<mark>`,
 * `<sup class="cf-footnote-ref">`, `<span data-math>`,
 * citation/crossref spans, images), and wraps contiguous plain-text
 * runs in `<span class="cf-text">`. Used by {@link mapDomRangeToSource}
 * to invert the rendering. Off by default — the un-opted output is
 * byte-identical to the form without it.
 *
 * `opts.interactiveBlockDisclosures` (default `true`) controls whether
 * semantic block headers emit disclosure buttons. Inert preview surfaces
 * set it to `false` while retaining the same header/body markup.
 */
export interface ReaderHtmlResult {
  html: string;
  hasMath: boolean;
  truncated?: TruncatedInfo;
  outline?: ReaderOutlineEntry[];
  sourceMap?: RenderedSourceAnchor[];
  mathMacros?: Record<string, string>;
  referencePreviewIndex?: ReaderReferencePreviewIndex;
}

function serializeReferencePreviewIndex(
  index: ReaderReferencePreviewCatalog,
): ReaderReferencePreviewIndex {
  const out = Object.create(null) as Record<string, ReaderReferencePreviewEntry>;
  for (const [id, entry] of index) {
    out[id] = entry;
  }
  return out;
}

export function renderToHtml(
  source: string,
  ctx?: DocumentContext,
  opts: RenderOptions = {},
): ReaderHtmlResult {
  const resolvers = buildResolvers(ctx, opts.documentPath);

  if (
    !FAST_PATH_RE.test(source) &&
    !opts.sourceLineAttribution &&
    !opts.sourcePositions &&
    !opts.sourceMap &&
    !opts.layoutGaps?.length &&
    !opts.truncate &&
    !opts.outline &&
    !opts.resolveReferences &&
    !opts.referencePreviews
  ) {
    // Plain single-line text with no markup: a bare HTML-escape is byte-for-byte
    // the canonical render. Escape directly instead of routing through
    // fastRenderInline, whose identity source→text map only renderToText needs.
    return { html: sanitize(escapeHtml(source)), hasMath: false };
  }

  const tree = parseSource(source);
  let result = walkDocument(source, tree, resolvers, opts);
  if (opts.resolveReferences && result.catalog.size > 0) {
    // The first walk numbered every heading/equation/block into result.catalog;
    // resolve in-document `[@id]` crossrefs against it in a second walk so
    // forward references (a ref before its target) resolve to the same number.
    // Skipped when the document defines no targets — the first walk's output
    // already has nothing to re-resolve (citations + host fallback ran there).
    result = walkDocument(source, tree, { ...resolvers, referenceCatalog: result.catalog }, opts);
  }
  const out: ReaderHtmlResult = {
    html: sanitize(result.html),
    hasMath: result.hasMath,
  };
  if (result.truncated) out.truncated = result.truncated;
  if (opts.outline) out.outline = result.outline;
  if (opts.sourceMap) out.sourceMap = result.sourceMap;
  if (opts.referencePreviews) {
    out.referencePreviewIndex = serializeReferencePreviewIndex(result.referencePreviewIndex);
  }
  // Resolved KaTeX macros for this document: frontmatter `math:` as the base,
  // with `ctx.mathMacros` taking precedence as a per-key override. Hosts forward
  // this to `hydrateMath` so reader math (title + body) matches the editor.
  if (result.mathMacros || ctx?.mathMacros) {
    const mathMacros = { ...result.mathMacros, ...ctx?.mathMacros };
    if (Object.keys(mathMacros).length > 0) out.mathMacros = mathMacros;
  }
  return out;
}

/**
 * Render a FORMAT.md source string to readable plain text.
 *
 * Inline markup is stripped: `**bold**` → `bold`, `[label](url)` → `label`,
 * `` `code` `` → `code`. Block markers are dropped; paragraph blocks are
 * separated by blank lines. Math source is rendered verbatim.
 *
 * `sourceToText` is provided only when the fast path was taken (linear,
 * cheap correspondence). It is `undefined` for inputs that triggered the
 * Lezer parser. FTS-highlighting consumers should fall back to substring
 * search when the map is absent.
 */
export function renderToText(
  source: string,
  ctx?: DocumentContext,
  opts: { truncate?: TruncateSpec; documentPath?: string } = {},
): { text: string; sourceToText?: Uint32Array; truncated?: TruncatedInfo } {
  const resolvers = buildResolvers(ctx, opts.documentPath);

  if (!FAST_PATH_RE.test(source) && !opts.truncate) {
    const fast = fastRenderInline(source);
    return { text: fast.text, sourceToText: fast.sourceToText };
  }

  const tree = parseSource(source);
  const result = walkDocument(source, tree, resolvers, {
    truncate: opts.truncate,
  });
  const out: { text: string; truncated?: TruncatedInfo } = { text: result.text };
  if (result.truncated) out.truncated = result.truncated;
  return out;
}

function buildResolvers(
  ctx: DocumentContext | undefined,
  documentPath?: string,
): Resolvers {
  if (!ctx) return documentPath ? { documentPath } : {};
  const fs = ctx.fileSystem;
  let resolveAssetUrl: ((path: string) => string) | undefined;
  if (fs && typeof fs.resolveAssetUrl === "function") {
    resolveAssetUrl = (path: string) => {
      const v = fs.resolveAssetUrl(path, { purpose: "display" });
      return typeof v === "string" ? v : path;
    };
  }
  return {
    linkResolver: ctx.linkResolver,
    refResolver: ctx.refResolver,
    citationFormatter: ctx.citationFormatter,
    citationKeys: ctx.citationKeys,
    resolveAssetUrl,
    documentPath,
  };
}

function resolveReaderAssetPath(documentPath: string | undefined, src: string): string {
  if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src)) return src;
  const baseDir = documentPath?.includes("/") ? documentPath.slice(0, documentPath.lastIndexOf("/")) : "";
  const parts = src.startsWith("/")
    ? src.slice(1).split("/")
    : [...(baseDir ? baseDir.split("/") : []), ...src.split("/")];
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

function isReaderLocalAssetSrc(src: string): boolean {
  return Boolean(src) && !src.startsWith("//") && !/^[a-z][a-z0-9+.-]*:/i.test(src);
}

// ---------------------------------------------------------------------------
// Reader disclosure hydration.
// ---------------------------------------------------------------------------

const BLOCK_DISCLOSURE_HYDRATED_ATTR = "data-cf-block-disclosure-hydrated";
const BLOCK_OPEN_ATTR = "data-cf-block-open";
const SECTION_OPEN_ATTR = "data-cf-section-open";

interface DisclosureParts {
  readonly body: HTMLElement;
  readonly toggle: HTMLButtonElement;
}

function blockDisclosureParts(block: HTMLElement): DisclosureParts | null {
  const heading = block.querySelector<HTMLElement>(`:scope > .${DOCUMENT_SURFACE_CLASS.blockHeading}`);
  const body = block.querySelector<HTMLElement>(`:scope > .${CSS.blockDisclosureBody}`);
  const toggle = heading?.querySelector<HTMLElement>(`:scope > .${CSS.blockDisclosureToggle}`);
  if (!(body instanceof HTMLElement) || !(toggle instanceof HTMLButtonElement)) return null;
  return { body, toggle };
}

function applyDisclosureState(
  owner: HTMLElement,
  openAttr: string,
  parts: DisclosureParts,
  expanded: boolean,
  labels: DisclosureToggleLabels,
): void {
  owner.setAttribute(openAttr, expanded ? "true" : "false");
  parts.body.hidden = !expanded;
  syncDisclosureToggle(parts.toggle, {
    expanded,
    labels,
    collapsedClassName: CSS.blockDisclosureToggleCollapsed,
  });
}

function applyBlockDisclosureState(
  block: HTMLElement,
  parts: DisclosureParts,
  expanded: boolean,
): void {
  applyDisclosureState(block, BLOCK_OPEN_ATTR, parts, expanded, READER_BLOCK_DISCLOSURE_LABELS);
}

function setBlockDisclosureState(block: HTMLElement, expanded: boolean): void {
  const parts = blockDisclosureParts(block);
  if (!parts) return;
  applyBlockDisclosureState(block, parts, expanded);
}

function createBlockDisclosureToggle(): HTMLButtonElement {
  return createDisclosureToggleButton();
}

/**
 * Attach disclosure behavior to reader semantic blocks.
 *
 * `renderToHtml` emits a clean header — no toggle — so un-hydrated hosts get
 * no inert control and the heading's textContent stays free of the ▼ glyph
 * (#43). This pass creates and inserts the toggle on first hydration. It is
 * intentionally narrow: only the triangle toggles the block, so selecting or
 * clicking the header label itself never collapses content.
 */
function hydrateSemanticBlockDisclosures(root: HTMLElement): void {
  const blocks = [
    ...(root.classList.contains(CSS.blockCollapsible) ? [root] : []),
    ...Array.from(root.querySelectorAll<HTMLElement>(`.${CSS.blockCollapsible}`)),
  ];

  for (const block of blocks) {
    let parts = blockDisclosureParts(block);
    if (!parts) {
      // First hydration: create + insert the toggle (mirrors section disclosures).
      const heading = block.querySelector<HTMLElement>(`:scope > .${DOCUMENT_SURFACE_CLASS.blockHeading}`);
      const body = block.querySelector<HTMLElement>(`:scope > .${CSS.blockDisclosureBody}`);
      if (!heading || !body) continue;
      const toggle = createBlockDisclosureToggle();
      heading.insertBefore(toggle, heading.firstChild);
      parts = { body, toggle };
      toggle.addEventListener("click", () => {
        setBlockDisclosureState(block, block.getAttribute(BLOCK_OPEN_ATTR) === "false");
      });
      block.setAttribute(BLOCK_DISCLOSURE_HYDRATED_ATTR, "true");
    }
    const expanded = block.getAttribute(BLOCK_OPEN_ATTR) !== "false";
    applyBlockDisclosureState(block, parts, expanded);
  }
}

function applySectionDisclosureState(
  heading: HTMLElement,
  body: HTMLElement,
  toggle: HTMLButtonElement,
  expanded: boolean,
): void {
  applyDisclosureState(
    heading,
    SECTION_OPEN_ATTR,
    { body, toggle },
    expanded,
    READER_SECTION_DISCLOSURE_LABELS,
  );
}

function headingElementLevel(heading: HTMLElement): number {
  const tagMatch = /^H([1-6])$/.exec(heading.tagName);
  if (tagMatch) return Number(tagMatch[1]);
  for (let level = 1; level <= 6; level++) {
    if (heading.classList.contains(DOCUMENT_SURFACE_CLASS.headingLevel(level))) {
      return level;
    }
  }
  return 0;
}

function isSectionBoundaryNode(node: Node, level: number): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (!node.classList.contains(DOCUMENT_SURFACE_CLASS.heading)) return false;
  const boundaryLevel = headingElementLevel(node);
  return boundaryLevel > 0 && boundaryLevel <= level;
}

function createSectionDisclosureToggle(): HTMLButtonElement {
  return createDisclosureToggleButton(CSS.sectionDisclosureToggle);
}

function hydrateSectionDisclosures(root: HTMLElement): void {
  const headings = [
    ...(root.classList.contains(DOCUMENT_SURFACE_CLASS.heading) ? [root] : []),
    ...Array.from(root.querySelectorAll<HTMLElement>(`.${DOCUMENT_SURFACE_CLASS.heading}`)),
  ];

  for (let index = headings.length - 1; index >= 0; index--) {
    const heading = headings[index];
    const level = headingElementLevel(heading);
    if (level === 0) continue;
    // Guard on the per-heading structure this pass creates rather than a marker
    // on the host root: the root survives remounts (rich-readonly swaps only
    // its children), so a root marker would permanently skip disclosures for
    // every document mounted after the first. This is also idempotent.
    if (heading.classList.contains(CSS.sectionHeadingCollapsible)) continue;

    const body = document.createElement("div");
    body.className = CSS.sectionDisclosureBody;

    let sibling = heading.nextSibling;
    while (sibling && !isSectionBoundaryNode(sibling, level)) {
      const next = sibling.nextSibling;
      body.appendChild(sibling);
      sibling = next;
    }

    if (!body.firstChild) continue;

    const toggle = createSectionDisclosureToggle();
    heading.classList.add(CSS.sectionHeadingCollapsible);
    heading.insertBefore(toggle, heading.firstChild);
    heading.after(body);
    applySectionDisclosureState(heading, body, toggle, true);
    toggle.addEventListener("click", () => {
      applySectionDisclosureState(
        heading,
        body,
        toggle,
        heading.getAttribute(SECTION_OPEN_ATTR) === "false",
      );
    });
  }
}

/** Attach reader disclosure behavior for semantic blocks and sections. */
export function hydrateReaderDisclosures(root: HTMLElement): void {
  hydrateSemanticBlockDisclosures(root);
  hydrateSectionDisclosures(root);
}

/**
 * Backward-compatible alias for hosts that adopted block disclosures before
 * section disclosures were hydrated by the reader.
 */
export function hydrateBlockDisclosures(root: HTMLElement): void {
  hydrateReaderDisclosures(root);
}

export function hydrateMedia(root: HTMLElement): void {
  for (const wrapper of Array.from(root.querySelectorAll<HTMLElement>(`span.${CSS.imageWrapper}`))) {
    if (
      wrapper.classList.contains(CSS.imageLoading) ||
      wrapper.classList.contains(CSS.imagePlaceholder)
    ) {
      continue;
    }
    const img = wrapper.querySelector<HTMLImageElement>(`img.${CSS.image}`);
    if (!img) continue;
    syncInlineImageSizeOnLoad(wrapper, img);
  }
}

// ---------------------------------------------------------------------------
// Reference hydration.
// ---------------------------------------------------------------------------

export interface HydrateReferencesOptions {
  readonly documentPath?: string;
  readonly source?: string;
  readonly surface?: string;
}

function hydrateReferenceElement(
  el: HTMLElement,
  ctx: DocumentContext,
  opts: HydrateReferencesOptions,
): void {
  const key = el.dataset.refKey;
  if (!key || !ctx.refResolver?.resolve) return;
  const mode = el.dataset.refMode === "narrative" ? "narrative" : "bracketed";
  const sourceRange = sourceRangeFromElement(el, { closest: true }) ?? undefined;
  const raw = sourceRange && opts.source
    ? opts.source.slice(sourceRange.from, sourceRange.to)
    : el.textContent ?? "";
  const resolved = ctx.refResolver.resolve(key, mode, {
    raw,
    sourceRange,
    locator: undefined,
    cluster: {
      ids: [key],
      locators: [undefined],
      index: 0,
      raw,
    },
    documentPath: opts.documentPath,
    surface: opts.surface ?? "reader",
  });
  if (!resolved) return;

  el.classList.remove(CSS.citationUnresolvedMarker, CSS.crossrefUnresolvedMarker);
  el.classList.add(...hostReferenceClassNames(resolved.className).split(/\s+/));
  if (resolved.href && isSafeUrl(resolved.href)) {
    el.innerHTML = sanitize(renderLinkSurfaceHtml(resolved.href, resolved.content));
  } else {
    el.innerHTML = sanitize(resolved.content);
  }
  if (typeof resolved.onClick === "function") {
    el.dataset.refResolver = "1";
    el.addEventListener("click", resolved.onClick);
  }
}

// Tracks the click handler attached to each hydrated anchor so a re-hydration
// pass can detach the previous one instead of stacking (or stranding a stale
// handler when the resolution changes). WeakMap-keyed, so entries drop with the
// element — no manual cleanup, no leak.
const linkClickHandlers = new WeakMap<HTMLElement, (e: MouseEvent) => void>();

function hydrateLinkElement(
  el: HTMLAnchorElement,
  ctx: DocumentContext,
  opts: HydrateReferencesOptions,
): void {
  const href = el.getAttribute("href");
  if (!href || !ctx.linkResolver?.resolve) return;
  const sourceRange = sourceRangeFromElement(el, { closest: true }) ?? undefined;
  const resolved = ctx.linkResolver.resolve(href, el.textContent ?? "", {
    from: opts.documentPath,
    raw: sourceRange && opts.source
      ? opts.source.slice(sourceRange.from, sourceRange.to)
      : undefined,
    sourceRange,
    documentPath: opts.documentPath,
    surface: opts.surface ?? "reader",
  });
  if (!resolved) return;
  if (resolved.href !== undefined && isSafeUrl(resolved.href)) {
    applyLinkSurface(el, resolved.href, {
      className: resolved.className,
      title: resolved.title,
    });
  } else if (resolved.className) {
    el.classList.add(...resolved.className.split(/\s+/).filter(Boolean));
  }
  if (resolved.href === undefined && resolved.title !== undefined) {
    el.title = resolved.title;
  }
  // hydrateReferences is re-runnable: hosts call it again when async resolver
  // data arrives, and the resolution (href/onClick) can change between passes.
  // Always detach any handler from a prior pass first — including when the live
  // resolution has no onClick — so clicks match the current resolution and
  // listeners never stack or leak a stale handler.
  const previous = linkClickHandlers.get(el);
  if (previous) el.removeEventListener("click", previous);
  if (typeof resolved.onClick === "function") {
    el.addEventListener("click", resolved.onClick);
    linkClickHandlers.set(el, resolved.onClick);
  } else {
    linkClickHandlers.delete(el);
  }
}

function hydrateBibliographyBacklinks(root: HTMLElement, ctx: DocumentContext): void {
  if (!ctx.citationKeys) return;
  const backlinks = new Map<string, Array<{ occurrence: number; sourceFrom: number }>>();
  let occurrence = 0;

  for (const el of Array.from(root.querySelectorAll<HTMLElement>(
    `.${CSS.citation}[data-ref-key], .${CSS.citation} [data-ref-id]`,
  ))) {
    const rawKey = el.dataset.refId ?? el.dataset.refKey;
    if (!rawKey) continue;
    const ids = rawKey.split(";").map((id) => id.trim()).filter((id) =>
      coreIsCitationKey(ctx.citationKeys, id)
    );
    if (ids.length === 0) continue;

    occurrence += 1;
    const sourceFrom = sourceRangeFromElement(el, { closest: true })?.from ?? -1;
    for (const id of ids) {
      const bucket = backlinks.get(id);
      const entry = { occurrence, sourceFrom };
      if (bucket) bucket.push(entry);
      else backlinks.set(id, [entry]);
    }
  }

  if (backlinks.size === 0) return;
  for (const [id, refs] of backlinks) {
    const entryId = bibliographyEntryId(id);
    const escapedEntryId = globalThis.CSS?.escape
      ? globalThis.CSS.escape(entryId)
      : entryId.replace(/["\\]/g, "\\$&");
    const entry = root.querySelector<HTMLElement>(
      `#${escapedEntryId}`,
    );
    if (!entry || entry.querySelector(`.${CSS.bibliographyBacklinks}`)) continue;
    appendBibliographyBacklinks(entry, refs);
  }
}

/**
 * Hydrate unresolved reader references and links after static HTML insertion.
 *
 * This is the supported DOM pass for hosts that render first and attach
 * resolver-backed links/references later. It preserves Coflat's source and
 * data attributes by mutating the emitted elements in place.
 */
export function hydrateReferences(
  root: HTMLElement,
  ctx: DocumentContext,
  opts: HydrateReferencesOptions = {},
): void {
  for (const el of Array.from(
    root.querySelectorAll<HTMLElement>(
      `.${CSS.citationUnresolvedMarker}[data-ref-key], .${CSS.crossrefUnresolvedMarker}[data-ref-key]`,
    ),
  )) {
    hydrateReferenceElement(el, ctx, opts);
  }

  for (const el of Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    hydrateLinkElement(el, ctx, opts);
  }

  hydrateBibliographyBacklinks(root, ctx);
}

export interface ReaderHoverPreviewEnv {
  readonly anchor: HTMLElement;
  readonly context?: DocumentContext;
  readonly key: string;
  readonly root: HTMLElement;
  readonly source?: string;
}

export interface ReaderHoverPreviewOptions {
  readonly context?: DocumentContext;
  readonly hoverDelayMs?: number;
  readonly mathMacros?: Record<string, string>;
  readonly previewForReference?: (
    key: string,
    env: ReaderHoverPreviewEnv,
  ) => HTMLElement | string | null | undefined;
  readonly referencePreviewIndex?: ReaderReferencePreviewIndex;
  readonly source?: string;
}

type HoverTooltipModule = typeof import("../core/hover-tooltip");

const readerHoverCacheScope = {};

function createReaderHoverHeader(text: string): HTMLElement {
  return createHoverPreviewHeaderElement(text);
}

function createReaderHoverBody(): HTMLElement {
  return createHoverPreviewBodyElement();
}

// Native hover preview for a paper citation: the formatted bibliography entry,
// from the same formatter that produced the inline label. Returns null for
// non-citation keys so crossref/equation/block hovers fall through. The entry
// HTML is host-influenced (a .bib file) so it is sanitized before insertion.
function buildReaderCitationPreview(
  key: string,
  context: DocumentContext | undefined,
): HTMLElement | null {
  if (!context?.citationFormatter || !coreIsCitationKey(context.citationKeys, key)) return null;
  const entry = coreBibliographyEntryFor(context.citationFormatter, key);
  if (!entry) return null;
  const body = createHoverPreviewCitationBodyElement();
  body.innerHTML = sanitize(entry.html);
  return createHoverPreviewElementWithChild(body);
}

export function createReaderCitationClusterPreviewBody(
  key: string,
  context: DocumentContext | undefined,
): HTMLElement | null {
  if (!context?.citationFormatter || !context.citationKeys) return null;
  const ids = key.split(";").map((id) => id.trim()).filter(Boolean);
  if (ids.length < 2) return null;
  const citationIds = ids.filter((id) => coreIsCitationKey(context.citationKeys, id));
  if (citationIds.length === 0) return null;
  const entriesById = new Map(
    coreBibliographyEntries(context.citationFormatter, citationIds).map((entry) => [entry.id, entry.html]),
  );
  const container = document.createElement("div");
  container.className = "cf-hover-preview-citation-body";
  for (const id of citationIds) {
    const html = entriesById.get(id);
    if (!html) continue;
    const body = createHoverPreviewCitationBodyElement();
    body.innerHTML = sanitize(html);
    container.appendChild(body);
  }
  return container.childNodes.length > 0 ? container : null;
}

function renderReaderPreviewSource(
  source: string,
  context: DocumentContext | undefined,
  mathMacros: Record<string, string> | undefined,
  options: RenderOptions = {},
): HTMLElement {
  const body = createReaderHoverBody();
  body.innerHTML = renderToHtml(source, context, {
    interactiveBlockDisclosures: false,
    ...options,
  }).html;
  void hydrateMath(body, { mathMacros: mathMacros ?? context?.mathMacros });
  return body;
}

function renderReaderPreviewBody(
  plan: ReferencePreviewContentPlan,
  context: DocumentContext | undefined,
  mathMacros: Record<string, string> | undefined,
): HTMLElement | null {
  if (plan.bodyPlan.kind !== "display-math" && plan.bodyPlan.kind !== "markdown") {
    return null;
  }
  return renderReaderPreviewSource(
    plan.bodyPlan.markdownSource,
    context,
    mathMacros,
    plan.suppressGeneratedSectionNumbers ? { sectionNumbering: false } : {},
  );
}

function buildReaderIndexedPreview(
  entry: ReaderReferencePreviewEntry | undefined,
  source: string | undefined,
  context: DocumentContext | undefined,
  mathMacros: Record<string, string> | undefined,
  fallbackLabel: string,
): HTMLElement | null {
  if (!entry) return null;
  const plan = referencePreviewContentPlanFromEntry(entry, source, fallbackLabel);
  const body = renderReaderPreviewBody(plan, context, mathMacros);
  const surfacePlan = referencePreviewSurfacePlan(plan, {
    variant: "hover",
    hasBody: !!body,
  });
  const container = createHoverPreviewElementWithChild(createReaderHoverHeader(surfacePlan.headerText));
  if (body) {
    container.appendChild(body);
  }
  return container;
}

function buildReaderSourcePreview(
  key: string,
  source: string | undefined,
  context: DocumentContext | undefined,
  mathMacros: Record<string, string> | undefined,
  label: string,
): HTMLElement | null {
  if (!source) return null;
  const plan = referencePreviewContentPlanFromSource(source, key, label);
  if (!plan) return null;

  const body = renderReaderPreviewBody(plan, context, mathMacros);
  const surfacePlan = referencePreviewSurfacePlan(plan, {
    variant: "hover",
    hasBody: !!body,
  });
  const container = createHoverPreviewElementWithChild(createReaderHoverHeader(surfacePlan.headerText));
  if (body) {
    container.appendChild(body);
  }
  return container;
}

function buildReaderHoverPlan(
  anchor: HTMLElement,
  root: HTMLElement,
  options: ReaderHoverPreviewOptions,
): TooltipPlan {
  const key = anchor.dataset.refKey ?? "";
  const label = anchor.textContent?.trim() ?? key;
  const indexedEntry = options.referencePreviewIndex?.[key];
  const indexedKey = indexedEntry ? JSON.stringify(indexedEntry) : "";
  return {
    buildContent: () => {
      const citationPreview = buildReaderCitationPreview(key, options.context);
      if (citationPreview) return citationPreview;

      const customPreview = options.previewForReference?.(key, {
        anchor,
        context: options.context,
        key,
        root,
        source: options.source,
      });
      if (customPreview instanceof HTMLElement) {
        return createHoverPreviewElementWithChild(customPreview);
      }
      if (typeof customPreview === "string" && customPreview.trim() !== "") {
        return createHoverPreviewTextElement(customPreview);
      }

      const indexedPreview = buildReaderIndexedPreview(
        indexedEntry,
        options.source,
        options.context,
        options.mathMacros,
        label || key,
      );
      if (indexedPreview) return indexedPreview;

      return buildReaderSourcePreview(
        key,
        options.source,
        options.context,
        options.mathMacros,
        label,
      ) ?? createUnresolvedHoverPreviewElement(key);
    },
    cacheScope: readerHoverCacheScope,
    dependsOnBibliography: false,
    dependsOnMacros: true,
    key: `reader:hover\0${key}\0${label}\0${indexedKey}\0${options.source ?? ""}`,
    mediaDependencies: undefined,
  };
}

/**
 * Attach reader hover previews to rendered references in a reader surface.
 *
 * The helper reuses the same tooltip shell, positioning, cache behavior, and
 * CSS classes as the editor hover cards. It stays opt-in so `renderToHtml`
 * remains static and server-render friendly.
 */
export function hydrateReaderHoverPreviews(
  root: HTMLElement,
  options: ReaderHoverPreviewOptions = {},
): () => void {
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let currentTarget: HTMLElement | null = null;
  let tooltipModulePromise: Promise<HoverTooltipModule> | null = null;

  const loadTooltipModule = () => {
    tooltipModulePromise ??= import("../core/hover-tooltip");
    return tooltipModulePromise;
  };

  const clearTimer = () => {
    if (hoverTimer !== null) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  };

  const hideTooltip = () => {
    if (!tooltipModulePromise) return;
    void tooltipModulePromise.then((module) => module.hideFloatingTooltip());
  };

  const onMouseOver = (event: MouseEvent) => {
    const target = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>("[data-ref-key]")
      : null;
    if (!target || target === currentTarget) return;

    clearTimer();
    currentTarget = target;

    hoverTimer = setTimeout(() => {
      const anchor = currentTarget;
      if (!anchor?.isConnected) return;
      const plan = buildReaderHoverPlan(anchor, root, options);
      void loadTooltipModule().then((module) => {
        if (anchor === currentTarget) {
          module.showFloatingTooltip(anchor, plan);
        }
      });
    }, options.hoverDelayMs ?? 300);
  };

  const onMouseOut = (event: MouseEvent) => {
    const relatedTarget = event.relatedTarget;
    if (
      relatedTarget instanceof HTMLElement &&
      relatedTarget.closest("[data-ref-key]") === currentTarget
    ) {
      return;
    }
    clearTimer();
    currentTarget = null;
    hideTooltip();
  };

  root.addEventListener("mouseover", onMouseOver);
  root.addEventListener("mouseout", onMouseOut);

  return () => {
    clearTimer();
    currentTarget = null;
    root.removeEventListener("mouseover", onMouseOver);
    root.removeEventListener("mouseout", onMouseOut);
    hideTooltip();
  };
}

// ---------------------------------------------------------------------------
// KaTeX lazy hydration.
// ---------------------------------------------------------------------------

/**
 * Options for {@link hydrateMath}.
 */
export interface HydrateMathOptions {
  /**
   * KaTeX macro definitions, e.g. `{ "\\R": "\\mathbb{R}" }`.
   *
   * `hydrateMath` does not read the document; pass macros explicitly. The
   * document's own frontmatter `math:` preamble is already resolved by
   * {@link renderToHtml} and returned as `result.mathMacros` — forward that
   * value here so reader math (title + body) matches the editor. Supply
   * additional/override macros by merging them in before the call.
   */
  mathMacros?: Record<string, string>;
}

interface KatexRenderer {
  renderToString: typeof import("katex").renderToString;
}

function hydrateMathElement(
  el: HTMLElement,
  katex: KatexRenderer,
  macros: Record<string, string> | undefined,
): void {
  if (el.getAttribute("data-math-hydrated") === "true") return;
  const latex = el.getAttribute("data-math");
  if (latex === null) return;

  const isDisplay = el.classList.contains(DOCUMENT_SURFACE_CLASS.displayMath);
  const html = katex.renderToString(latex, {
    ...buildKatexOptions(isDisplay, macros),
    output: isDisplay ? "htmlAndMathml" : "html",
  });
  if (html.includes("katex-error")) {
    el.classList.add(CSS.mathError);
    el.setAttribute("data-math-error", "KaTeX error");
  }

  if (isDisplay) {
    const content = document.createElement("div");
    content.innerHTML = html;
    const equationNumber = el.dataset.equationNumber;
    replaceDisplayMathContent(el, content, equationNumber);
  } else {
    el.innerHTML = html;
  }
  el.setAttribute("data-math-hydrated", "true");
}

/**
 * Lazily hydrate `[data-math]` placeholders inside `root` with KaTeX-rendered
 * HTML.
 *
 * Behaviour:
 * - Walks `root` for descendants with a `data-math` attribute. If none are
 *   found, resolves immediately without importing KaTeX.
 * - Otherwise dynamically `import("katex")` once (the browser's module cache
 *   keeps subsequent calls cheap) and replaces each placeholder's contents
 *   with KaTeX HTML. `displayMode: true` is used for elements bearing the
 *   `cf-doc-display-math` class, `false` otherwise.
 * - On render error, the placeholder is left as-is (the raw `$…$` source
 *   inside the `<span>` remains visible as a fallback) and gets a
 *   `cf-math-error` class plus a `data-math-error` attribute carrying the
 *   error message. A single bad equation does not abort the pass.
 * - Sets `data-math-hydrated="true"` on each successfully rendered
 *   placeholder so subsequent calls skip already-hydrated nodes (idempotent).
 *
 * Browser-only: KaTeX needs a real DOM. The static module graph of
 * `./reader` stays free of `katex`; this helper performs the dynamic import.
 *
 * The host is responsible for loading `katex/dist/katex.min.css` separately;
 * this helper does NOT import the stylesheet.
 *
 * @param root Element whose `[data-math]` descendants should be hydrated.
 * @param opts Optional macros to forward to KaTeX.
 */
export async function hydrateMath(
  root: HTMLElement,
  opts?: HydrateMathOptions,
): Promise<void> {
  const placeholders = root.querySelectorAll<HTMLElement>(
    "[data-math]:not([data-math-hydrated])",
  );
  if (placeholders.length === 0) return;

  const katexModule = await import("katex");
  const katex = katexModule.default ?? katexModule;
  const macros = opts?.mathMacros;
  const orderedPlaceholders = orderElementsVisibleFirst(Array.from(placeholders));
  const chunkBudgetMs = 8;

  let chunkStartedAt = performance.now();
  for (let index = 0; index < orderedPlaceholders.length; index += 1) {
    hydrateMathElement(orderedPlaceholders[index], katex, macros);
    if (
      index < orderedPlaceholders.length - 1 &&
      orderedPlaceholders.length > 32 &&
      performance.now() - chunkStartedAt >= chunkBudgetMs
    ) {
      await scheduleHydrationYield();
      chunkStartedAt = performance.now();
    }
  }
}
