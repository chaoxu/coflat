/**
 * `@chaoxu/coflat/reader` — read-only renderer for FORMAT.md.
 *
 * See READER.md and THEMING.md for the public contract.
 *
 * Node-importable: no `@codemirror/view`, no React, no KaTeX, no pdfjs,
 * no citation-js.
 */

import { parser as baseMarkdownParser } from "@lezer/markdown";
import type { SyntaxNode, Tree } from "@lezer/common";
import createDOMPurify from "dompurify";

import { htmlRenderExtensions, parseFrontmatter } from "../core/parser";
import { NODE } from "../core/constants/node-types";
import { isSafeUrl } from "../core/lib/url-utils";
import {
  BRACKETED_REFERENCE_EXACT_RE,
  parseReferenceClusterBody,
} from "../core/lib/reference-grammar";
import { getBlockManifestEntry } from "../core/constants/block-manifest";
import {
  CSS,
  hostReferenceClassNames,
  mathSurfaceClassNames,
} from "../core/constants/css-classes";
import { LINK_LAYOUT_ATTRIBUTE, linkLayoutForHref } from "../core/link-layout";
import { readBracedLabelId } from "../core/parser/label-utils";
import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "../core/document-surface-classes";
import {
  createPreviewSurfaceBody,
  createPreviewSurfaceContent,
  createPreviewSurfaceHeader,
} from "../core/preview-surface";
import { extractDivClass } from "../core/parser/fenced-div-attrs";
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

let _markdownParser: ReturnType<typeof baseMarkdownParser.configure> | null = null;
function getMarkdownParser() {
  if (!_markdownParser) {
    _markdownParser = baseMarkdownParser.configure(htmlRenderExtensions);
  }
  return _markdownParser;
}

function parseSource(source: string): Tree {
  noteLezerInvocation();
  return getMarkdownParser().parse(source);
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

function escapeHtml(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    switch (c) {
      case 38: out += "&amp;"; break;   // &
      case 60: out += "&lt;"; break;    // <
      case 62: out += "&gt;"; break;    // >
      case 34: out += "&quot;"; break;  // "
      case 39: out += "&#39;"; break;   // '
      default: out += s[i];
    }
  }
  return out;
}

function headingClasses(level: number, unnumbered = false): string {
  return documentSurfaceClassNames(
    DOCUMENT_SURFACE_CLASS.heading,
    DOCUMENT_SURFACE_CLASS.headingLevel(level),
    unnumbered && "cf-doc-heading--unnumbered",
  );
}

const paragraphClasses = DOCUMENT_SURFACE_CLASS.paragraph;

function listClasses(ordered: boolean, isTaskList: boolean, isLoose: boolean): string {
  return documentSurfaceClassNames(
    DOCUMENT_SURFACE_CLASS.list,
    ordered ? DOCUMENT_SURFACE_CLASS.listOrdered : DOCUMENT_SURFACE_CLASS.listUnordered,
    isTaskList && DOCUMENT_SURFACE_CLASS.listCheck,
    isLoose ? DOCUMENT_SURFACE_CLASS.listLoose : DOCUMENT_SURFACE_CLASS.listTight,
  );
}

function blockClasses(type: string | undefined): string {
  return documentSurfaceClassNames(
    DOCUMENT_SURFACE_CLASS.block,
    type && DOCUMENT_SURFACE_CLASS.blockType(type),
  );
}

