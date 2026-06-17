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

import { parseFrontmatter, parseMarkdownSource } from "../core/parser";
import {
  renderBlockCaptionHtml,
} from "../core/block-caption-surface";
import {
  renderBlockDisclosureHtml,
  renderBlockLabelHtml,
  renderInlineBlockHeadingContainerHtml,
  renderBlockSummaryHtml as renderBlockSummarySurfaceHtml,
} from "../core/block-heading-surface";
import {
  blankLineRangesBetweenBlocks,
  trailingBlankLineRangesAfterLastBlock,
} from "../core/parser/blank-lines";
import { NODE } from "../core/constants/node-types";
import { isSafeUrl } from "../core/lib/url-utils";
import { escapeHtml } from "../core/lib/html-escape";
import { buildLineOffsets, lineAt } from "../core/lib/line-offsets";
import {
  BRACKETED_REFERENCE_EXACT_RE,
  parseReferenceClusterBody,
} from "../core/lib/reference-grammar";
import {
  getBlockManifestEntry,
  isCollapsibleBlockType,
} from "../core/constants/block-manifest";
import {
  CSS,
  hostReferenceClassNames,
  mathSurfaceClassNames,
} from "../core/constants/css-classes";
import {
  createDisclosureToggleButton,
  READER_BLOCK_DISCLOSURE_LABELS,
  READER_SECTION_DISCLOSURE_LABELS,
  syncDisclosureToggle,
  type DisclosureToggleLabels,
} from "../core/disclosure-toggle";
import { applyLinkSurface, renderLinkSurfaceHtml } from "../core/link-surface";
import { readBracedLabelId } from "../core/parser/label-utils";
import type { NumberingScheme } from "../core/parser/frontmatter";
import {
  blockTitleOverridesFromConfig,
  counterGroupForBlockNumberingSpec,
  createConfiguredBlockNumberingSpecLookup,
  displayTitleForBlockType,
  type BlockNumberingSpecLookup,
} from "../core/semantics/block-numbering";
import { blockPresentationPlan } from "../core/block-presentation";
import {
  bibliographyEntries as coreBibliographyEntries,
  bibliographyEntryFor as coreBibliographyEntryFor,
  citeInline as coreCiteInline,
  isCitationKey as coreIsCitationKey,
} from "../core/references/citation-rendering";
import { renderBibliographySectionHtml } from "../core/bibliography-surface";
import {
  formatBlockReferenceLabel,
  formatEquationReferenceLabel,
  formatHeadingReferenceLabel,
} from "../core/references/format";
import {
  DOCUMENT_SURFACE_CLASS,
} from "../core/document-surface-classes";
import { renderInlineMarkHtml } from "../core/inline-mark-surface";
import {
  blockSurfaceClassNames,
  renderBlankLineHtml,
  renderBlockquoteHtml,
  renderHorizontalRuleHtml,
} from "../core/block-surface";
import {
  headingNumberingHtmlAttrs,
  headingSurfaceClassNames,
} from "../core/heading-surface";
import {
  renderReadOnlyTaskCheckboxHtml,
  renderListItemSurfaceHtml,
  renderListSurfaceHtml,
  taskMarkerChecked,
} from "../core/list-surface";
import { renderCodeBlockHtml } from "../core/code-block-surface";
import { renderReaderFootnoteReferenceHtml } from "../core/footnote-reference-surface";
import { renderFootnoteSectionHtml } from "../core/footnote-section-surface";
import {
  replaceDisplayMathContent,
  renderDisplayMathPlaceholderHtml,
} from "../core/math-display-surface";
import {
  renderImageSurfaceHtml,
  renderMediaLoadingHtml,
} from "../core/media-surface";
import { renderParagraphHtml } from "../core/paragraph-surface";
import {
  renderTableCellHtml,
  renderTableRowHtml,
  renderTableSurfaceHtml,
} from "../core/table-surface";
import {
  createHoverPreviewBodyElement,
  createHoverPreviewCitationBodyElement,
  createHoverPreviewContentElement,
  createHoverPreviewHeaderElement,
} from "../core/hover-preview-surface";
import { extractDivClass } from "../core/parser/fenced-div-attrs";
import {
  isLooseListNode,
  orderedListStartNumber,
} from "../core/parser/list-shape";
import { parseTableDelimiterAlignments } from "../core/parser/table";
import type {
  CitationFormatter,
  DocumentContext,
  HostReferenceResolution,
  LinkResolver,
  RefResolverEnv,
  RefResolver,
} from "../core/document-context-types";
export {
  COFLAT_READER_CLASS,
  COFLAT_READER_DOCUMENT_CLASS,
  COFLAT_READER_SHELL_CLASS,
  COFLAT_READER_TOC_CLASS,
  COFLAT_THEME_SCOPE_CLASS,
  blueprintBookThemeManifest,
} from "../core/theme-manifest";
export type { CoflatThemeManifest, CoflatThemeTarget } from "../core/theme-manifest";
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
// We use `htmlRenderExtensions` rather than `markdownExtensions` because
// the reader wants `>` blockquotes to parse as `<blockquote>`; the editor
// uses fenced divs for blockquotes and strips standard syntax, but a
// preview/diff host renders authored content as written.
// ---------------------------------------------------------------------------

function parseSource(source: string): Tree {
  noteLezerInvocation();
  return parseMarkdownSource(source, "html-render");
}

// ---------------------------------------------------------------------------
// Fast path sieve.
// ---------------------------------------------------------------------------

/**
 * If none of these characters appear, the source contains only plain
 * inline markdown (`*`, `_`, `~`, `\`-escape). No links, no code, no
 * math, no block constructs — a tiny inline-only renderer suffices.
 */
const FAST_PATH_RE = /[$[:`#^<>\n|-]|^---\n/m;

// ---------------------------------------------------------------------------
// HTML / text escaping.
// ---------------------------------------------------------------------------

const paragraphClasses = DOCUMENT_SURFACE_CLASS.paragraph;

function blockClasses(type: string | undefined): string {
  return blockSurfaceClassNames(type);
}

function blockDisplayTitle(ctx: WalkContext, type: string): string {
  return displayTitleForBlockType(type, ctx.blockTitles);
}

function nextBlockNumber(ctx: WalkContext, type: string): number | undefined {
  const spec = ctx.blockNumberingSpec(type);
  if (!spec?.numbered) return undefined;
  const counterGroup = counterGroupForBlockNumberingSpec(spec, ctx.blockNumbering);
  const next = (ctx.blockCounters.get(counterGroup) ?? 0) + 1;
  ctx.blockCounters.set(counterGroup, next);
  return next;
}

function nextHeadingNumber(ctx: WalkContext, level: number, unnumbered: boolean): string {
  if (unnumbered) return "";
  ctx.headingCounters[level]++;
  for (let nextLevel = level + 1; nextLevel <= 6; nextLevel++) {
    ctx.headingCounters[nextLevel] = 0;
  }
  return ctx.headingCounters.slice(1, level + 1).join(".");
}

function renderInlineSnippet(ctx: WalkContext, source: string): BlockResult {
  const tree = parseSource(source);
  const snippetCtx: WalkContext = {
    ...ctx,
    source,
    lineOffsets: null,
    sourcePositions: false,
    mathSourcePositions: false,
    interactiveBlockDisclosures: ctx.interactiveBlockDisclosures,
    collectOutline: false,
    outline: [],
    usedHeadingIds: new Set(),
    headingCounters: [...ctx.headingCounters],
    blockCounters: new Map(ctx.blockCounters),
    blockNumbering: ctx.blockNumbering,
    blockNumberingSpec: ctx.blockNumberingSpec,
    blockTitles: ctx.blockTitles,
    footnotesById: new Map(),
    footnotesInOrder: [],
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

function renderBlockSummary(ctx: WalkContext, type: string, title: string | undefined, number: number | undefined): BlockResult {
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
  const renderedTitle = renderInlineSnippet(ctx, plan.title ?? "");
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
  number: number | undefined,
  sourceFrom: number,
  sourceTo: number,
): BlockResult {
  const renderedTitle = renderInlineSnippet(ctx, title);
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
// Handles only **bold**, __bold__, *italic*, _italic_, ~~strike~~, and
// `\`-escapes. No links, no code (the sieve excluded `[`, `` ` ``, `<`).
// Returns sanitized-safe HTML *fragment* (no outer tags) plus an optional
// linear `sourceToText` map for the corresponding `renderToText` call.
// ---------------------------------------------------------------------------

interface FastInlineResult {
  html: string;
  text: string;
  sourceToText: Uint32Array;
}

function fastRenderInline(source: string): FastInlineResult {
  type Part =
    | { kind: "text"; html: string; text: string; sourceFrom: number; sourceTo: number }
    | { kind: "tag"; html: string; sourceFrom: number; sourceTo: number };

  type Span = {
    delim: "**" | "__" | "*" | "_" | "~~";
    placeholderIdx: number;
    openFrom: number;
    openTo: number;
  };

  const parts: Part[] = [];
  const stack: Span[] = [];

  function pushTextPart(text: string, from: number, to: number): void {
    parts.push({
      kind: "text",
      html: escapeHtml(text),
      text,
      sourceFrom: from,
      sourceTo: to,
    });
  }

  function tagsFor(delim: Span["delim"]): { open: string; close: string } {
    if (delim === "**" || delim === "__") return { open: "<strong>", close: "</strong>" };
    if (delim === "*" || delim === "_") return { open: "<em>", close: "</em>" };
    return { open: "<del>", close: "</del>" };
  }

  function matchOpenSpan(delim: Span["delim"]): number {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].delim === delim) return i;
    }
    return -1;
  }

  function closeSpan(delim: Span["delim"], from: number, to: number): void {
    const idx = matchOpenSpan(delim);
    if (idx < 0) {
      pushTextPart(source.slice(from, to), from, to);
      return;
    }
    const span = stack[idx];
    stack.length = idx;

    const tags = tagsFor(delim);
    parts[span.placeholderIdx] = {
      kind: "tag",
      html: tags.open,
      sourceFrom: span.openFrom,
      sourceTo: span.openTo,
    };
    parts.push({
      kind: "tag",
      html: tags.close,
      sourceFrom: from,
      sourceTo: to,
    });
  }

  function tryOpenSpan(delim: Span["delim"], from: number, to: number): void {
    const placeholderIdx = parts.length;
    pushTextPart(source.slice(from, to), from, to);
    stack.push({ delim, placeholderIdx, openFrom: from, openTo: to });
  }

  let i = 0;
  while (i < source.length) {
    const c = source[i];

    if (c === "\\" && i + 1 < source.length) {
      const next = source[i + 1];
      pushTextPart(next, i, i + 2);
      i += 2;
      continue;
    }

    if ((c === "*" || c === "_") && source[i + 1] === c) {
      const delim = (c + c) as "**" | "__";
      const openIdx = matchOpenSpan(delim);
      if (openIdx >= 0) closeSpan(delim, i, i + 2);
      else tryOpenSpan(delim, i, i + 2);
      i += 2;
      continue;
    }

    if (c === "~" && source[i + 1] === "~") {
      const openIdx = matchOpenSpan("~~");
      if (openIdx >= 0) closeSpan("~~", i, i + 2);
      else tryOpenSpan("~~", i, i + 2);
      i += 2;
      continue;
    }

    if (c === "*" || c === "_") {
      const delim = c as "*" | "_";
      const openIdx = matchOpenSpan(delim);
      if (openIdx >= 0) closeSpan(delim, i, i + 1);
      else tryOpenSpan(delim, i, i + 1);
      i += 1;
      continue;
    }

    pushTextPart(c, i, i + 1);
    i += 1;
  }

  const htmlOut: string[] = [];
  const textOut: string[] = [];
  const s2t = new Uint32Array(source.length + 1);
  let textPos = 0;
  for (const part of parts) {
    if (part.kind === "text") {
      const srcLen = part.sourceTo - part.sourceFrom;
      const txtLen = part.text.length;
      for (let k = 0; k < srcLen; k++) {
        const t = txtLen === 0 ? textPos : textPos + Math.min(k, txtLen - 1);
        s2t[part.sourceFrom + k] = t;
      }
      htmlOut.push(part.html);
      textOut.push(part.text);
      textPos += part.text.length;
    } else {
      for (let k = part.sourceFrom; k < part.sourceTo; k++) {
        s2t[k] = textPos;
      }
      htmlOut.push(part.html);
    }
  }
  s2t[source.length] = textPos;

  return {
    html: htmlOut.join(""),
    text: textOut.join(""),
    sourceToText: s2t,
  };
}

