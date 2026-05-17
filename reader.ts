/**
 * `@chaoxu/coflat-editor/reader` — read-only renderer for FORMAT.md.
 *
 * Phase 2.1 scope: block-level rendering with semantic `cf-*` class names,
 * footnote collection + backref linking, math placeholders for Phase 2.3
 * hydration, unresolved-ref placeholders, and optional `data-source-line`
 * attribution (issue #3).
 *
 * See READER.md ("Public API", "Fast path", "Sanitization", "Plan", and
 * "Theming") and THEMING.md (class names + CSS custom properties).
 *
 * Node-importable: no `@codemirror/view`, no React, no KaTeX, no pdfjs,
 * no citation-js.
 */

import { parser as baseMarkdownParser } from "@lezer/markdown";
import type { SyntaxNode, Tree } from "@lezer/common";
import createDOMPurify from "dompurify";

import { htmlRenderExtensions } from "./src/core/parser";
import { NODE } from "./src/core/constants/node-types";
import { isSafeUrl } from "./src/core/lib/url-utils";
import {
  BRACKETED_REFERENCE_EXACT_RE,
  parseReferenceClusterBody,
} from "./src/core/lib/reference-grammar";
import { CROSS_REFERENCE_PREFIXES } from "./src/core/constants/block-manifest";
import { extractDivClass } from "./src/core/parser/fenced-div-attrs";
import type {
  DocumentContext,
  LinkResolver,
  RefResolver,
} from "./src/document-context";
import { noteLezerInvocation } from "./src/reader/reader-internal";