function blockTitle(type: string): string {
  const entry = getBlockManifestEntry(type);
  if (entry?.title) return entry.title;
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function blockCounterGroup(type: string): string | null {
  const entry = getBlockManifestEntry(type);
  if (!entry?.numbered) return null;
  return entry.counterGroup ?? type;
}

function nextBlockNumber(ctx: WalkContext, type: string): number | undefined {
  const counterGroup = blockCounterGroup(type);
  if (!counterGroup) return undefined;
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
    headingCounters: [...ctx.headingCounters],
    blockCounters: new Map(ctx.blockCounters),
    footnotesById: new Map(),
    footnotesInOrder: [],
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
  const header = number === undefined ? blockTitle(type) : `${blockTitle(type)} ${number}`;
  const escapedHeader = escapeHtml(type === "proof" ? "Proof" : header);
  if (!title || type === "proof") {
    return {
      html: `<span class="cf-block-header-rendered">${escapedHeader}</span>`,
      text: header,
      hasMath: false,
    };
  }
  const renderedTitle = renderInlineSnippet(ctx, title);
  return (
    {
      html:
        `<span class="cf-block-header-rendered">${escapedHeader}</span>` +
        `<span class="cf-block-attr-title">` +
        `<span class="cf-block-title-paren">(</span>` +
        `<span>${renderedTitle.html}</span>` +
        `<span class="cf-block-title-paren">)</span>` +
        `</span>`,
      text: `${header} (${renderedTitle.text})`,
      hasMath: renderedTitle.hasMath,
    }
  );
}

function renderBlockDisclosure(summaryHtml: string, bodyHtml: string): string {
  return (
    `<div class="cf-doc-block-heading">` +
    `<button class="${CSS.blockDisclosureToggle}" type="button" aria-expanded="true" aria-label="Collapse block">▼</button>` +
    `<span class="${CSS.blockHeadingContent}">${summaryHtml}</span>` +
    `</div>` +
    `<div class="${CSS.blockDisclosureBody}">${bodyHtml}</div>`
  );
}

function isCollapsibleBlock(type: string): boolean {
  const entry = getBlockManifestEntry(type);
  return entry?.latexExportKind === "environment" && entry.displayHeader !== false;
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

function renderProofBlockHtml(attrs: string, sourceAttrs: string, summaryHtml: string, bodyHtml: string): string {
  const firstParagraph = bodyHtml.match(/^<p\b([^>]*)>/);
  if (!firstParagraph?.[1] || !/\bclass="[^"]*\bcf-doc-paragraph\b[^"]*"/.test(firstParagraph[1])) {
    return (
      `<div${attrs}${sourceAttrs}>` +
      `<p class="${paragraphClasses}"><span class="cf-doc-block-heading">${summaryHtml}</span></p>` +
      bodyHtml +
      `</div>`
    );
  }
  const openEnd = firstParagraph[0].length - 1;
  const closeStart = bodyHtml.indexOf("</p>", openEnd + 1);
  if (closeStart < 0) {
    return (
      `<div${attrs}${sourceAttrs}>` +
      `<p class="${paragraphClasses}"><span class="cf-doc-block-heading">${summaryHtml}</span></p>` +
      bodyHtml +
      `</div>`
    );
  }
  const paragraphAttrs = firstParagraph[1];
  const firstInner = bodyHtml.slice(openEnd + 1, closeStart).replace(/^\s+/, "");
  const rest = bodyHtml.slice(closeStart + "</p>".length);
  return (
    `<div${attrs}${sourceAttrs}>` +
    `<p${paragraphAttrs}>` +
    `<span class="cf-doc-block-heading">${summaryHtml}</span>` +
    firstInner +
    `</p>` +
    rest +
    `</div>`
  );
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
// Line-number pre-pass for `data-source-line` attribution.
//
// Returns 1-based line number for any source offset via binary search.
// ---------------------------------------------------------------------------

function buildLineOffsets(source: string): Uint32Array {
  // Offsets of the start of each line. Line 1 starts at offset 0.
  const offsets: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) offsets.push(i + 1);
  }
  return Uint32Array.from(offsets);
}

function lineAt(offsets: Uint32Array, pos: number): number {
  // Binary search for the largest i s.t. offsets[i] <= pos.
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (offsets[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

// ---------------------------------------------------------------------------
// Walker types.
// ---------------------------------------------------------------------------

interface Resolvers {
  linkResolver?: LinkResolver;
  refResolver?: RefResolver;
  citationFormatter?: CitationFormatter;
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
  headingCounters: number[];
  blockCounters: Map<string, number>;
  equationCounter: number;
  // Footnote tracking
  footnotesById: Map<string, FootnoteEntry>;
  footnotesInOrder: FootnoteEntry[];
}

function sourcePosAttrs(ctx: WalkContext, from: number, to: number): string {
  if (!ctx.sourcePositions) return "";
  return ` data-source-from="${from}" data-source-to="${to}"`;
}

function mathSourcePosAttrs(ctx: WalkContext, from: number, to: number): string {
  if (!ctx.mathSourcePositions) return "";
  return ` data-source-from="${from}" data-source-to="${to}"`;
}

function linkLayoutAttr(href: string): string {
  return ` ${LINK_LAYOUT_ATTRIBUTE}="${linkLayoutForHref(href)}"`;
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
      html += `<span class="cf-text" data-source-from="${sliceFrom}" data-source-to="${sliceTo}">${escapeHtml(slice)}</span>`;
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
      return { html: `<em${sp}>${inner.html}</em>`, text: inner.text, hasMath: inner.hasMath };
    }
    case NODE.StrongEmphasis: {
      const inner = renderInline(ctx, node, node.from, node.to);
      const sp = sourcePosAttrs(ctx, node.from, node.to);
      return { html: `<strong${sp}>${inner.html}</strong>`, text: inner.text, hasMath: inner.hasMath };
    }
    case NODE.Strikethrough: {
      const inner = renderInline(ctx, node, node.from, node.to);
      const sp = sourcePosAttrs(ctx, node.from, node.to);
      return { html: `<del${sp}>${inner.html}</del>`, text: inner.text, hasMath: inner.hasMath };
    }
    case NODE.Highlight: {
      const inner = renderInline(ctx, node, node.from, node.to);
      const sp = sourcePosAttrs(ctx, node.from, node.to);
      return {
        html: `<mark class="cf-highlight"${sp}>${inner.html}</mark>`,
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
        html: `<code class="${DOCUMENT_SURFACE_CLASS.codeToken}"${sp}>${escapeHtml(inner)}</code>`,
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
          html: `<a href="${escapeHtml(href)}"${linkLayoutAttr(href)}${sp}>${escapeHtml(href)}</a>`,
          text: href,
          hasMath: false,
        };
      }
      if (ctx.sourcePositions) {
        return {
          html: `<span class="cf-text"${sp}>${escapeHtml(href)}</span>`,
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
      const safeId = encodeURIComponent(id);
      const sp = sourcePosAttrs(ctx, node.from, node.to);
      return {
        html:
          `<sup class="cf-footnote-ref"${sp}>` +
          `<a href="#fn-${escapeHtml(safeId)}" id="fnref-${escapeHtml(safeId)}">${entry.number}</a>` +
          `</sup>`,
        text: `[${entry.number}]`,
        hasMath: false,
      };
    }
    case NODE.Escape: {
      const raw = source.slice(node.from, node.to);
      const ch = raw.length >= 2 ? raw.slice(1) : raw;
      if (ctx.sourcePositions) {
        const sp = sourcePosAttrs(ctx, node.from, node.to);
        return { html: `<span class="cf-text"${sp}>${escapeHtml(ch)}</span>`, text: ch, hasMath: false };
      }
      return { html: escapeHtml(ch), text: ch, hasMath: false };
    }
    case NODE.Text: {
      const raw = source.slice(node.from, node.to);
      if (ctx.sourcePositions) {
        const sp = sourcePosAttrs(ctx, node.from, node.to);
        return { html: `<span class="cf-text"${sp}>${escapeHtml(raw)}</span>`, text: raw, hasMath: false };
      }
      return { html: escapeHtml(raw), text: raw, hasMath: false };
    }
  }

  // Unknown inline node — fall back to its source text.
  const raw = source.slice(node.from, node.to);
  if (ctx.sourcePositions) {
    const sp = sourcePosAttrs(ctx, node.from, node.to);
    return { html: `<span class="cf-text"${sp}>${escapeHtml(raw)}</span>`, text: raw, hasMath: false };
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

  let attrs = ` href="${escapeHtml(href)}"${linkLayoutAttr(href)}`;
  if (className) attrs += ` class="${escapeHtml(className)}"`;
  if (title) attrs += ` title="${escapeHtml(title)}"`;
  attrs += sourcePosAttrs(ctx, node.from, node.to);
  return {
    html: `<a${attrs}>${label.html}</a>`,
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
    return `<a href="${escapeHtml(resolved.href)}"${linkLayoutAttr(resolved.href)}>${resolved.content}</a>`;
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

  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
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

  const inner = parts.join("");
  const html = ctx.sourcePositions
    ? `<span class="cf-citation-cluster"${sourcePosAttrs(ctx, from, to)}>${inner}</span>`
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
        html: `<span class="cf-text"${sp}>${escapeHtml(alt)}</span>`,
        text: alt,
        hasMath: false,
      };
    }
    return { html: escapeHtml(alt), text: alt, hasMath: false };
  }
  return {
    html: `<img class="cf-image" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${sp}>`,
    text: alt,
    hasMath: false,
  };
}

// ---------------------------------------------------------------------------
// Block rendering.
// ---------------------------------------------------------------------------

type TruncateSpec = { lines: number } | { chars: number };

interface RenderOptions {
  /** If true, emit `data-source-line` on every block-level element. */
  sourceLineAttribution?: boolean;
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
}

interface TruncatedInfo {
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
        html: `<hr class="${blockClasses("hr")}"${blockSourceAttrs(ctx, node.from, node.to)}>`,
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
      const classes = mathSurfaceClassNames(
        true,
        equationNumber !== undefined && CSS.mathDisplayNumbered,
      );
      const idAttr = equationId ? ` id="${escapeHtml(equationId)}"` : "";
      const numberAttr = equationNumber !== undefined
        ? ` data-equation-number="${equationNumber}"`
        : "";
      return {
        html:
          `<div class="${classes}"${idAttr} data-math="${escapeHtml(inner)}"${numberAttr}${blockMathSourceAttrs(ctx, node.from, node.to)}>` +
          escapeHtml(raw) +
          `</div>`,
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

function renderHeading(ctx: WalkContext, node: SyntaxNode, level: number): BlockResult {
  // Skip the HeaderMark child(ren) by rendering inline over [contentStart, contentEnd).
  // For ATX, content starts after `#+` and optional space; for Setext, content is
  // the line before the `===`/`---` underline.
  let contentFrom = node.from;
  let contentTo = node.to;

  const headerMark = node.getChild("HeaderMark");
  if (headerMark && headerMark.from === node.from) {
    // ATX: skip leading marks + one space.
    contentFrom = headerMark.to;
    while (contentFrom < contentTo && ctx.source[contentFrom] === " ") contentFrom++;
    // Strip trailing closing `#+` and whitespace.
    while (contentTo > contentFrom && ctx.source[contentTo - 1] === " ") contentTo--;
    // The Lezer tree may include a closing HeaderMark child at the end.
    const trailing = node.lastChild;
    if (trailing && trailing.name === "HeaderMark" && trailing.from !== headerMark.from) {
      contentTo = trailing.from;
      while (contentTo > contentFrom && ctx.source[contentTo - 1] === " ") contentTo--;
    }
  } else if (headerMark && headerMark.from > node.from) {
    // Setext: content is everything before the underline mark.
    contentTo = headerMark.from;
    while (contentTo > contentFrom && /\s/.test(ctx.source[contentTo - 1] ?? "")) contentTo--;
  }

  const attrs = parsePandocHeadingAttributes(ctx.source, contentFrom, contentTo);
  if (attrs) contentTo = attrs.contentTo;

  const inner = renderInline(ctx, node, contentFrom, contentTo);
  const headingNumber = nextHeadingNumber(ctx, level, !!attrs?.unnumbered);
  const numberingAttr = attrs?.unnumbered
    ? ' data-heading-numbering="none"'
    : ` data-section-number="${headingNumber}"`;
  return {
    html: `<h${level} class="${headingClasses(level, attrs?.unnumbered)}"${numberingAttr}${blockSourceAttrs(ctx, node.from, node.to)}>${inner.html}</h${level}>`,
    text: inner.text,
    hasMath: inner.hasMath,
  };
}

interface HeadingAttributeInfo {
  contentTo: number;
  unnumbered: boolean;
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
  return {
    contentTo: strippedTo,
    unnumbered: tokens.includes("-") || tokens.includes(".unnumbered"),
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
    html: `<p class="${paragraphClasses}"${blockSourceAttrs(ctx, node.from, node.to)}>${html}</p>`,
    text: inner.text.replace(/^\s+/, "").replace(/\s+$/, ""),
    hasMath: inner.hasMath,
  };
}

function renderList(ctx: WalkContext, node: SyntaxNode, ordered: boolean): BlockResult {
  const items: BlockResult[] = [];
  let isTaskList = false;
  let isLoose = false;
  const startNumber = ordered ? orderedListStart(ctx, node) : 1;
  let itemIndex = 0;

  // Detect loose by checking for blank-line gaps between items.
  let prevItem: SyntaxNode | null = null;
  let child = node.firstChild;
  while (child) {
    if (child.name === NODE.ListItem) {
      if (prevItem) {
        const between = ctx.source.slice(prevItem.to, child.from);
        if (/\n\s*\n/.test(between)) isLoose = true;
      }
      const item = renderListItem(ctx, child, ordered, startNumber + itemIndex);
      itemIndex++;
      if (item.html.includes(DOCUMENT_SURFACE_CLASS.listItemCheck)) isTaskList = true;
      items.push(item);
      prevItem = child;
    }
    child = child.nextSibling;
  }

  // Detect start number for ordered lists.
  let startAttr = "";
  if (ordered) {
    if (startNumber !== 1) startAttr = ` start="${startNumber}"`;
  }

  const tag = ordered ? "ol" : "ul";
  return {
    html:
      `<${tag} class="${listClasses(ordered, isTaskList, isLoose)}"${startAttr}${blockSourceAttrs(ctx, node.from, node.to)}>` +
      items.map((b) => b.html).join("") +
      `</${tag}>`,
    text: items.map((b) => b.text).join("\n"),
    hasMath: items.some((b) => b.hasMath),
  };
}

function orderedListStart(ctx: WalkContext, node: SyntaxNode): number {
  const firstItem = node.getChild(NODE.ListItem);
  if (!firstItem) return 1;
  const mark = firstItem.getChild("ListMark");
  if (!mark) return 1;
  const markText = ctx.source.slice(mark.from, mark.to);
  const m = markText.match(/(\d+)/);
  if (!m) return 1;
  const n = parseInt(m[1], 10);
  return Number.isNaN(n) ? 1 : n;
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
        task = { checked: /\[[xX]\]/.test(raw) };
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
          html: `<p class="${paragraphClasses}"${blockSourceAttrs(ctx, child.from, child.to)}>${inner.html.replace(/^\s+/, "").replace(/\s+$/, "")}</p>`,
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

  const classes: string[] = [DOCUMENT_SURFACE_CLASS.listItem];
  let dataAttrs = "";
  if (task) {
    classes.push(DOCUMENT_SURFACE_CLASS.listItemCheck);
    dataAttrs = ` data-checked="${task.checked}"`;
    const cb = `<input type="checkbox" tabindex="-1" aria-disabled="true"${task.checked ? " checked" : ""}> `;
    inner = cb + inner;
    text = (task.checked ? "[x] " : "[ ] ") + text;
  }
  const marker = ordered
    ? `<span class="cf-list-number">${number}.</span> `
    : `<span class="cf-list-bullet">•</span> `;
  return {
    html: `<li class="${classes.join(" ")}"${dataAttrs}${blockSourceAttrs(ctx, node.from, node.to)}>${marker}${inner}</li>`,
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
    html:
      `<blockquote class="${DOCUMENT_SURFACE_CLASS.blockquote}"${blockSourceAttrs(ctx, node.from, node.to)}>` +
      blocks.map((b) => b.html).join("") +
      `</blockquote>`,
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
  const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : "";
  return {
    html:
      `<pre class="${DOCUMENT_SURFACE_CLASS.codeBlock}"${langAttr}${blockSourceAttrs(ctx, node.from, node.to)}>` +
      `<code>${escapeHtml(code)}</code></pre>`,
    text: code,
    hasMath: false,
  };
}

function renderIndentedCode(ctx: WalkContext, node: SyntaxNode): BlockResult {
  const code = ctx.source.slice(node.from, node.to).replace(/^( {4}|\t)/gm, "");
  return {
    html:
      `<pre class="${DOCUMENT_SURFACE_CLASS.codeBlock}"${blockSourceAttrs(ctx, node.from, node.to)}>` +
      `<code>${escapeHtml(code)}</code></pre>`,
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
    html: `<table class="${DOCUMENT_SURFACE_CLASS.tableBlock}"${blockSourceAttrs(ctx, node.from, node.to)}>${inner}</table>`,
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
    return raw.split("|").map((c) => c.trim()).filter((c) => c.includes("-")).map((c) => {
      const left = c.startsWith(":");
      const right = c.endsWith(":");
      if (left && right) return "center";
      if (right) return "right";
      if (left) return "left";
      return null;
    });
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
    const classes = documentSurfaceClassNames(
      DOCUMENT_SURFACE_CLASS.tableCell,
      isHeader && DOCUMENT_SURFACE_CLASS.tableHeader,
    );
    const align = aligns[idx];
    const styleAttr = align ? ` style="text-align:${align}"` : "";
    const alignAttr = align ? ` data-align="${align}"` : "";
    cellHtmls.push(`<${tag} class="${classes}"${alignAttr}${styleAttr}>${inner.html}</${tag}>`);
    cellTexts.push(inner.text);
  });
  return {
    rowHtml: `<tr class="${DOCUMENT_SURFACE_CLASS.tableRow}"${blockSourceAttrs(ctx, row.from, row.to)}>${cellHtmls.join("")}</tr>`,
    rowText: cellTexts.join("\t"),
  };
}

function blankLineRangesBetweenBlocks(source: string, from: number, to: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let pos = from;

  if (pos > 0 && source[pos - 1] !== "\n") {
    while (pos < to && source[pos] !== "\n") pos++;
    if (pos < to) pos++;
  }

  while (pos < to) {
    const lineStart = pos;
    while (pos < to && source[pos] !== "\n") pos++;
    if (pos >= to) break;

    const lineEnd = source[pos - 1] === "\r" ? pos - 1 : pos;
    if (/^[ \t]*$/.test(source.slice(lineStart, lineEnd))) {
      ranges.push([lineStart, pos + 1]);
    }
    pos++;
  }

  return ranges;
}

function renderBlankLine(ctx: WalkContext, from: number, to: number): BlockResult {
  return {
    html: `<div class="${DOCUMENT_SURFACE_CLASS.blankLine}" aria-hidden="true"${blockSourceAttrs(ctx, from, to)}><br></div>`,
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
  let child = node.firstChild;
  while (child) {
    if (
      child.name === NODE.FencedDivFence ||
      child.name === NODE.FencedDivAttributes ||
      child.name === "FencedDivTitle"
    ) {
      child = child.nextSibling;
      continue;
    }
    if (previousRenderable && child.from > previousRenderable.to) {
      for (const [from, to] of blankLineRangesBetweenBlocks(ctx.source, previousRenderable.to, child.from)) {
        blocks.push(renderBlankLine(ctx, from, to));
      }
    }
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
    manifestEntry?.headerPosition !== "inline" &&
    isCollapsibleBlock(normalizedClassName),
  );
  const classes = [blockClasses(normalizedClassName || undefined)];
  if (collapsibleBlock) classes.push(CSS.blockCollapsible);

  let attrs = ` class="${classes.join(" ")}"`;
  if (id) attrs += ` id="${escapeHtml(id)}"`;
  for (const [k, v] of Object.entries(kvs)) {
    attrs += ` data-${escapeHtml(k)}="${escapeHtml(v)}"`;
  }
  const body = combineBlocks(blocks);
  const bodyHtml = body.html;
  const sourceAttrs = blockSourceAttrs(ctx, node.from, node.to);
  const title = kvs.title;
  const number = normalizedClassName ? nextBlockNumber(ctx, normalizedClassName) : undefined;
  const summary = normalizedClassName
    ? renderBlockSummary(ctx, normalizedClassName, title, number)
    : emptyBlock();
  const summaryHtml = summary.html;
  const html = manifestEntry?.headerPosition === "inline"
    ? renderProofBlockHtml(attrs, sourceAttrs, summaryHtml, bodyHtml)
    : collapsibleBlock
    ? `<div${attrs}${sourceAttrs} data-cf-block-open="true">${renderBlockDisclosure(summaryHtml, bodyHtml)}</div>`
    : `<div${attrs}${sourceAttrs}>${bodyHtml}</div>`;

  return {
    html,
    text: body.text,
    hasMath: summary.hasMath || body.hasMath,
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
  const items: string[] = [];
  for (const fn of ctx.footnotesInOrder) {
    if (!fn.hasRef && !fn.bodyHtml) continue;
    const safeId = encodeURIComponent(fn.id);
    const back = ` <a href="#fnref-${escapeHtml(safeId)}" class="cf-footnote-backref">↩</a>`;
    items.push(
      `<li id="fn-${escapeHtml(safeId)}" class="cf-footnote-item">${fn.bodyHtml}${back}</li>`,
    );
  }
  if (items.length === 0) return "";
  return `<ol class="cf-footnotes">${items.join("")}</ol>`;
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
): BlockResult & { truncated?: TruncatedInfo } {
  const frontmatter = parseFrontmatter(source);
  const frontmatterEnd = frontmatter.end;
  const ctx: WalkContext = {
    source,
    resolvers,
    lineOffsets: opts.sourceLineAttribution ? buildLineOffsets(source) : null,
    sourcePositions: !!opts.sourcePositions,
    mathSourcePositions: !!(opts.sourcePositions || opts.mathSourcePositions),
    headingCounters: [0, 0, 0, 0, 0, 0, 0],
    blockCounters: new Map(),
    equationCounter: 0,
    footnotesById: new Map(),
    footnotesInOrder: [],
  };

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
    const renderedTitle = renderToHtml(title);
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
    const trailingRanges = previousRenderable.to < source.length
      ? blankLineRangesBetweenBlocks(ctx.source, previousRenderable.to, source.length)
      : [];
    for (const [from, to] of trailingRanges) {
      blocks.push(renderBlankLine(ctx, from, to));
    }
    const trailingNewlines = source.match(/\n+$/)?.[0].length ?? 0;
    const missingTrailingRanges = Math.max(0, trailingNewlines - trailingRanges.length);
    for (let index = 0; index < missingTrailingRanges; index++) {
      const from = source.length - missingTrailingRanges + index;
      blocks.push(renderBlankLine(ctx, from, from + 1));
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
    const marker = `<span class="cf-truncation-marker" data-source-from="${truncated.sourceFrom}" data-source-to="${truncated.sourceTo}"></span>`;
    combined = {
      html: combined.html + marker,
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
  return { ...combined, truncated };
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
  "em", "strong", "del", "mark",
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
 */
export function renderToHtml(
  source: string,
  ctx?: DocumentContext,
  opts: RenderOptions = {},
): { html: string; hasMath: boolean; truncated?: TruncatedInfo } {
  const resolvers = buildResolvers(ctx, opts.documentPath);

  if (
    !FAST_PATH_RE.test(source) &&
    !opts.sourceLineAttribution &&
    !opts.sourcePositions &&
    !opts.truncate
  ) {
    const fast = fastRenderInline(source);
    return { html: sanitize(fast.html), hasMath: false };
  }

  const tree = parseSource(source);
  const result = walkDocument(source, tree, resolvers, opts);
  const out: { html: string; hasMath: boolean; truncated?: TruncatedInfo } = {
    html: sanitize(result.html),
    hasMath: result.hasMath,
  };
  if (result.truncated) out.truncated = result.truncated;
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
// Block disclosure hydration.
// ---------------------------------------------------------------------------

const BLOCK_DISCLOSURE_HYDRATED_ATTR = "data-cf-block-disclosure-hydrated";
const BLOCK_OPEN_ATTR = "data-cf-block-open";
const BLOCK_DISCLOSURE_OPEN_ICON = "▼";
const BLOCK_DISCLOSURE_CLOSED_ICON = "▶";

function directChildWithClass(parent: HTMLElement, className: string): HTMLElement | null {
  for (const child of Array.from(parent.children)) {
    if (child instanceof HTMLElement && child.classList.contains(className)) return child;
  }
  return null;
}

function blockDisclosureParts(block: HTMLElement): {
  body: HTMLElement;
  toggle: HTMLButtonElement;
} | null {
  const heading = directChildWithClass(block, "cf-doc-block-heading");
  const body = directChildWithClass(block, CSS.blockDisclosureBody);
  const toggle = heading?.querySelector<HTMLElement>(`.${CSS.blockDisclosureToggle}`);
  if (!(body instanceof HTMLElement) || !(toggle instanceof HTMLButtonElement)) return null;
  return { body, toggle };
}

function setBlockDisclosureState(block: HTMLElement, expanded: boolean): void {
  const parts = blockDisclosureParts(block);
  if (!parts) return;
  block.setAttribute(BLOCK_OPEN_ATTR, expanded ? "true" : "false");
  parts.body.hidden = !expanded;
  parts.toggle.textContent = expanded ? BLOCK_DISCLOSURE_OPEN_ICON : BLOCK_DISCLOSURE_CLOSED_ICON;
  parts.toggle.classList.toggle(CSS.blockDisclosureToggleCollapsed, !expanded);
  parts.toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  parts.toggle.setAttribute("aria-label", expanded ? "Collapse block" : "Expand block");
}

/**
 * Attach disclosure behavior to static reader block headers.
 *
 * `renderToHtml` emits normal header text plus a triangle button. This
 * hydration pass is intentionally narrow: only the triangle toggles the block,
 * so selecting or clicking the header label itself never collapses content.
 */
export function hydrateBlockDisclosures(root: HTMLElement): void {
  const blocks = [
    ...(root.classList.contains(CSS.blockCollapsible) ? [root] : []),
    ...Array.from(root.querySelectorAll<HTMLElement>(`.${CSS.blockCollapsible}`)),
  ];

  for (const block of blocks) {
    const parts = blockDisclosureParts(block);
    if (!parts) continue;
    const expanded = block.getAttribute(BLOCK_OPEN_ATTR) !== "false";
    setBlockDisclosureState(block, expanded);

    if (block.getAttribute(BLOCK_DISCLOSURE_HYDRATED_ATTR) === "true") continue;
    parts.toggle.addEventListener("click", () => {
      setBlockDisclosureState(block, block.getAttribute(BLOCK_OPEN_ATTR) === "false");
    });
    block.setAttribute(BLOCK_DISCLOSURE_HYDRATED_ATTR, "true");
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

  el.classList.remove("cf-citation-unresolved", "cf-crossref-unresolved");
  el.classList.add(...hostReferenceClassNames(resolved.className).split(/\s+/));
  if (resolved.href && isSafeUrl(resolved.href)) {
    el.innerHTML = sanitize(
      `<a href="${escapeHtml(resolved.href)}"${linkLayoutAttr(resolved.href)}>${resolved.content}</a>`,
    );
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
    el.setAttribute("href", resolved.href);
    el.setAttribute(LINK_LAYOUT_ATTRIBUTE, linkLayoutForHref(resolved.href));
  }
  if (resolved.className) {
    el.classList.add(...resolved.className.split(/\s+/).filter(Boolean));
  }
  if (resolved.title !== undefined) {
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
      ".cf-citation-unresolved[data-ref-key], .cf-crossref-unresolved[data-ref-key]",
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
  readonly source?: string;
}

type HoverTooltipModule = typeof import("../core/hover-tooltip");

const readerHoverCacheScope = {};

function createReaderHoverContainer(): HTMLElement {
  return createPreviewSurfaceContent(CSS.hoverPreview);
}

function createReaderHoverHeader(text: string): HTMLElement {
  const header = createPreviewSurfaceHeader(CSS.hoverPreviewHeader);
  header.textContent = text;
  return header;
}

function createReaderHoverBody(): HTMLElement {
  return createPreviewSurfaceBody(CSS.hoverPreviewBody);
}

function createReaderUnresolvedPreview(key: string): HTMLElement {
  const container = createReaderHoverContainer();
  container.appendChild(createReaderHoverHeader(`Unresolved: ${key}`));
  return container;
}

function createReaderTextPreview(preview: string): HTMLElement {
  const container = createReaderHoverContainer();
  const body = createPreviewSurfaceBody(CSS.hoverPreviewCitation);
  body.textContent = preview;
  container.appendChild(body);
  return container;
}

function createReaderElementPreview(preview: HTMLElement): HTMLElement {
  const container = createReaderHoverContainer();
  container.appendChild(preview);
  return container;
}

function renderReaderPreviewSource(
  source: string,
  context: DocumentContext | undefined,
  mathMacros: Record<string, string> | undefined,
): HTMLElement {
  const body = createReaderHoverBody();
  body.innerHTML = renderToHtml(source, context).html;
  void hydrateMath(body, { mathMacros: mathMacros ?? context?.mathMacros });
  return body;
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
    const openDollars = beforeMath.lastIndexOf("$$", closeDollars - 1);
    if (openDollars >= 0) {
      return beforeMath.slice(openDollars, closeDollars + 2);
    }
  }

  if (closeBracket >= 0) {
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
    container.appendChild(renderReaderPreviewSource(equationSource, context, mathMacros));
    return container;
  }

  const blockSource = findReaderFencedDivPreviewSource(source, key)
    ?? findReaderHeadingPreviewSource(source, key);
  if (blockSource) {
    const container = createReaderHoverContainer();
    container.appendChild(renderReaderPreviewSource(blockSource, context, mathMacros));
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
  return {
    buildContent: () => {
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
    key: `reader:hover\0${key}\0${label}\0${options.source ?? ""}`,
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
    void loadTooltipModule().then((module) => module.hideFloatingTooltip());
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
   * NOTE: v1 does NOT auto-extract macros from the document's frontmatter.
   * Hosts that want frontmatter-driven macros must parse the frontmatter
   * themselves and pass the macros explicitly here.
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
    try {
      html = katex.renderToString(latex, {
        displayMode: isDisplay,
        throwOnError: true,
        output: isDisplay ? "htmlAndMathml" : "html",
        ...(macros ? { macros: { ...macros } } : {}),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      el.classList.add("cf-math-error");
      el.setAttribute("data-math-error", message);
      continue;
    }

    if (isDisplay) {
      const content = document.createElement("div");
      content.className = CSS.mathDisplayContent;
      content.innerHTML = html;
      el.replaceChildren(content);
      const equationNumber = el.dataset.equationNumber;
      if (equationNumber) {
        const number = document.createElement("span");
        number.className = CSS.mathDisplayNumber;
        number.textContent = `(${equationNumber})`;
        el.appendChild(number);
      }
    } else {
      el.innerHTML = html;
    }
    el.setAttribute("data-math-hydrated", "true");
  }
}