// ---------------------------------------------------------------------------
// Walker types.
// ---------------------------------------------------------------------------

// One in-document reference target (heading/equation/block with an explicit
// id), with its rendered crossref label, built by the reader's own numbering.
interface ReaderReferenceTarget {
  readonly kind: "heading" | "equation" | "block";
  readonly label: string;
}
type ReaderReferenceCatalog = ReadonlyMap<string, ReaderReferenceTarget>;

export type ReaderReferencePreviewEntry =
  | {
      readonly kind: "heading";
      readonly id: string;
      readonly label: string;
      readonly title: string;
      readonly text: string;
      readonly level: number;
      readonly from: number;
      readonly to: number;
      readonly number?: string;
    }
  | {
      readonly kind: "equation";
      readonly id: string;
      readonly label: string;
      readonly latex: string;
      readonly text: string;
      readonly from: number;
      readonly to: number;
      readonly bodyFrom: number;
      readonly bodyTo: number;
      readonly number: string;
      readonly ordinal: number;
    }
  | {
      readonly kind: "block";
      readonly id: string;
      readonly label: string;
      readonly blockType: string;
      readonly title?: string;
      readonly from: number;
      readonly to: number;
      readonly bodyFrom: number;
      readonly bodyTo: number;
      readonly number?: string;
      readonly ordinal?: number;
    };

export type ReaderReferencePreviewIndex = Readonly<Record<string, ReaderReferencePreviewEntry>>;

type ReaderReferencePreviewCatalog = Map<string, ReaderReferencePreviewEntry>;

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

interface FootnoteEntry {
  /** Source id (the part between `[^` and `]`). */
  id: string;
  /** 1-based footnote number assigned in order of first reference. */
  number: number;
  /** Pre-rendered inner HTML of the definition body (from FootnoteDef). */
  bodyHtml: string;
  /** True once at least one ref to this id has been emitted. */
  hasRef: boolean;
}

interface WalkContext {
  source: string;
  resolvers: Resolvers;
  lineOffsets: Uint32Array | null;
  /** When true, emit `data-source-from`/`data-source-to` byte offsets on
   *  every block element, inline mark, math placeholder, and plain-text
   *  span (the latter wrapped in `<span class="cf-text">`). */
  sourcePositions: boolean;
  /** When true, emit source offsets on math placeholders only. */
  mathSourcePositions: boolean;
  /** When false, render semantic block headers without interactive disclosure controls. */
  interactiveBlockDisclosures: boolean;
  /** When true, emit ids on all headings and accumulate {@link outline}. */
  collectOutline: boolean;
  /** Headings in document order; populated only when {@link collectOutline}. */
  outline: ReaderOutlineEntry[];
  /** Heading ids already emitted, for slug de-duplication. */
  usedHeadingIds: Set<string>;
  headingCounters: number[];
  blockCounters: Map<string, number>;
  blockNumbering: NumberingScheme;
  blockNumberingSpec: BlockNumberingSpecLookup;
  blockTitles: ReadonlyMap<string, string>;
  equationCounter: number;
  // Footnote tracking
  footnotesById: Map<string, FootnoteEntry>;
  footnotesInOrder: FootnoteEntry[];
  /** Bibliography keys cited (bracketed `[@key]` resolved as a citation), in
   *  first-appearance order; drives IEEE numbering + the References list. Only
   *  populated when the host supplies `citationKeys` + `citationFormatter`. */
  citedKeys: string[];
  /** In-document crossref targets (id → label) recorded as the walk numbers
   *  each heading/equation/block, so a second walk can resolve `[@id]` to the
   *  same number the target carries. Built only when `buildCatalog`. */
  catalog: Map<string, ReaderReferenceTarget>;
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
}

function sourcePosAttrs(ctx: WalkContext, from: number, to: number): string {
  if (!ctx.sourcePositions) return "";
  return ` data-source-from="${from}" data-source-to="${to}"`;
}

function mathSourcePosAttrs(ctx: WalkContext, from: number, to: number): string {
  if (!ctx.mathSourcePositions) return "";
  return ` data-source-from="${from}" data-source-to="${to}"`;
}

// ---------------------------------------------------------------------------
// Inline rendering (text-only output side-channel optional).
// ---------------------------------------------------------------------------

/** Render the inline content inside a node range [from, to). Returns HTML + plain text. */
function renderInline(
  ctx: WalkContext,
  parent: SyntaxNode,
  from: number,
  to: number,
): { html: string; text: string; hasMath: boolean } {
  let html = "";
  let text = "";
  let hasMath = false;

  function emitText(slice: string, sliceFrom: number, sliceTo: number): void {
    if (slice.length === 0) return;
    if (ctx.sourcePositions) {
      html += `<span class="${CSS.text}" data-source-from="${sliceFrom}" data-source-to="${sliceTo}">${escapeHtml(slice)}</span>`;
    } else {
      html += escapeHtml(slice);
    }
    text += slice;
  }

  // Walk children of `parent` whose ranges intersect [from, to).
  // For Paragraph nodes the first child may start at `from` exactly;
  // for headings, after the HeaderMark.
  let cursor = from;
  let child = parent.firstChild;
  while (child) {
    if (child.to <= from) {
      child = child.nextSibling;
      continue;
    }
    if (child.from >= to) break;

    const cFrom = Math.max(child.from, from);
    const cTo = Math.min(child.to, to);

    if (cFrom > cursor) {
      emitText(ctx.source.slice(cursor, cFrom), cursor, cFrom);
    }

    const r = renderInlineNode(ctx, child);
    html += r.html;
    text += r.text;
    if (r.hasMath) hasMath = true;

    cursor = cTo;
    child = child.nextSibling;
  }

  if (cursor < to) {
    emitText(ctx.source.slice(cursor, to), cursor, to);
  }

  return { html, text, hasMath };
}