export type {
  DocumentContext,
  LinkResolver,
  RefResolver,
} from "./src/document-context";

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
const FAST_PATH_RE = /[$\[:`#^<>\n|-]|^---\n/m;

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

const CROSSREF_PREFIX_SET = new Set(CROSS_REFERENCE_PREFIXES);
function isCrossrefKey(key: string): boolean {
  const colon = key.indexOf(":");
  if (colon <= 0) return false;
  return CROSSREF_PREFIX_SET.has(key.slice(0, colon));
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
  resolveAssetUrl?: (path: string) => string;
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
  // Footnote tracking
  footnotesById: Map<string, FootnoteEntry>;
  footnotesInOrder: FootnoteEntry[];
}

function sourcePosAttrs(ctx: WalkContext, from: number, to: number): string {
  if (!ctx.sourcePositions) return "";
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
        html: `<code class="cf-code-inline"${sp}>${escapeHtml(inner)}</code>`,
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
          html: `<a href="${escapeHtml(href)}"${sp}>${escapeHtml(href)}</a>`,
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
      const sp = sourcePosAttrs(ctx, node.from, node.to);
      return {
        html: `<span class="cf-math cf-math-inline" data-math="${escapeHtml(inner)}"${sp}>${escapeHtml(raw)}</span>`,
        text: raw,
        hasMath: true,
      };
    }
    case NODE.DisplayMath: {
      const raw = source.slice(node.from, node.to);
      const inner = stripMathDelims(raw, true);
      const sp = sourcePosAttrs(ctx, node.from, node.to);
      return {
        html: `<span class="cf-math cf-math-display" data-math="${escapeHtml(inner)}"${sp}>${escapeHtml(raw)}</span>`,
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
      return emitCitationCluster(ctx, parts.map((p) => p.id), raw, node.from, node.to);
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
    const resolved = ctx.resolvers.linkResolver.resolve(href, labelText, {});
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

  let attrs = ` href="${escapeHtml(href)}"`;
  if (className) attrs += ` class="${escapeHtml(className)}"`;
  if (title) attrs += ` title="${escapeHtml(title)}"`;
  attrs += sourcePosAttrs(ctx, node.from, node.to);
  return {
    html: `<a${attrs}>${label.html}</a>`,
    text: label.text,
    hasMath: label.hasMath,
  };
}

function emitCitationCluster(
  ctx: WalkContext,
  ids: string[],
  _raw: string,
  from: number,
  to: number,
): { html: string; text: string; hasMath: boolean } {
  const refResolver = ctx.resolvers.refResolver;
  const parts: string[] = [];
  const textParts: string[] = [];

  for (const id of ids) {
    const isCross = isCrossrefKey(id);
    if (refResolver && !isCross) {
      const resolved = refResolver.resolve(id, "bracketed");
      if (resolved) {
        const cls = `cf-citation${resolved.className ? ` ${resolved.className}` : ""}`;
        const inner = resolved.href && isSafeUrl(resolved.href)
          ? `<a href="${escapeHtml(resolved.href)}">${resolved.content}</a>`
          : resolved.content;
        parts.push(`<span class="${escapeHtml(cls)}" data-ref-key="${escapeHtml(id)}" data-ref-mode="bracketed">${inner}</span>`);
        textParts.push(stripTags(resolved.content));
        continue;
      }
    }
    if (isCross) {
      const prefix = id.slice(0, id.indexOf(":"));
      parts.push(
        `<span class="cf-crossref-unresolved cf-crossref-${escapeHtml(prefix)}" data-ref-key="${escapeHtml(id)}">@${escapeHtml(id)}</span>`,
      );
      textParts.push(`@${id}`);
    } else {
      parts.push(
        `<span class="cf-citation cf-citation-unresolved" data-ref-key="${escapeHtml(id)}" data-ref-mode="bracketed">[@${escapeHtml(id)}]</span>`,
      );
      textParts.push(`[@${id}]`);
    }
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
   *  `<code>`, `<a>`, `<sup class="cf-footnote-ref">`, `<span class="cf-math">`,
   *  citation/crossref spans), and wrap contiguous plain-text runs in
   *  `<span class="cf-text" data-source-from=… data-source-to=…>`. Off by
   *  default — output is byte-identical to the un-opted form. */
  sourcePositions?: boolean;
  /** Block-boundary truncation budget. */
  truncate?: TruncateSpec;
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
        html: `<hr class="cf-hr"${blockSourceAttrs(ctx, node.from, node.to)}>`,
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
      const inner = stripMathDelims(raw, true);
      return {
        html:
          `<div class="cf-math cf-math-display" data-math="${escapeHtml(inner)}"${blockSourceAttrs(ctx, node.from, node.to)}>` +
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

  const inner = renderInline(ctx, node, contentFrom, contentTo);
  return {
    html: `<h${level} class="cf-heading-${level}"${blockSourceAttrs(ctx, node.from, node.to)}>${inner.html}</h${level}>`,
    text: inner.text,
    hasMath: inner.hasMath,
  };
}

function renderParagraph(ctx: WalkContext, node: SyntaxNode): BlockResult {
  const inner = renderInline(ctx, node, node.from, node.to);
  // Trim trailing whitespace/newlines for tidy output.
  const html = inner.html.replace(/\s+$/, "");
  return {
    html: `<p class="cf-paragraph"${blockSourceAttrs(ctx, node.from, node.to)}>${html}</p>`,
    text: inner.text.replace(/\s+$/, ""),
    hasMath: inner.hasMath,
  };
}

function renderList(ctx: WalkContext, node: SyntaxNode, ordered: boolean): BlockResult {
  const items: BlockResult[] = [];
  let isTaskList = false;
  let isLoose = false;

  // Detect loose by checking for blank-line gaps between items.
  let prevItem: SyntaxNode | null = null;
  let child = node.firstChild;
  while (child) {
    if (child.name === NODE.ListItem) {
      if (prevItem) {
        const between = ctx.source.slice(prevItem.to, child.from);
        if (/\n\s*\n/.test(between)) isLoose = true;
      }
      const item = renderListItem(ctx, child);
      if (item.html.includes("cf-list-task")) isTaskList = true;
      items.push(item);
      prevItem = child;
    }
    child = child.nextSibling;
  }

  // Detect start number for ordered lists.
  let startAttr = "";
  if (ordered) {
    // Find the first list-mark on the first ListItem.
    const firstItem = node.getChild(NODE.ListItem);
    if (firstItem) {
      const mark = firstItem.getChild("ListMark");
      if (mark) {
        const markText = ctx.source.slice(mark.from, mark.to);
        const m = markText.match(/(\d+)/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (!isNaN(n) && n !== 1) startAttr = ` start="${n}"`;
        }
      }
    }
  }

  const tag = ordered ? "ol" : "ul";
  const classes: string[] = [
    "cf-list",
    ordered ? "cf-list-ordered" : "cf-list-bullet",
  ];
  if (isTaskList) classes.push("cf-list-task");
  classes.push(isLoose ? "cf-list-loose" : "cf-list-tight");
  return {
    html:
      `<${tag} class="${classes.join(" ")}"${startAttr}${blockSourceAttrs(ctx, node.from, node.to)}>` +
      items.map((b) => b.html).join("") +
      `</${tag}>`,
    text: items.map((b) => b.text).join("\n"),
    hasMath: items.some((b) => b.hasMath),
  };
}

function renderListItem(ctx: WalkContext, node: SyntaxNode): BlockResult {
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
          html: `<p class="cf-paragraph"${blockSourceAttrs(ctx, child.from, child.to)}>${inner.html.replace(/\s+$/, "")}</p>`,
          text: inner.text.replace(/\s+$/, ""),
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
  if (blocks.length === 1 && blocks[0].html.startsWith("<p class=\"cf-paragraph\"")) {
    // Strip outer <p>…</p>.
    inner = blocks[0].html.replace(/^<p class="cf-paragraph"[^>]*>/, "").replace(/<\/p>$/, "");
    text = blocks[0].text;
  } else {
    inner = blocks.map((b) => b.html).join("");
    text = blocks.map((b) => b.text).join("\n");
  }

  const classes: string[] = ["cf-list-item"];
  let dataAttrs = "";
  if (task) {
    classes.push("cf-list-task");
    dataAttrs = ` data-checked="${task.checked}"`;
    const cb = `<input type="checkbox" disabled${task.checked ? " checked" : ""}> `;
    inner = cb + inner;
    text = (task.checked ? "[x] " : "[ ] ") + text;
  }
  return {
    html: `<li class="${classes.join(" ")}"${dataAttrs}${blockSourceAttrs(ctx, node.from, node.to)}>${inner}</li>`,
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
      `<blockquote class="cf-blockquote"${blockSourceAttrs(ctx, node.from, node.to)}>` +
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
      `<pre class="cf-code-block"${langAttr}${blockSourceAttrs(ctx, node.from, node.to)}>` +
      `<code>${escapeHtml(code)}</code></pre>`,
    text: code,
    hasMath: false,
  };
}

function renderIndentedCode(ctx: WalkContext, node: SyntaxNode): BlockResult {
  const code = ctx.source.slice(node.from, node.to).replace(/^( {4}|\t)/gm, "");
  return {
    html:
      `<pre class="cf-code-block"${blockSourceAttrs(ctx, node.from, node.to)}>` +
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
    html: `<table class="cf-table"${blockSourceAttrs(ctx, node.from, node.to)}>${inner}</table>`,
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
    const classes = isHeader ? "cf-table-cell cf-table-header" : "cf-table-cell";
    const align = aligns[idx];
    const styleAttr = align ? ` style="text-align:${align}"` : "";
    const alignAttr = align ? ` data-align="${align}"` : "";
    cellHtmls.push(`<${tag} class="${classes}"${alignAttr}${styleAttr}>${inner.html}</${tag}>`);
    cellTexts.push(inner.text);
  });
  return {
    rowHtml: `<tr class="cf-table-row"${blockSourceAttrs(ctx, row.from, row.to)}>${cellHtmls.join("")}</tr>`,
    rowText: cellTexts.join("\t"),
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
    blocks.push(renderBlock(ctx, child));
    child = child.nextSibling;
  }

  const classes = ["cf-fenced-div"];
  if (className) classes.push(`cf-fenced-${className.toLowerCase()}`);

  let attrs = ` class="${classes.join(" ")}"`;
  if (id) attrs += ` id="${escapeHtml(id)}"`;
  for (const [k, v] of Object.entries(kvs)) {
    attrs += ` data-${escapeHtml(k)}="${escapeHtml(v)}"`;
  }
  return {
    html:
      `<div${attrs}${blockSourceAttrs(ctx, node.from, node.to)}>` +
      blocks.map((b) => b.html).join("") +
      `</div>`,
    text: blocks.map((b) => b.text).join("\n\n"),
    hasMath: blocks.some((b) => b.hasMath),
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
  const ctx: WalkContext = {
    source,
    resolvers,
    lineOffsets: opts.sourceLineAttribution ? buildLineOffsets(source) : null,
    sourcePositions: !!opts.sourcePositions,
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
  let child = root.firstChild;
  let topCount = 0;
  let used = 0;
  let truncated: TruncatedInfo | undefined;

  while (child) {
    if (budgetKind) {
      // Snapshot footnote state so we can roll back if we end up not emitting.
      const fnOrderLen = ctx.footnotesInOrder.length;
      const fnIdSnapshot = new Map(ctx.footnotesById);
      const rendered = renderBlock(ctx, child);
      const cost = budgetKind === "lines"
        ? blockLineCost(source, child)
        : rendered.text.length;
      if (used > 0 && used + cost > budget) {
        // Roll back footnote side-effects, then stop before this block.
        ctx.footnotesInOrder.length = fnOrderLen;
        ctx.footnotesById = fnIdSnapshot;
        truncated = { sourceFrom: child.from, sourceTo: source.length };
        break;
      }
      // Either used===0 (must emit at least this block, even if it busts
      // budget — atomic blocks) or budget still has room. Emit.
      blocks.push(rendered);
      used += cost;
      topCount++;
      child = child.nextSibling;
      continue;
    }
    topCount++;
    blocks.push(renderBlock(ctx, child));
    child = child.nextSibling;
  }

  // Handle the case where the budget is exactly met: check if there's another
  // block following the last emitted one — if so, mark truncated.
  if (budgetKind && !truncated && child) {
    truncated = { sourceFrom: child.from, sourceTo: source.length };
  }

  // If the document has exactly one top-level block AND it is a Paragraph
  // (and no math) AND we did not truncate, unwrap the `<p>` to preserve the
  // existing bare-inline shape that callers (and existing tests) rely on for
  // short inputs.
  let combined: BlockResult;
  if (
    !truncated &&
    topCount === 1 &&
    blocks[0].html.startsWith("<p class=\"cf-paragraph\"")
  ) {
    const stripped = blocks[0].html
      .replace(/^<p class="cf-paragraph"[^>]*>/, "")
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
  "p", "br", "span", "div",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "blockquote",
  "pre", "code",
  "em", "strong", "del", "mark",
  "a", "img",
  "hr",
  "table", "thead", "tbody", "tr", "th", "td",
  "sup", "sub",
  "input",
];
const ALLOWED_ATTR = [
  "href", "src", "alt", "title", "class", "id", "start",
  "type", "checked", "disabled",
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
 * Phase 2.1 scope:
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
 *   `<p class="cf-paragraph">`.
 * - Math nodes emit `<span class="cf-math cf-math-inline" data-math="…">`
 *   placeholders preserving the source verbatim. The Phase 2.3 React
 *   wrapper hydrates these with KaTeX.
 * - When `RefResolver` is absent (or it returns null), citations emit
 *   `cf-citation-unresolved` placeholders carrying `data-ref-key`.
 *   Crossrefs emit `cf-crossref-unresolved cf-crossref-{prefix}` similarly.
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
 * `<sup class="cf-footnote-ref">`, `<span class="cf-math">`,
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
  const resolvers = buildResolvers(ctx);

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
  opts: { truncate?: TruncateSpec } = {},
): { text: string; sourceToText?: Uint32Array; truncated?: TruncatedInfo } {
  const resolvers = buildResolvers(ctx);

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

function buildResolvers(ctx: DocumentContext | undefined): Resolvers {
  if (!ctx) return {};
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
    resolveAssetUrl,
  };
}

// ---------------------------------------------------------------------------
// DOM Range → source position mapping (Phase 2.6).
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
 * Limitation — math: after {@link hydrateMath} runs, a `<span class="cf-math">`
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
  // Detect by walking from the endpoint up to `el` and looking for cf-math.
  let probe: Element | null = node.nodeType === 1 ? (node as Element) : node.parentElement;
  while (probe && probe !== el) {
    if (probe.classList && probe.classList.contains("cf-math")) {
      return atEnd ? elTo : elFrom;
    }
    probe = probe.parentElement;
  }
  if (el.classList && el.classList.contains("cf-math")) {
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
// KaTeX lazy hydration (Phase 2.3).
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
 *   `cf-math-display` class, `false` otherwise.
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

    const isDisplay = el.classList.contains("cf-math-display");
    let html: string;
    try {
      html = katex.renderToString(latex, {
        displayMode: isDisplay,
        throwOnError: true,
        output: "htmlAndMathml",
        ...(macros ? { macros: { ...macros } } : {}),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      el.classList.add("cf-math-error");
      el.setAttribute("data-math-error", message);
      continue;
    }

    el.innerHTML = html;
    el.setAttribute("data-math-hydrated", "true");
  }
}