function renderInlineNode(
  ctx: WalkContext,
  node: SyntaxNode,
): { html: string; text: string; hasMath: boolean } {
  const source = ctx.source;
  const name = node.name;

  // Structural markers we never emit (their text positions are skipped
  // because their from/to is enclosed by handled nodes).
  switch (name) {
    case "HeaderMark":
    case "QuoteMark":
    case "ListMark":
    case "TaskMarker":
    case "CodeMark":
    case "CodeInfo":
    case "EmphasisMark":
    case "StrikethroughMark":
    case "HighlightMark":
    case "LinkMark":
    case "URL":
    case "LinkTitle":
    case NODE.FencedDivFence:
    case NODE.FencedDivAttributes:
    case "TableDelimiter":
      return { html: "", text: "", hasMath: false };
  }

  switch (name) {
    case NODE.Emphasis: {
      const inner = renderInline(ctx, node, node.from, node.to);
      const sp = sourcePosAttrs(ctx, node.from, node.to);
      return {
        html: renderInlineMarkHtml("emphasis", inner.html, { sourceAttrs: sp }),
        text: inner.text,
        hasMath: inner.hasMath,
      };
    }
    case NODE.StrongEmphasis: {
      const inner = renderInline(ctx, node, node.from, node.to);
      const sp = sourcePosAttrs(ctx, node.from, node.to);
      return {
        html: renderInlineMarkHtml("strong", inner.html, { sourceAttrs: sp }),
        text: inner.text,
        hasMath: inner.hasMath,
      };
    }
    case NODE.Strikethrough: {
      const inner = renderInline(ctx, node, node.from, node.to);
      const sp = sourcePosAttrs(ctx, node.from, node.to);
      return {
        html: renderInlineMarkHtml("strikethrough", inner.html, { sourceAttrs: sp }),
        text: inner.text,
        hasMath: inner.hasMath,
      };
    }
    case NODE.Highlight: {
      const inner = renderInline(ctx, node, node.from, node.to);
      const sp = sourcePosAttrs(ctx, node.from, node.to);
      return {
        html: renderInlineMarkHtml("highlight", inner.html, { sourceAttrs: sp }),
        text: inner.text,
        hasMath: inner.hasMath,
      };
    }
    case NODE.InlineCode: {
      const raw = source.slice(node.from, node.to);
      const m = raw.match(/^`+/);
      const fenceLen = m ? m[0].length : 1;
      const inner = raw.slice(fenceLen, raw.length - fenceLen);
      const sp = sourcePosAttrs(ctx, node.from, node.to);
      return {
        html: renderInlineMarkHtml("code", escapeHtml(inner), { sourceAttrs: sp }),
        text: inner,
        hasMath: false,
      };
    }
    case NODE.Link:
      return emitLink(ctx, node);
    case NODE.Image:
      return emitImage(ctx, node);
    case "Autolink": {
      const raw = source.slice(node.from, node.to);
      const href = raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
      const sp = sourcePosAttrs(ctx, node.from, node.to);
      if (isSafeUrl(href)) {
        return {
          html: renderLinkSurfaceHtml(href, escapeHtml(href), { sourceAttrs: sp }),
          text: href,
          hasMath: false,
        };
      }
      if (ctx.sourcePositions) {
        return {
          html: `<span class="${CSS.text}"${sp}>${escapeHtml(href)}</span>`,
          text: href,
          hasMath: false,
        };
      }
      return { html: escapeHtml(href), text: href, hasMath: false };
    }
    case NODE.InlineMath: {
      const raw = source.slice(node.from, node.to);
      const inner = stripMathDelims(raw, false);
      const sp = mathSourcePosAttrs(ctx, node.from, node.to);
      return {
        html: `<span class="${mathSurfaceClassNames(false)}" data-math="${escapeHtml(inner)}"${sp}>${escapeHtml(raw)}</span>`,
        text: raw,
        hasMath: true,
      };
    }
    case NODE.DisplayMath: {
      const raw = source.slice(node.from, node.to);
      const inner = stripMathDelims(raw, true);
      const sp = mathSourcePosAttrs(ctx, node.from, node.to);
      return {
        html: `<span class="${mathSurfaceClassNames(true)}" data-math="${escapeHtml(inner)}"${sp}>${escapeHtml(raw)}</span>`,
        text: raw,
        hasMath: true,
      };
    }
    case NODE.FootnoteRef: {
      const raw = source.slice(node.from, node.to);
      // raw is `[^id]`; extract id.
      const idMatch = raw.match(/^\[\^([^\]]+)\]$/);
      if (!idMatch) {
        return { html: escapeHtml(raw), text: raw, hasMath: false };
      }
      const id = idMatch[1];
      let entry = ctx.footnotesById.get(id);
      if (!entry) {
        // Forward ref before definition seen — create placeholder, body
        // filled in when FootnoteDef is encountered.
        entry = {
          id,
          number: ctx.footnotesInOrder.length + 1,
          bodyHtml: "",
          hasRef: true,
        };
        ctx.footnotesById.set(id, entry);
        ctx.footnotesInOrder.push(entry);
      } else {
        entry.hasRef = true;
      }
      const sp = sourcePosAttrs(ctx, node.from, node.to);
      return {
        html: renderReaderFootnoteReferenceHtml(entry.number, id, sp),
        text: `[${entry.number}]`,
        hasMath: false,
      };
    }
    case NODE.Escape: {
      const raw = source.slice(node.from, node.to);
      const ch = raw.length >= 2 ? raw.slice(1) : raw;
      if (ctx.sourcePositions) {
        const sp = sourcePosAttrs(ctx, node.from, node.to);
        return { html: `<span class="${CSS.text}"${sp}>${escapeHtml(ch)}</span>`, text: ch, hasMath: false };
      }
      return { html: escapeHtml(ch), text: ch, hasMath: false };
    }
    case NODE.Text: {
      const raw = source.slice(node.from, node.to);
      if (ctx.sourcePositions) {
        const sp = sourcePosAttrs(ctx, node.from, node.to);
        return { html: `<span class="${CSS.text}"${sp}>${escapeHtml(raw)}</span>`, text: raw, hasMath: false };
      }
      return { html: escapeHtml(raw), text: raw, hasMath: false };
    }
  }

  // Unknown inline node — fall back to its source text.
  const raw = source.slice(node.from, node.to);
  if (ctx.sourcePositions) {
    const sp = sourcePosAttrs(ctx, node.from, node.to);
    return { html: `<span class="${CSS.text}"${sp}>${escapeHtml(raw)}</span>`, text: raw, hasMath: false };
  }
  return { html: escapeHtml(raw), text: raw, hasMath: false };
}

function stripMathDelims(raw: string, display: boolean): string {
  if (display) {
    // $$..$$ or \[..\]
    if (raw.startsWith("$$") && raw.endsWith("$$") && raw.length >= 4) {
      return raw.slice(2, -2);
    }
    if (raw.startsWith("\\[") && raw.endsWith("\\]") && raw.length >= 4) {
      return raw.slice(2, -2);
    }
    return raw;
  }
  if (raw.startsWith("$") && raw.endsWith("$") && raw.length >= 2) {
    return raw.slice(1, -1);
  }
  if (raw.startsWith("\\(") && raw.endsWith("\\)") && raw.length >= 4) {
    return raw.slice(2, -2);
  }
  return raw;
}

function displayMathLatex(ctx: WalkContext, node: SyntaxNode): string {
  const marks = node.getChildren("DisplayMathMark");
  if (marks.length >= 2) {
    return ctx.source.slice(marks[0].to, marks[marks.length - 1].from).trim();
  }
  const label = node.getChild(NODE.EquationLabel);
  const sourceEnd = label ? label.from : node.to;
  return stripMathDelims(ctx.source.slice(node.from, sourceEnd).trim(), true).trim();
}

function trimSourceRange(source: string, from: number, to: number): { from: number; to: number } {
  while (from < to && /\s/.test(source[from] ?? "")) from++;
  while (to > from && /\s/.test(source[to - 1] ?? "")) to--;
  return { from, to };
}

function displayMathLatexRange(ctx: WalkContext, node: SyntaxNode): { from: number; to: number } {
  const marks = node.getChildren("DisplayMathMark");
  if (marks.length >= 2) {
    return trimSourceRange(ctx.source, marks[0].to, marks[marks.length - 1].from);
  }
  const label = node.getChild(NODE.EquationLabel);
  const sourceEnd = label ? label.from : node.to;
  return trimSourceRange(ctx.source, node.from, sourceEnd);
}

function equationLabelId(ctx: WalkContext, node: SyntaxNode): string | null {
  const label = node.getChild(NODE.EquationLabel);
  return label ? readBracedLabelId(ctx.source, label.from, label.to, "eq:") : null;
}

function emitLink(
  ctx: WalkContext,
  node: SyntaxNode,
): { html: string; text: string; hasMath: boolean } {
  const source = ctx.source;
  const raw = source.slice(node.from, node.to);

  // Citation cluster `[@key]` or `[@key; @other]` → handle via RefResolver.
  const clusterMatch = BRACKETED_REFERENCE_EXACT_RE.exec(raw);
  if (clusterMatch) {
    const body = clusterMatch[1] ?? "";
    const parts = parseReferenceClusterBody(body);
    if (parts) {
      return emitReferenceCluster(
        ctx,
        parts.map((p) => p.id),
        parts.map((p) => p.locator),
        raw,
        node.from,
        node.to,
      );
    }
  }

  const urlChild = node.getChild("URL");
  let href = urlChild ? source.slice(urlChild.from, urlChild.to) : "";

  const labelStart = node.from + 1;
  let labelEnd = node.to;
  if (urlChild) {
    for (let i = urlChild.from - 1; i >= labelStart; i--) {
      if (source[i] === "]") {
        labelEnd = i;
        break;
      }
    }
  } else {
    // No URL — find closing `]`.
    for (let i = node.to - 1; i >= labelStart; i--) {
      if (source[i] === "]") {
        labelEnd = i;
        break;
      }
    }
  }

  // Crossref `@eq:foo` / `@sec:bar` / `@thm:baz` inside `[ ]` — emit
  // crossref placeholder unless we have a resolver wired up (not in v1
  // for crossrefs). Same handling as narrative crossref below.
  // The cluster code above handles `[@key]`; the body here is general.

  // LinkResolver chance.
  let className: string | undefined;
  let title: string | undefined;
  if (ctx.resolvers.linkResolver?.resolve) {
    const labelText = source.slice(labelStart, labelEnd);
    const resolved = ctx.resolvers.linkResolver.resolve(href, labelText, {
      from: ctx.resolvers.documentPath,
      documentPath: ctx.resolvers.documentPath,
      raw,
      sourceRange: { from: node.from, to: node.to },
      surface: "reader",
    });
    if (resolved) {
      if (resolved.href !== undefined) href = resolved.href;
      if (resolved.className !== undefined) className = resolved.className;
      if (resolved.title !== undefined) title = resolved.title;
    }
  }

  // Render label inline.
  const label = renderInline(ctx, node, labelStart, labelEnd);

  if (!isSafeUrl(href)) {
    return { html: label.html, text: label.text, hasMath: label.hasMath };
  }

  return {
    html: renderLinkSurfaceHtml(href, label.html, {
      className,
      title,
      sourceAttrs: sourcePosAttrs(ctx, node.from, node.to),
    }),
    text: label.text,
    hasMath: label.hasMath,
  };
}

function buildReaderRefResolverEnv(
  ctx: WalkContext,
  raw: string,
  from: number,
  to: number,
  ids: readonly string[],
  locators: readonly (string | undefined)[],
  index: number,
): RefResolverEnv {
  return {
    raw,
    sourceRange: { from, to },
    locator: locators[index],
    cluster: {
      ids,
      locators,
      index,
      raw,
    },
    documentPath: ctx.resolvers.documentPath,
    surface: "reader",
  };
}

function renderReaderHostReference(resolved: HostReferenceResolution): string {
  if (resolved.href && isSafeUrl(resolved.href)) {
    return renderLinkSurfaceHtml(resolved.href, resolved.content);
  }
  return resolved.content;
}

function emitReferenceCluster(
  ctx: WalkContext,
  ids: string[],
  locators: (string | undefined)[],
  raw: string,
  from: number,
  to: number,
): { html: string; text: string; hasMath: boolean } {
  const refResolver = ctx.resolvers.refResolver;
  const parts: string[] = [];
  const textParts: string[] = [];

  const citationFormatter = ctx.resolvers.citationFormatter;
  const citationKeys = ctx.resolvers.citationKeys;
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    // Paper citation: resolve via the host-supplied formatter (the single source
    // of truth lives in core/references/citation-rendering), so the reader needs
    // no host refResolver for citations and can emit the bibliography itself.
    if (citationFormatter && coreIsCitationKey(citationKeys, id)) {
      const label = coreCiteInline(citationFormatter, [id], [locators[index]]);
      if (label !== null) {
        if (!ctx.citedKeys.includes(id)) ctx.citedKeys.push(id);
        parts.push(
          `<span class="${CSS.citation}" data-ref-key="${escapeHtml(id)}" data-ref-mode="bracketed">${escapeHtml(label)}</span>`,
        );
        textParts.push(label);
        continue;
      }
    }
    // In-document crossref resolved from the reader's own numbering catalog
    // (first walk). The host refResolver stays the fallback for ids the
    // document doesn't define — e.g. cross-file or workspace references.
    const catalogTarget = ctx.resolvers.referenceCatalog?.get(id);
    if (catalogTarget) {
      const fragment = escapeHtml(encodeURIComponent(id));
      parts.push(
        `<span class="${CSS.crossref}" data-ref-key="${escapeHtml(id)}" data-ref-mode="bracketed"><a href="#${fragment}">${escapeHtml(catalogTarget.label)}</a></span>`,
      );
      textParts.push(catalogTarget.label);
      continue;
    }
    if (refResolver) {
      const resolved = refResolver.resolve(
        id,
        "bracketed",
        buildReaderRefResolverEnv(ctx, raw, from, to, ids, locators, index),
      );
      if (resolved) {
        const cls = hostReferenceClassNames(resolved.className);
        const inner = renderReaderHostReference(resolved);
        parts.push(
          `<span class="${escapeHtml(cls)}" data-ref-key="${escapeHtml(id)}" data-ref-mode="bracketed">${inner}</span>`,
        );
        textParts.push(stripTags(resolved.content));
        continue;
      }
    }
    const display = ids.length === 1 ? raw : `@${id}`;
    parts.push(
      `<span class="${CSS.crossrefUnresolved}" data-ref-key="${escapeHtml(id)}" data-ref-mode="bracketed">${escapeHtml(display)}</span>`,
    );
    textParts.push(display);
  }

  const inner = parts.join("; ");
  const html = ctx.sourcePositions
    ? `<span class="${CSS.citationCluster}"${sourcePosAttrs(ctx, from, to)}>${inner}</span>`
    : inner;
  return {
    html,
    text: textParts.join("; "),
    hasMath: false,
  };
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

function isUnresolvedLocalMediaUrl(src: string): boolean {
  return !/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(src);
}

function emitImage(
  ctx: WalkContext,
  node: SyntaxNode,
): { html: string; text: string; hasMath: boolean } {
  const source = ctx.source;
  const urlChild = node.getChild("URL");
  let src = urlChild ? source.slice(urlChild.from, urlChild.to) : "";

  const altStart = node.from + 2;
  let altEnd = node.to;
  if (urlChild) {
    for (let i = urlChild.from - 1; i >= altStart; i--) {
      if (source[i] === "]") {
        altEnd = i;
        break;
      }
    }
  }
  const alt = source.slice(altStart, altEnd);

  if (ctx.resolvers.resolveAssetUrl) {
    try {
      const resolved = ctx.resolvers.resolveAssetUrl(src);
      if (typeof resolved === "string") src = resolved;
    } catch {
      // ignore
    }
  }

  const sp = sourcePosAttrs(ctx, node.from, node.to);
  if (!isSafeUrl(src)) {
    if (ctx.sourcePositions) {
      return {
        html: `<span class="${CSS.text}"${sp}>${escapeHtml(alt)}</span>`,
        text: alt,
        hasMath: false,
      };
    }
    return { html: escapeHtml(alt), text: alt, hasMath: false };
  }
  if (isUnresolvedLocalMediaUrl(src)) {
    return {
      html: renderMediaLoadingHtml(src, alt, sp),
      text: alt,
      hasMath: false,
    };
  }
  return {
    html: renderImageSurfaceHtml(src, alt, sp),
    text: alt,
    hasMath: false,
  };
}

// ---------------------------------------------------------------------------
// Block rendering.
// ---------------------------------------------------------------------------

type TruncateSpec = { lines: number } | { chars: number };

/**
 * One heading in a document outline, in document order.
 *
 * `id` is the anchor that {@link renderToHtml} emits on the heading element
 * when `opts.outline` is set — an explicit Pandoc `{#id}` when present, else a
 * deduplicated slug of `text`. `number` is coflat's canonical section number
 * (e.g. `"2.1"`), absent for unnumbered headings.
 */
export interface ReaderOutlineEntry {
  readonly id: string;
  readonly text: string;
  readonly html: string;
  readonly level: number;
  readonly number?: string;
}

interface RenderOptions {
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

function sourceLineAttr(ctx: WalkContext, pos: number): string {
  if (!ctx.lineOffsets) return "";
  return ` data-source-line="${lineAt(ctx.lineOffsets, pos)}"`;
}

/** Block-level convenience: emits both `data-source-line` (if
 *  `sourceLineAttribution`) and `data-source-from`/`data-source-to` (if
 *  `sourcePositions`). Pass the block node's `from`/`to`. */
function blockSourceAttrs(ctx: WalkContext, from: number, to: number): string {
  return sourceLineAttr(ctx, from) + sourcePosAttrs(ctx, from, to);
}

function blockMathSourceAttrs(ctx: WalkContext, from: number, to: number): string {
  return sourceLineAttr(ctx, from) + mathSourcePosAttrs(ctx, from, to);
}

function renderBlock(ctx: WalkContext, node: SyntaxNode): BlockResult {
  const name = node.name;

  // Headings (ATX + Setext) — uniform handling.
  const headingLevel = headingLevelFor(name);
  if (headingLevel) {
    return renderHeading(ctx, node, headingLevel);
  }

  switch (name) {
    case NODE.Paragraph:
      return renderParagraph(ctx, node);
    case NODE.BulletList:
      return renderList(ctx, node, /*ordered*/ false);
    case NODE.OrderedList:
      return renderList(ctx, node, /*ordered*/ true);
    case NODE.Blockquote:
      return renderBlockquote(ctx, node);
    case NODE.FencedCode:
      return renderFencedCode(ctx, node);
    case "CodeBlock":
      return renderIndentedCode(ctx, node);
    case NODE.HorizontalRule:
      return {
        html: renderHorizontalRuleHtml(blockSourceAttrs(ctx, node.from, node.to)),
        text: "",
        hasMath: false,
      };
    case "Table":
      return renderTable(ctx, node);
    case NODE.FencedDiv:
      return renderFencedDiv(ctx, node);
    case "FootnoteDef":
      return renderFootnoteDef(ctx, node);
    case NODE.DisplayMath: {
      const raw = ctx.source.slice(node.from, node.to);
      const inner = displayMathLatex(ctx, node);
      const equationId = equationLabelId(ctx, node);
      const equationNumber = equationId ? ++ctx.equationCounter : undefined;
      if (ctx.buildCatalog && equationId && equationNumber !== undefined) {
        ctx.catalog.set(equationId, {
          kind: "equation",
          label: formatEquationReferenceLabel(equationNumber),
        });
      }
      if (ctx.buildReferencePreviews && equationId && equationNumber !== undefined) {
        const range = displayMathLatexRange(ctx, node);
        const label = formatEquationReferenceLabel(equationNumber);
        ctx.referencePreviewIndex.set(equationId, {
          kind: "equation",
          id: equationId,
          label,
          latex: inner,
          text: inner,
          from: node.from,
          to: node.to,
          bodyFrom: range.from,
          bodyTo: range.to,
          number: String(equationNumber),
          ordinal: equationNumber,
        });
      }
      return {
        html: renderDisplayMathPlaceholderHtml(inner, raw, {
          equationNumber,
          id: equationId ?? undefined,
          sourceAttrs: blockMathSourceAttrs(ctx, node.from, node.to),
        }),
        text: raw,
        hasMath: true,
      };
    }
    case NODE.HTMLBlock:
    case "CommentBlock":
    case NODE.Frontmatter:
      // Drop frontmatter / HTML blocks from rendered output. Sanitizer
      // would strip raw HTML anyway; explicit drop avoids re-injection.
      return emptyBlock();
  }

  // Unknown block — emit its inline content as a paragraph fallback.
  return renderParagraph(ctx, node);
}

function headingLevelFor(name: string): number {
  switch (name) {
    case NODE.ATXHeading1: case NODE.SetextHeading1: return 1;
    case NODE.ATXHeading2: case NODE.SetextHeading2: return 2;
    case NODE.ATXHeading3: return 3;
    case NODE.ATXHeading4: return 4;
    case NODE.ATXHeading5: return 5;
    case NODE.ATXHeading6: return 6;
  }
  return 0;
}

/** Canonical heading slug: fold diacritics, lowercase, non-alphanumeric runs →
 *  "-", trimmed. Diacritic folding (NFKD + combining-mark strip) keeps accented
 *  headings readable ("Méthodes" → "methodes") instead of degrading to "m-thodes". */
function slugifyHeading(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A heading id unique within the document, de-duplicating with a numeric
 *  suffix. Empty slugs (headings with no alphanumerics) fall back to "section". */
function uniqueHeadingId(base: string, used: Set<string>): string {
  const root = base || "section";
  let candidate = root;
  let n = 2;
  while (used.has(candidate)) candidate = `${root}-${n++}`;
  used.add(candidate);
  return candidate;
}

/** Source range of a heading's inline content, excluding the `#+`/underline
 *  HeaderMark(s). Shared by {@link renderHeading} and the explicit-id pre-pass. */
function headingContentRange(source: string, node: SyntaxNode): { from: number; to: number } {
  // For ATX, content starts after `#+` and optional space; for Setext, content
  // is the line before the `===`/`---` underline.
  let contentFrom = node.from;
  let contentTo = node.to;
  const headerMark = node.getChild("HeaderMark");
  if (headerMark && headerMark.from === node.from) {
    // ATX: skip leading marks + one space.
    contentFrom = headerMark.to;
    while (contentFrom < contentTo && source[contentFrom] === " ") contentFrom++;
    // Strip trailing closing `#+` and whitespace.
    while (contentTo > contentFrom && source[contentTo - 1] === " ") contentTo--;
    // The Lezer tree may include a closing HeaderMark child at the end.
    const trailing = node.lastChild;
    if (trailing && trailing.name === "HeaderMark" && trailing.from !== headerMark.from) {
      contentTo = trailing.from;
      while (contentTo > contentFrom && source[contentTo - 1] === " ") contentTo--;
    }
  } else if (headerMark && headerMark.from > node.from) {
    // Setext: content is everything before the underline mark.
    contentTo = headerMark.from;
    while (contentTo > contentFrom && /\s/.test(source[contentTo - 1] ?? "")) contentTo--;
  }
  return { from: contentFrom, to: contentTo };
}

/** Reserve every explicit `{#id}` heading id so auto-slugs yield to author-set
 *  anchors (explicit ids win; an auto-slug that would collide gets suffixed). */
function reserveExplicitHeadingIds(ctx: WalkContext, tree: Tree): void {
  tree.iterate({
    enter(node) {
      if (!headingLevelFor(node.name)) return;
      const { from, to } = headingContentRange(ctx.source, node.node);
      const attrs = parsePandocHeadingAttributes(ctx.source, from, to);
      if (attrs?.id) ctx.usedHeadingIds.add(attrs.id);
      // A heading can't contain another heading — skip its inline subtree.
      return false;
    },
  });
}

function renderHeading(ctx: WalkContext, node: SyntaxNode, level: number): BlockResult {
  const { from: contentFrom, to: contentRangeEnd } = headingContentRange(ctx.source, node);
  let contentTo = contentRangeEnd;

  const attrs = parsePandocHeadingAttributes(ctx.source, contentFrom, contentTo);
  if (attrs) contentTo = attrs.contentTo;

  const inner = renderInline(ctx, node, contentFrom, contentTo);
  // The numbering walk always advances (and records the catalog), so crossrefs
  // resolve even when numbers aren't shown; `displayUnnumbered` only hides the
  // number — when sectionNumbering is off, every heading renders unnumbered.
  const headingNumber = nextHeadingNumber(ctx, level, !!attrs?.unnumbered);
  const headingTitle = inner.text.trim();
  const headingLabel = formatHeadingReferenceLabel({ number: headingNumber, text: headingTitle });
  if (ctx.buildCatalog && attrs?.id) {
    ctx.catalog.set(attrs.id, {
      kind: "heading",
      label: headingLabel,
    });
  }
  if (ctx.buildReferencePreviews && attrs?.id) {
    ctx.referencePreviewIndex.set(attrs.id, {
      kind: "heading",
      id: attrs.id,
      label: headingLabel,
      title: headingTitle,
      text: headingTitle,
      level,
      from: node.from,
      to: node.to,
      ...(headingNumber ? { number: headingNumber } : {}),
    });
  }
  const displayUnnumbered = !!attrs?.unnumbered || !ctx.numberHeadings;
  const numberingAttr = headingNumberingHtmlAttrs(headingNumber, displayUnnumbered);

  // Default: an id only for explicitly-labeled headings (byte-identical to the
  // pre-outline output). With `opts.outline`, every heading gets a stable id
  // (explicit `{#id}` or a deduplicated slug) and contributes an outline entry.
  let headingId = attrs?.id;
  if (ctx.collectOutline) {
    if (headingId) ctx.usedHeadingIds.add(headingId);
    else headingId = uniqueHeadingId(slugifyHeading(inner.text), ctx.usedHeadingIds);
    ctx.outline.push(
      displayUnnumbered
        ? { id: headingId, text: inner.text, html: inner.html, level }
        : { id: headingId, text: inner.text, html: inner.html, level, number: headingNumber },
    );
  }
  const idAttr = headingId ? ` id="${escapeHtml(headingId)}"` : "";
  return {
    html: `<h${level} class="${headingSurfaceClassNames(level, displayUnnumbered)}"${idAttr}${numberingAttr}${blockSourceAttrs(ctx, node.from, node.to)}>${inner.html}</h${level}>`,
    text: inner.text,
    hasMath: inner.hasMath,
  };
}

interface HeadingAttributeInfo {
  contentTo: number;
  unnumbered: boolean;
  id?: string;
}

function parsePandocHeadingAttributes(
  source: string,
  contentFrom: number,
  contentTo: number,
): HeadingAttributeInfo | null {
  let end = contentTo;
  while (end > contentFrom && /\s/.test(source[end - 1] ?? "")) end--;
  if (source[end - 1] !== "}") return null;

  const open = source.lastIndexOf("{", end - 1);
  if (open < contentFrom) return null;
  const beforeOpen = source[open - 1] ?? "";
  if (open > contentFrom && !/\s/.test(beforeOpen)) return null;

  const raw = source.slice(open + 1, end - 1).trim();
  if (!raw) return null;
  const tokens = raw.split(/\s+/);
  if (!tokens.every(isPandocHeadingAttributeToken)) return null;
  let strippedTo = open;
  while (strippedTo > contentFrom && /\s/.test(source[strippedTo - 1] ?? "")) strippedTo--;
  const idToken = tokens.find((token) => token.startsWith("#"));
  return {
    contentTo: strippedTo,
    unnumbered: tokens.includes("-") || tokens.includes(".unnumbered"),
    id: idToken?.slice(1),
  };
}

function isPandocHeadingAttributeToken(token: string): boolean {
  return (
    token === "-" ||
    /^[#.][^\s{}]+$/.test(token) ||
    /^[A-Za-z_:][\w:.-]*=(?:"[^"]*"|'[^']*'|[^\s{}]+)$/.test(token)
  );
}

function renderParagraph(ctx: WalkContext, node: SyntaxNode): BlockResult {
  let contentFrom = node.from;
  let contentTo = node.to;
  while (contentFrom < contentTo && /\s/.test(ctx.source[contentFrom] ?? "")) contentFrom++;
  while (contentTo > contentFrom && /\s/.test(ctx.source[contentTo - 1] ?? "")) contentTo--;
  const inner = renderInline(ctx, node, contentFrom, contentTo);
  // Trim boundary whitespace/newlines for tidy output; interior soft breaks
  // stay available for CSS to preserve rich-editor visual parity.
  const html = inner.html.replace(/^\s+/, "").replace(/\s+$/, "");
  return {
    html: renderParagraphHtml(html, blockSourceAttrs(ctx, node.from, node.to)),
    text: inner.text.replace(/^\s+/, "").replace(/\s+$/, ""),
    hasMath: inner.hasMath,
  };
}

function renderList(ctx: WalkContext, node: SyntaxNode, ordered: boolean): BlockResult {
  const items: BlockResult[] = [];
  let isTaskList = false;
  const isLoose = isLooseListNode(node, ctx.source);
  const startNumber = ordered ? orderedListStartNumber(node, ctx.source) : 1;
  let itemIndex = 0;

  let child = node.firstChild;
  while (child) {
    if (child.name === NODE.ListItem) {
      const item = renderListItem(ctx, child, ordered, startNumber + itemIndex);
      itemIndex++;
      if (item.html.includes(DOCUMENT_SURFACE_CLASS.listItemCheck)) isTaskList = true;
      items.push(item);
    }
    child = child.nextSibling;
  }

  return {
    html: renderListSurfaceHtml(
      { ordered, task: isTaskList, loose: isLoose, start: startNumber },
      items.map((b) => b.html).join(""),
      blockSourceAttrs(ctx, node.from, node.to),
    ),
    text: items.map((b) => b.text).join("\n"),
    hasMath: items.some((b) => b.hasMath),
  };
}

function renderListItem(
  ctx: WalkContext,
  node: SyntaxNode,
  ordered: boolean,
  number: number,
): BlockResult {
  // Task marker: TaskMarker is the first child of a Task wrapper (which
  // wraps the rest of the item content). Detect by walking one level deep.
  let task: { checked: boolean } | null = null;
  let scan = node.firstChild;
  while (scan) {
    if (scan.name === "Task") {
      const tm = scan.firstChild;
      if (tm && tm.name === "TaskMarker") {
        const raw = ctx.source.slice(tm.from, tm.to);
        task = { checked: taskMarkerChecked(raw) };
      }
      break;
    }
    scan = scan.nextSibling;
  }

  // Render child blocks (Paragraphs, nested lists, …). Skip ListMark.
  // A Task wrapper is treated transparently — its content is the item content
  // and its TaskMarker child is skipped.
  const blocks: BlockResult[] = [];
  const visit = (parent: SyntaxNode): void => {
    let child = parent.firstChild;
    while (child) {
      const n = child.name;
      if (n === "ListMark" || n === "TaskMarker") {
        child = child.nextSibling;
        continue;
      }
      if (n === "Task") {
        // Task is an inline-content wrapper; treat its content as paragraph text.
        const inner = renderInline(ctx, child, child.from, child.to);
        blocks.push({
          html: renderParagraphHtml(
            inner.html.replace(/^\s+/, "").replace(/\s+$/, ""),
            blockSourceAttrs(ctx, child.from, child.to),
          ),
          text: inner.text.replace(/^\s+/, "").replace(/\s+$/, ""),
          hasMath: inner.hasMath,
        });
        child = child.nextSibling;
        continue;
      }
      if (n === NODE.Paragraph) {
        blocks.push(renderParagraph(ctx, child));
      } else {
        blocks.push(renderBlock(ctx, child));
      }
      child = child.nextSibling;
    }
  };
  visit(node);

  // If the only block is a paragraph, unwrap it to bare inline (tight item).
  let inner: string;
  let text: string;
  const hasMath = blocks.some((b) => b.hasMath);
  if (blocks.length === 1 && blocks[0].html.startsWith(`<p class="${paragraphClasses}"`)) {
    // Strip outer <p>…</p>.
    inner = blocks[0].html.replace(new RegExp(`^<p class="${paragraphClasses}"[^>]*>`), "").replace(/<\/p>$/, "");
    text = blocks[0].text;
  } else {
    inner = blocks.map((b) => b.html).join("");
    text = blocks.map((b) => b.text).join("\n");
  }

  if (task) {
    const cb = `${renderReadOnlyTaskCheckboxHtml(task.checked)} `;
    inner = cb + inner;
    text = (task.checked ? "[x] " : "[ ] ") + text;
  }
  return {
    html: renderListItemSurfaceHtml(
      { ordered, task: task !== null, checked: task?.checked },
      number,
      inner,
      blockSourceAttrs(ctx, node.from, node.to),
    ),
    text,
    hasMath,
  };
}

function renderBlockquote(ctx: WalkContext, node: SyntaxNode): BlockResult {
  const blocks: BlockResult[] = [];
  let child = node.firstChild;
  while (child) {
    if (child.name === "QuoteMark") {
      child = child.nextSibling;
      continue;
    }
    blocks.push(renderBlock(ctx, child));
    child = child.nextSibling;
  }
  return {
    html: renderBlockquoteHtml(
      blocks.map((b) => b.html).join(""),
      blockSourceAttrs(ctx, node.from, node.to),
    ),
    text: blocks.map((b) => b.text).join("\n"),
    hasMath: blocks.some((b) => b.hasMath),
  };
}

function renderFencedCode(ctx: WalkContext, node: SyntaxNode): BlockResult {
  // Lang from CodeInfo child.
  const info = node.getChild("CodeInfo");
  const lang = info ? ctx.source.slice(info.from, info.to).trim() : "";

  // Inner content: everything between opening and closing CodeMark fences.
  let contentFrom = node.from;
  let contentTo = node.to;
  const marks = node.getChildren("CodeMark");
  if (marks.length >= 1) contentFrom = (info ? info.to : marks[0].to);
  if (marks.length >= 2) contentTo = marks[marks.length - 1].from;

  // Trim a single leading newline (after the info line) and trailing newline.
  while (contentFrom < contentTo && (ctx.source[contentFrom] === "\n")) contentFrom++;
  while (contentTo > contentFrom && (ctx.source[contentTo - 1] === "\n")) contentTo--;

  const code = ctx.source.slice(contentFrom, contentTo);
  return {
    html: renderCodeBlockHtml(lang, code, blockSourceAttrs(ctx, node.from, node.to)),
    text: code,
    hasMath: false,
  };
}

function renderIndentedCode(ctx: WalkContext, node: SyntaxNode): BlockResult {
  const code = ctx.source.slice(node.from, node.to).replace(/^( {4}|\t)/gm, "");
  return {
    html: renderCodeBlockHtml("", code, blockSourceAttrs(ctx, node.from, node.to)),
    text: code,
    hasMath: false,
  };
}

function renderTable(ctx: WalkContext, node: SyntaxNode): BlockResult {
  const aligns = inferTableAlign(ctx, node);

  const headerRowsHtml: string[] = [];
  const bodyRowsHtml: string[] = [];
  const textRows: string[] = [];

  const header = node.getChild("TableHeader");
  if (header) {
    const { rowHtml, rowText } = renderTableRow(ctx, header, /*head*/ true, aligns);
    headerRowsHtml.push(rowHtml);
    textRows.push(rowText);
  }
  // Each TableRow → tbody.
  const rows = node.getChildren("TableRow");
  for (const row of rows) {
    const { rowHtml, rowText } = renderTableRow(ctx, row, /*head*/ false, aligns);
    bodyRowsHtml.push(rowHtml);
    textRows.push(rowText);
  }

  let inner = "";
  if (headerRowsHtml.length) inner += `<thead>${headerRowsHtml.join("")}</thead>`;
  if (bodyRowsHtml.length) inner += `<tbody>${bodyRowsHtml.join("")}</tbody>`;
  return {
    html: renderTableSurfaceHtml(inner, blockSourceAttrs(ctx, node.from, node.to)),
    text: textRows.join("\n"),
    hasMath: false,
  };
}

function inferTableAlign(ctx: WalkContext, node: SyntaxNode): (string | null)[] {
  // Find a TableDelimiter that is a *child* of the table itself (the
  // delimiter row separating header from body). Its source slice contains
  // `:?-+:?` cells separated by `|`.
  const delims = node.getChildren("TableDelimiter");
  // The first such child whose text contains '-' is the delimiter row.
  for (const d of delims) {
    const raw = ctx.source.slice(d.from, d.to);
    if (!raw.includes("-")) continue;
    return parseTableDelimiterAlignments(raw);
  }
  return [];
}

function renderTableRow(
  ctx: WalkContext,
  row: SyntaxNode,
  isHeader: boolean,
  aligns: (string | null)[],
): { rowHtml: string; rowText: string } {
  const cellHtmls: string[] = [];
  const cellTexts: string[] = [];
  const cells = row.getChildren("TableCell");
  cells.forEach((cell, idx) => {
    const inner = renderInline(ctx, cell, cell.from, cell.to);
    const tag = isHeader ? "th" : "td";
    cellHtmls.push(renderTableCellHtml(tag, inner.html, aligns[idx]));
    cellTexts.push(inner.text);
  });
  return {
    rowHtml: renderTableRowHtml(cellHtmls.join(""), blockSourceAttrs(ctx, row.from, row.to)),
    rowText: cellTexts.join("\t"),
  };
}

function renderBlankLine(ctx: WalkContext, from: number, to: number): BlockResult {
  return {
    html: renderBlankLineHtml(blockSourceAttrs(ctx, from, to)),
    text: "",
    hasMath: false,
  };
}

function renderFencedDiv(ctx: WalkContext, node: SyntaxNode): BlockResult {
  // Read attribute text from FencedDivAttributes child.
  const attrsNode = node.getChild(NODE.FencedDivAttributes);
  let className = "";
  let id: string | undefined;
  let kvs: Record<string, string> = {};
  if (attrsNode) {
    const raw = ctx.source.slice(attrsNode.from, attrsNode.to).trim();
    const parsed = extractDivClass(raw);
    if (parsed) {
      className = parsed.classes[0] ?? "";
      id = parsed.id;
      kvs = { ...parsed.keyValues };
    }
  }

  // Render children (skipping the fence + attrs nodes).
  const blocks: BlockResult[] = [];
  let previousRenderable: SyntaxNode | null = null;
  let bodyFrom: number | null = null;
  let bodyTo: number | null = null;
  let inlineTitle: string | undefined;
  let child = node.firstChild;
  while (child) {
    if (child.name === NODE.FencedDivFence) {
      if (previousRenderable && child.from > previousRenderable.to) {
        for (const [from, to] of blankLineRangesBetweenBlocks(ctx.source, previousRenderable.to, child.from)) {
          blocks.push(renderBlankLine(ctx, from, to));
        }
      }
      child = child.nextSibling;
      continue;
    }
    if (
      child.name === NODE.FencedDivAttributes ||
      child.name === "FencedDivTitle"
    ) {
      if (child.name === "FencedDivTitle") {
        const rawTitle = ctx.source.slice(child.from, child.to).trim();
        if (rawTitle) inlineTitle = rawTitle;
      }
      child = child.nextSibling;
      continue;
    }
    if (previousRenderable && child.from > previousRenderable.to) {
      for (const [from, to] of blankLineRangesBetweenBlocks(ctx.source, previousRenderable.to, child.from)) {
        blocks.push(renderBlankLine(ctx, from, to));
      }
    }
    bodyFrom ??= child.from;
    bodyTo = child.to;
    blocks.push(renderBlock(ctx, child));
    previousRenderable = child;
    child = child.nextSibling;
  }

  const normalizedClassName = className.toLowerCase();
  const manifestEntry = getBlockManifestEntry(normalizedClassName);
  if (manifestEntry?.specialBehavior === "qed") {
    addClassToLastHtmlBlock(blocks, CSS.blockQed);
  }
  const collapsibleBlock = Boolean(
    normalizedClassName &&
    isCollapsibleBlockType(normalizedClassName),
  );
  const interactiveBlock = collapsibleBlock && ctx.interactiveBlockDisclosures;
  const classes = [blockClasses(normalizedClassName || undefined)];
  if (interactiveBlock) classes.push(CSS.blockCollapsible);

  let attrs = ` class="${classes.join(" ")}"`;
  if (id) attrs += ` id="${escapeHtml(id)}"`;
  for (const [k, v] of Object.entries(kvs)) {
    attrs += ` data-${escapeHtml(k)}="${escapeHtml(v)}"`;
  }
  const body = combineBlocks(blocks);
  const sourceAttrs = blockSourceAttrs(ctx, node.from, node.to);
  const title = kvs.title ?? inlineTitle;
  const number = normalizedClassName ? nextBlockNumber(ctx, normalizedClassName) : undefined;
  const plan = normalizedClassName
    ? blockPresentationPlan({
      blockType: normalizedClassName,
      displayTitle: blockDisplayTitle(ctx, normalizedClassName),
      number,
      title,
    })
    : undefined;
  const caption = plan?.hasCaptionBelow && title
    ? renderBlockCaption(ctx, normalizedClassName, title, number, node.from, node.to)
    : emptyBlock();
  const bodyHtml = body.html + caption.html;
  if (ctx.buildCatalog && id && normalizedClassName) {
    ctx.catalog.set(id, {
      kind: "block",
      label: formatBlockReferenceLabel(blockDisplayTitle(ctx, normalizedClassName), number),
    });
  }
  if (ctx.buildReferencePreviews && id && normalizedClassName) {
    const label = formatBlockReferenceLabel(blockDisplayTitle(ctx, normalizedClassName), number);
    const bodyRange = trimSourceRange(ctx.source, bodyFrom ?? node.from, bodyTo ?? node.from);
    ctx.referencePreviewIndex.set(id, {
      kind: "block",
      id,
      label,
      blockType: normalizedClassName,
      ...(title ? { title } : {}),
      from: node.from,
      to: node.to,
      bodyFrom: bodyRange.from,
      bodyTo: bodyRange.to,
      ...(number === undefined ? {} : { number: String(number), ordinal: number }),
    });
  }
  const summary = normalizedClassName
    ? renderBlockSummary(ctx, normalizedClassName, title, number)
    : emptyBlock();
  const summaryHtml = summary.html;
  const html = plan?.hasInlineHeader
    ? renderInlineBlockHeadingContainerHtml(attrs, sourceAttrs, summaryHtml, bodyHtml)
    : collapsibleBlock
    ? `<div${attrs}${sourceAttrs}${interactiveBlock ? ' data-cf-block-open="true"' : ""}>${renderBlockHeader(summaryHtml, bodyHtml)}</div>`
    : `<div${attrs}${sourceAttrs}>${bodyHtml}</div>`;

  return {
    html,
    text: [body.text, caption.text].filter(Boolean).join("\n\n"),
    hasMath: summary.hasMath || body.hasMath || caption.hasMath,
  };
}

function renderFootnoteDef(ctx: WalkContext, node: SyntaxNode): BlockResult {
  // Label child carries the `[^id]:` source.
  const labelNode = node.getChild("FootnoteDefLabel");
  if (!labelNode) return emptyBlock();
  const labelRaw = ctx.source.slice(labelNode.from, labelNode.to);
  const m = labelRaw.match(/^\[\^([^\]]+)\]:/);
  if (!m) return emptyBlock();
  const id = m[1];

  // Body inline: render children after labelNode.
  let html = "";
  let text = "";
  let hasMath = false;
  let cursor = labelNode.to;
  let child = labelNode.nextSibling;
  while (child) {
    if (child.from > cursor) {
      const gap = ctx.source.slice(cursor, child.from);
      html += escapeHtml(gap);
      text += gap;
    }
    const r = renderInlineNode(ctx, child);
    html += r.html;
    text += r.text;
    if (r.hasMath) hasMath = true;
    cursor = child.to;
    child = child.nextSibling;
  }
  if (cursor < node.to) {
    const tail = ctx.source.slice(cursor, node.to);
    html += escapeHtml(tail);
    text += tail;
  }

  // Trim leading whitespace from body.
  html = html.replace(/^\s+/, "");
  text = text.replace(/^\s+/, "").replace(/\s+$/, "");

  // Register / update footnote entry. Forward-ref may have already
  // assigned a number; preserve it.
  let entry = ctx.footnotesById.get(id);
  if (!entry) {
    entry = {
      id,
      number: ctx.footnotesInOrder.length + 1,
      bodyHtml: html,
      hasRef: false,
    };
    ctx.footnotesById.set(id, entry);
    ctx.footnotesInOrder.push(entry);
  } else {
    entry.bodyHtml = html;
  }
  void text;

  // FootnoteDef itself emits no inline output; the footnotes list is
  // appended at the end of the document. Propagate hasMath so math
  // inside a footnote body still triggers KaTeX hydration when the
  // list renders.
  return { html: "", text: "", hasMath };
}

function renderFootnotesList(ctx: WalkContext): string {
  if (ctx.footnotesInOrder.length === 0) return "";
  return renderFootnoteSectionHtml(
    ctx.footnotesInOrder
      .filter((fn) => fn.hasRef || fn.bodyHtml)
      .map((fn) => ({
        num: fn.number,
        id: fn.id,
        html: fn.bodyHtml,
        backrefHref: `#fnref-${encodeURIComponent(fn.id)}`,
      })),
  );
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

// Count the "line cost" of a block per the truncation spec:
//   heading=1, paragraph=1, list=item count, code fence=code line count,
//   table=row count, math display=1, fenced div=1+nested cost, hr=1,
//   blockquote=recurse, other=0.
function blockLineCost(source: string, node: SyntaxNode): number {
  const name = node.name;
  switch (name) {
    case NODE.ATXHeading1: case NODE.ATXHeading2: case NODE.ATXHeading3:
    case NODE.ATXHeading4: case NODE.ATXHeading5: case NODE.ATXHeading6:
    case NODE.SetextHeading1: case NODE.SetextHeading2:
      return 1;
    case NODE.Paragraph:
      return 1;
    case NODE.HorizontalRule:
      return 1;
    case NODE.DisplayMath:
      return 1;
    case NODE.BulletList:
    case NODE.OrderedList: {
      let count = 0;
      let c = node.firstChild;
      while (c) {
        if (c.name === NODE.ListItem) count++;
        c = c.nextSibling;
      }
      return count;
    }
    case NODE.FencedCode:
    case "CodeBlock": {
      // Count newlines in the fenced content region.
      const marks = node.getChildren("CodeMark");
      const info = node.getChild("CodeInfo");
      let from = node.from;
      let to = node.to;
      if (marks.length >= 1) from = info ? info.to : marks[0].to;
      if (marks.length >= 2) to = marks[marks.length - 1].from;
      const content = source.slice(from, to).replace(/^\n/, "").replace(/\n$/, "");
      if (content.length === 0) return 0;
      return content.split("\n").length;
    }
    case "Table": {
      let count = 0;
      let c = node.firstChild;
      while (c) {
        if (c.name === "TableHeader" || c.name === "TableRow") count++;
        c = c.nextSibling;
      }
      return count;
    }
    case NODE.FencedDiv: {
      let nested = 0;
      let c = node.firstChild;
      while (c) {
        if (
          c.name !== NODE.FencedDivFence &&
          c.name !== NODE.FencedDivAttributes &&
          c.name !== "FencedDivTitle"
        ) {
          nested += blockLineCost(source, c);
        }
        c = c.nextSibling;
      }
      return 1 + nested;
    }
    case NODE.Blockquote: {
      let nested = 0;
      let c = node.firstChild;
      while (c) {
        if (c.name !== "QuoteMark") nested += blockLineCost(source, c);
        c = c.nextSibling;
      }
      return nested;
    }
    default:
      return 0;
  }
}

function walkDocument(
  source: string,
  tree: Tree,
  resolvers: Resolvers,
  opts: RenderOptions,
): BlockResult & {
  truncated?: TruncatedInfo;
  outline: ReaderOutlineEntry[];
  catalog: Map<string, ReaderReferenceTarget>;
  referencePreviewIndex: ReaderReferencePreviewCatalog;
  mathMacros?: Record<string, string>;
} {
  const frontmatter = parseFrontmatter(source);
  const frontmatterEnd = frontmatter.end;
  const blockConfig = frontmatter.config.blocks;
  const buildCatalog = !!(opts.resolveReferences || opts.referencePreviews);
  const ctx: WalkContext = {
    source,
    resolvers,
    lineOffsets: opts.sourceLineAttribution ? buildLineOffsets(source) : null,
    sourcePositions: !!opts.sourcePositions,
    mathSourcePositions: !!(opts.sourcePositions || opts.mathSourcePositions),
    interactiveBlockDisclosures: opts.interactiveBlockDisclosures !== false,
    collectOutline: !!opts.outline,
    outline: [],
    usedHeadingIds: new Set(),
    headingCounters: [0, 0, 0, 0, 0, 0, 0],
    blockCounters: new Map(),
    blockNumbering: frontmatter.config.numbering ?? "grouped",
    blockNumberingSpec: createConfiguredBlockNumberingSpecLookup(blockConfig),
    blockTitles: blockTitleOverridesFromConfig(blockConfig),
    equationCounter: 0,
    footnotesById: new Map(),
    footnotesInOrder: [],
    citedKeys: [],
    catalog: new Map(),
    referencePreviewIndex: new Map(),
    buildCatalog,
    buildReferencePreviews: !!opts.referencePreviews,
    numberHeadings: opts.sectionNumbering !== false,
  };

  if (ctx.collectOutline) reserveExplicitHeadingIds(ctx, tree);

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
      html: `<div class="${CSS.docTitle}"${blockSourceAttrs(ctx, 0, frontmatterEnd)}>${renderedTitle.html}</div>`,
      text: title,
      hasMath: renderedTitle.hasMath,
    });
  }
  let child = root.firstChild;
  let topCount = blocks.length;
  let previousRenderable: SyntaxNode | null = null;
  let used = 0;
  let truncated: TruncatedInfo | undefined;

  while (child) {
    if (child.to <= frontmatterEnd) {
      child = child.nextSibling;
      continue;
    }
    if (budgetKind) {
      // Snapshot footnote state so we can roll back if we end up not emitting.
      const fnOrderLen = ctx.footnotesInOrder.length;
      const fnIdSnapshot = new Map(ctx.footnotesById);
      const headingCounterSnapshot = [...ctx.headingCounters];
      const blockCounterSnapshot = new Map(ctx.blockCounters);
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
        ctx.footnotesInOrder.length = fnOrderLen;
        ctx.footnotesById = fnIdSnapshot;
        ctx.headingCounters = headingCounterSnapshot;
        ctx.blockCounters = blockCounterSnapshot;
        ctx.outline.length = outlineLen;
        ctx.usedHeadingIds = usedHeadingIdsSnapshot;
        ctx.citedKeys.length = citedKeysLen;
        if (catalogSnapshot) ctx.catalog = catalogSnapshot;
        if (referencePreviewIndexSnapshot) {
          ctx.referencePreviewIndex = referencePreviewIndexSnapshot;
        }
        truncated = { sourceFrom: child.from, sourceTo: source.length };
        break;
      }
      // Either used===0 (must emit at least this block, even if it busts
      // budget — atomic blocks) or budget still has room. Emit.
      if (previousRenderable && child.from > previousRenderable.to) {
        for (const [from, to] of blankLineRangesBetweenBlocks(ctx.source, previousRenderable.to, child.from)) {
          blocks.push(renderBlankLine(ctx, from, to));
        }
      }
      blocks.push(rendered);
      used += cost;
      topCount++;
      previousRenderable = child;
      child = child.nextSibling;
      continue;
    }
    topCount++;
    if (previousRenderable && child.from > previousRenderable.to) {
      for (const [from, to] of blankLineRangesBetweenBlocks(ctx.source, previousRenderable.to, child.from)) {
        blocks.push(renderBlankLine(ctx, from, to));
      }
    }
    blocks.push(renderBlock(ctx, child));
    previousRenderable = child;
    child = child.nextSibling;
  }

  // Handle the case where the budget is exactly met: check if there's another
  // block following the last emitted one — if so, mark truncated.
  if (budgetKind && !truncated && child) {
    truncated = { sourceFrom: child.from, sourceTo: source.length };
  }

  if (!truncated && previousRenderable && topCount > 1) {
    for (const [from, to] of trailingBlankLineRangesAfterLastBlock(ctx.source, previousRenderable.to)) {
      blocks.push(renderBlankLine(ctx, from, to));
    }
  }

  // If the document has exactly one top-level block AND it is a Paragraph
  // (and no math) AND we did not truncate, unwrap the `<p>` to preserve the
  // existing bare-inline shape that callers (and existing tests) rely on for
  // short inputs.
  let combined: BlockResult;
  if (
    !truncated &&
    topCount === 1 &&
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
  "a", "img", "button",
  "hr",
  "table", "thead", "tbody", "tr", "th", "td",
  "sup", "sub",
  "input",
];
const ALLOWED_ATTR = [
  "href", "src", "alt", "title", "class", "id", "start", "open",
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
    !opts.truncate &&
    !opts.outline &&
    !opts.resolveReferences &&
    !opts.referencePreviews
  ) {
    const fast = fastRenderInline(source);
    return { html: sanitize(fast.html), hasMath: false };
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
      const v = fs.resolveAssetUrl(path);
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

// ---------------------------------------------------------------------------
// DOM Range → source position mapping.
// ---------------------------------------------------------------------------

/**
 * Map a live DOM {@link Range} back to a source byte interval, using the
 * `data-source-from`/`data-source-to` attributes emitted by
 * {@link renderToHtml} with `sourcePositions: true`.
 *
 * Walks each endpoint up to the nearest ancestor carrying source-position
 * attrs. Plain text inside a `<span class="cf-text">`, inline marks
 * (`<strong>`, `<em>`, `<del>`, `<code>`, `<a>`, `<sup>`, `<mark>`) and
 * block elements all qualify. For these the text-to-source mapping is 1:1
 * by character count (HTML escapes are atomic in source), so the offset
 * inside the text node is added to the ancestor's `data-source-from`.
 *
 * Limitation — math: after {@link hydrateMath} runs, a `<span data-math>`
 * contains KaTeX-rendered MathML/HTML whose character offsets do NOT
 * correspond to LaTeX source. Selections inside a hydrated math node
 * collapse to the math span's full `[from, to)` range (block-granularity).
 * The same is true for the un-hydrated placeholder (its rendered text is
 * the raw source which IS 1:1, but we still return the span's full range
 * for consistency).
 *
 * If neither endpoint has a `data-source-from` ancestor (e.g., the range
 * is rooted on `container` itself before any walk, or sits inside a
 * synthetic backref glyph), returns `null` rather than fabricating
 * offsets. Requires `renderToHtml({ sourcePositions: true })`; if no
 * attrs are present anywhere, also returns `null`.
 *
 * Pure function over the live DOM — no global state.
 *
 * @param range DOM Range produced by, e.g., `window.getSelection()`.
 * @param container Reader root that bounds the search (walks stop here).
 * @returns `{ from, to }` byte offsets into the original source, or `null`.
 */
export function mapDomRangeToSource(
  range: Range,
  container: HTMLElement,
): { from: number; to: number } | null {
  const start = resolveEndpoint(range.startContainer, range.startOffset, container, /* atEnd */ false);
  if (start === null) return null;
  const end = resolveEndpoint(range.endContainer, range.endOffset, container, /* atEnd */ true);
  if (end === null) return null;

  let from = start;
  let to = end;
  if (from > to) {
    const t = from;
    from = to;
    to = t;
  }
  return { from, to };
}

function resolveEndpoint(
  node: Node,
  offset: number,
  container: HTMLElement,
  atEnd: boolean,
): number | null {
  // Find the nearest ancestor element carrying data-source-from/to.
  let el: Element | null =
    node.nodeType === 1 /* ELEMENT_NODE */
      ? (node as Element)
      : node.parentElement;

  // If endpoint is a text node, the offset is meaningful for character-level
  // mapping. For element endpoints (e.g., before/after a child element), we
  // treat `offset` as a child index and fall back to block-granularity.
  const isText = node.nodeType === 3 /* TEXT_NODE */;

  while (el && el !== container && !el.hasAttribute("data-source-from")) {
    el = el.parentElement;
  }
  if (!el || el === container || !el.hasAttribute("data-source-from")) {
    return null;
  }

  const fromStr = el.getAttribute("data-source-from");
  const toStr = el.getAttribute("data-source-to");
  if (fromStr === null || toStr === null) return null;
  const elFrom = Number(fromStr);
  const elTo = Number(toStr);
  if (!Number.isFinite(elFrom) || !Number.isFinite(elTo)) return null;

  // Math: hydrated subtrees do not character-map; collapse to block bounds.
  // Detect by walking from the endpoint up to `el` and looking for data-math.
  let probe: Element | null = node.nodeType === 1 ? (node as Element) : node.parentElement;
  while (probe && probe !== el) {
    if (probe.hasAttribute("data-math")) {
      return atEnd ? elTo : elFrom;
    }
    probe = probe.parentElement;
  }
  if (el.hasAttribute("data-math")) {
    return atEnd ? elTo : elFrom;
  }

  if (!isText) {
    // Element endpoint: collapse to span bounds.
    return atEnd ? elTo : elFrom;
  }

  // Text-node endpoint: 1:1 character → source mapping within `el`.
  // The text node may be nested (e.g., text inside <a> inside <p>); the
  // offset within `el`'s rendered text is the sum of all preceding text
  // characters under `el`, minus those before our text node.
  const charsBefore = countTextCharsBefore(el, node);
  if (charsBefore < 0) {
    // node not under el (shouldn't happen if walk succeeded).
    return atEnd ? elTo : elFrom;
  }
  const candidate = elFrom + charsBefore + offset;
  // Clamp to span bounds.
  if (candidate < elFrom) return elFrom;
  if (candidate > elTo) return elTo;
  return candidate;
}

/**
 * Count the number of text characters under `root` that precede `target`
 * in document order. Returns -1 if `target` is not a descendant of `root`.
 */
function countTextCharsBefore(root: Element, target: Node): number {
  let count = 0;
  let found = false;

  function walk(n: Node): boolean {
    if (n === target) {
      found = true;
      return true;
    }
    if (n.nodeType === 3 /* TEXT_NODE */) {
      count += (n as Text).data.length;
      return false;
    }
    if (n.nodeType !== 1 /* ELEMENT_NODE */) return false;
    let child = n.firstChild;
    while (child) {
      if (walk(child)) return true;
      child = child.nextSibling;
    }
    return false;
  }

  let child = root.firstChild;
  while (child) {
    if (walk(child)) break;
    child = child.nextSibling;
  }
  return found ? count : -1;
}

// ---------------------------------------------------------------------------
// Reader disclosure hydration.
// ---------------------------------------------------------------------------

const BLOCK_DISCLOSURE_HYDRATED_ATTR = "data-cf-block-disclosure-hydrated";
const BLOCK_OPEN_ATTR = "data-cf-block-open";
const SECTION_DISCLOSURE_HYDRATED_ATTR = "data-cf-section-disclosure-hydrated";
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
  if (root.getAttribute(SECTION_DISCLOSURE_HYDRATED_ATTR) === "true") return;

  const headings = [
    ...(root.classList.contains(DOCUMENT_SURFACE_CLASS.heading) ? [root] : []),
    ...Array.from(root.querySelectorAll<HTMLElement>(`.${DOCUMENT_SURFACE_CLASS.heading}`)),
  ];

  for (let index = headings.length - 1; index >= 0; index--) {
    const heading = headings[index];
    const level = headingElementLevel(heading);
    if (level === 0) continue;

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

  root.setAttribute(SECTION_DISCLOSURE_HYDRATED_ATTR, "true");
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

// ---------------------------------------------------------------------------
// Reference hydration.
// ---------------------------------------------------------------------------

export interface HydrateReferencesOptions {
  readonly documentPath?: string;
  readonly source?: string;
  readonly surface?: string;
}

function parseSourceRange(el: Element): { from: number; to: number } | undefined {
  const carrier = el.hasAttribute("data-source-from")
    ? el
    : el.closest("[data-source-from][data-source-to]");
  if (!carrier) return undefined;
  const from = Number(carrier.getAttribute("data-source-from"));
  const to = Number(carrier.getAttribute("data-source-to"));
  return Number.isFinite(from) && Number.isFinite(to) ? { from, to } : undefined;
}

function hydrateReferenceElement(
  el: HTMLElement,
  ctx: DocumentContext,
  opts: HydrateReferencesOptions,
): void {
  const key = el.dataset.refKey;
  if (!key || !ctx.refResolver?.resolve) return;
  const mode = el.dataset.refMode === "narrative" ? "narrative" : "bracketed";
  const sourceRange = parseSourceRange(el);
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

function hydrateLinkElement(
  el: HTMLAnchorElement,
  ctx: DocumentContext,
  opts: HydrateReferencesOptions,
): void {
  const href = el.getAttribute("href");
  if (!href || !ctx.linkResolver?.resolve) return;
  const sourceRange = parseSourceRange(el);
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
  if (typeof resolved.onClick === "function") {
    el.addEventListener("click", resolved.onClick);
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

function createReaderHoverContainer(): HTMLElement {
  return createHoverPreviewContentElement();
}

function createReaderHoverHeader(text: string): HTMLElement {
  return createHoverPreviewHeaderElement(text);
}

function createReaderHoverBody(): HTMLElement {
  return createHoverPreviewBodyElement();
}

function createReaderUnresolvedPreview(key: string): HTMLElement {
  const container = createReaderHoverContainer();
  container.appendChild(createReaderHoverHeader(`Unresolved: ${key}`));
  return container;
}

function createReaderTextPreview(preview: string): HTMLElement {
  const container = createReaderHoverContainer();
  const body = createHoverPreviewCitationBodyElement();
  body.textContent = preview;
  container.appendChild(body);
  return container;
}

function createReaderElementPreview(preview: HTMLElement): HTMLElement {
  const container = createReaderHoverContainer();
  container.appendChild(preview);
  return container;
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
  const container = createReaderHoverContainer();
  const body = createHoverPreviewCitationBodyElement();
  body.innerHTML = sanitize(entry.html);
  container.appendChild(body);
  return container;
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

function readerPreviewHeaderText(entry: ReaderReferencePreviewEntry, fallback: string): string {
  if (
    (entry.kind === "heading" || entry.kind === "block") &&
    entry.title &&
    entry.title !== entry.label
  ) {
    return `${entry.label} ${entry.title}`;
  }
  return entry.label || fallback;
}

function buildReaderIndexedPreview(
  entry: ReaderReferencePreviewEntry | undefined,
  source: string | undefined,
  context: DocumentContext | undefined,
  mathMacros: Record<string, string> | undefined,
  fallbackLabel: string,
): HTMLElement | null {
  if (!entry) return null;
  const container = createReaderHoverContainer();
  container.appendChild(createReaderHoverHeader(readerPreviewHeaderText(entry, fallbackLabel)));

  if (entry.kind === "heading") {
    return container;
  }

  if (entry.kind === "equation") {
    container.appendChild(
      renderReaderPreviewSource(`$$\n${entry.latex}\n$$`, context, mathMacros),
    );
    return container;
  }

  if (entry.kind === "block" && source) {
    const bodySource = source.slice(entry.bodyFrom, entry.bodyTo).trim();
    if (bodySource) {
      container.appendChild(renderReaderPreviewSource(bodySource, context, mathMacros));
    }
  }
  return container;
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function findReaderEquationPreviewSource(source: string, key: string): string | null {
  const escapedKey = escapeRegExpLiteral(key);
  const labelPattern = String.raw`\{\s*#${escapedKey}\s*\}`;
  const labelMatch = new RegExp(labelPattern).exec(source);
  if (!labelMatch) return null;

  const beforeLabel = source.slice(0, labelMatch.index);
  const beforeMath = beforeLabel.trimEnd();

  const closeDollars = beforeMath.lastIndexOf("$$");
  const closeBracket = beforeMath.lastIndexOf("\\]");
  if (closeDollars > closeBracket) {
    if (source.slice(closeDollars + 2, labelMatch.index).trim() !== "") return null;
    const openDollars = beforeMath.lastIndexOf("$$", closeDollars - 1);
    if (openDollars >= 0) {
      return beforeMath.slice(openDollars, closeDollars + 2);
    }
  }

  if (closeBracket >= 0) {
    if (source.slice(closeBracket + 2, labelMatch.index).trim() !== "") return null;
    const openBracket = beforeMath.lastIndexOf("\\[", closeBracket - 1);
    if (openBracket >= 0) {
      return beforeMath.slice(openBracket, closeBracket + 2);
    }
  }
  return null;
}

function findReaderHeadingPreviewSource(source: string, key: string): string | null {
  const escapedKey = escapeRegExpLiteral(key);
  const pattern = new RegExp(String.raw`^#{1,6}\s+.*\{[^}\n]*#${escapedKey}[^}\n]*\}\s*$`, "m");
  return pattern.exec(source)?.[0] ?? null;
}

function findReaderFencedDivPreviewSource(source: string, key: string): string | null {
  const lines = source.split(/\r?\n/);
  const idNeedle = `#${key}`;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const fence = /^(:{3,})\s+/.exec(line);
    if (!fence || !line.includes(idNeedle)) continue;

    const fenceMarker = fence[1];
    const blockLines = [line];
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j] ?? "";
      blockLines.push(next);
      if (next.trim() === fenceMarker) {
        return blockLines.join("\n");
      }
    }
    return blockLines.join("\n");
  }
  return null;
}

function stripBracedLabelId(source: string, key: string): string {
  const escapedKey = escapeRegExpLiteral(key);
  return source.replace(new RegExp(String.raw`\s*\{[^}\n]*#${escapedKey}[^}\n]*\}\s*$`), "");
}

function fencedDivBodySource(source: string): string {
  const lines = source.split(/\r?\n/);
  if (lines.length < 2) return source;
  const openingFence = /^(:{3,})\s+/.exec(lines[0] ?? "");
  if (!openingFence) return source;
  let closingIndex = -1;
  for (let index = lines.length - 1; index > 0; index -= 1) {
    if ((lines[index] ?? "").trim() === openingFence[1]) {
      closingIndex = index;
      break;
    }
  }
  const bodyLines = lines.slice(1, closingIndex > 0 ? closingIndex : undefined);
  const body = bodyLines.join("\n").trim();
  return body || source;
}

function buildReaderSourcePreview(
  key: string,
  source: string | undefined,
  context: DocumentContext | undefined,
  mathMacros: Record<string, string> | undefined,
  label: string,
): HTMLElement | null {
  if (!source) return null;

  const equationSource = findReaderEquationPreviewSource(source, key);
  if (equationSource) {
    const container = createReaderHoverContainer();
    container.appendChild(createReaderHoverHeader(label || key));
    container.appendChild(renderReaderPreviewSource(stripBracedLabelId(equationSource, key), context, mathMacros));
    return container;
  }

  const fencedDivSource = findReaderFencedDivPreviewSource(source, key);
  if (fencedDivSource) {
    const container = createReaderHoverContainer();
    container.appendChild(createReaderHoverHeader(label || key));
    container.appendChild(renderReaderPreviewSource(fencedDivBodySource(fencedDivSource), context, mathMacros));
    return container;
  }

  const headingSource = findReaderHeadingPreviewSource(source, key);
  if (headingSource) {
    const container = createReaderHoverContainer();
    container.appendChild(createReaderHoverHeader(label || key));
    container.appendChild(renderReaderPreviewSource(stripBracedLabelId(headingSource, key), context, mathMacros, {
      sectionNumbering: false,
    }));
    return container;
  }

  return null;
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
        return createReaderElementPreview(customPreview);
      }
      if (typeof customPreview === "string" && customPreview.trim() !== "") {
        return createReaderTextPreview(customPreview);
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
      ) ?? createReaderUnresolvedPreview(key);
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

  for (const el of Array.from(placeholders)) {
    if (el.getAttribute("data-math-hydrated") === "true") continue;
    const latex = el.getAttribute("data-math");
    if (latex === null) continue;

    const isDisplay = el.classList.contains(DOCUMENT_SURFACE_CLASS.displayMath);
    let html: string;
    html = katex.renderToString(latex, {
      displayMode: isDisplay,
      throwOnError: false,
      output: isDisplay ? "htmlAndMathml" : "html",
      ...(macros ? { macros: { ...macros } } : {}),
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
}
