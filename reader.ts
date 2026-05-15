/**
 * `@chaoxu/coflat-editor/reader` — read-only renderer for FORMAT.md.
 *
 * v1 scope: **inline subset only**. No block-level rendering (no headings,
 * no lists, no tables, no fenced divs). No math. No refs. No citations.
 * Block-level nodes that appear in the source emit only their visible
 * text content. See READER.md ("Public API", "Fast path", "Sanitization")
 * and issue #1 for the design rationale.
 *
 * Node-importable: no `@codemirror/view`, no React, no KaTeX, no pdfjs,
 * no citation-js.
 */

import { parser as baseMarkdownParser } from "@lezer/markdown";
import type { Tree } from "@lezer/common";
import createDOMPurify from "dompurify";

import { markdownExtensions } from "./src/parser";
import { NODE } from "./src/constants/node-types";
import { isSafeUrl } from "./src/lib/url-utils";
import type { DocumentContext, LinkResolver, RefResolver } from "./src/document-context";
import { noteLezerInvocation } from "./src/reader-internal";

export type { DocumentContext, LinkResolver, RefResolver } from "./src/document-context";

// ---------------------------------------------------------------------------
// Parser (lazy: only constructed when the fast path can't handle the input).
// ---------------------------------------------------------------------------

let _markdownParser: ReturnType<typeof baseMarkdownParser.configure> | null = null;
function getMarkdownParser() {
  if (!_markdownParser) {
    _markdownParser = baseMarkdownParser.configure(markdownExtensions);
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
 *
 * Characters in the sieve:
 *   $   inline / display math
 *   [   links, images (`![..]`), citation clusters
 *   :   fenced div fences `::::` (only as a cheap sieve)
 *   `   inline code, fenced code
 *   #   ATX headings
 *   ^   footnote refs (`[^…]` is already covered by `[`, but `^` also
 *       guards setext headings indirectly; cheap to include)
 *   <   autolinks, HTML
 *   ---\n (anchored) frontmatter
 */
const FAST_PATH_RE = /[$\[:`#^<]|^---\n/m;

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
  /** source-char index → text-char index (cumulative, monotonic non-decreasing). */
  sourceToText: Uint32Array;
}

function fastRenderInline(source: string): FastInlineResult {
  // We model the output as an ordered list of "parts": each part is either
  // a literal text run or a tag boundary. Tags carry no text-offset width;
  // text parts do.

  type Part =
    | { kind: "text"; html: string; text: string; sourceFrom: number; sourceTo: number }
    | { kind: "tag"; html: string; sourceFrom: number; sourceTo: number };

  type Span = {
    delim: "**" | "__" | "*" | "_" | "~~";
    /** Index in `parts` of the tentative open placeholder (a text part). */
    placeholderIdx: number;
    /** Source position of the opening delimiter. */
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
      // No match — emit as literal text.
      pushTextPart(source.slice(from, to), from, to);
      return;
    }
    const span = stack[idx];
    // Drop any unmatched intermediate spans (they remain as literal-text
    // placeholders, which is the correct fallback for unbalanced markup).
    stack.length = idx;

    const tags = tagsFor(delim);
    // Replace the tentative open placeholder (a text part) with an open tag.
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
    // Tentative: emit as text. If unmatched, this is the final form.
    pushTextPart(source.slice(from, to), from, to);
    stack.push({ delim, placeholderIdx, openFrom: from, openTo: to });
  }

  let i = 0;
  while (i < source.length) {
    const c = source[i];

    if (c === "\\" && i + 1 < source.length) {
      const next = source[i + 1];
      // Backslash escape — emit the next char literally. Map source range
      // [i, i+2) to the single output char.
      pushTextPart(next, i, i + 2);
      i += 2;
      continue;
    }

    if ((c === "*" || c === "_") && source[i + 1] === c) {
      const delim = (c + c) as "**" | "__";
      const openIdx = matchOpenSpan(delim);
      if (openIdx >= 0) {
        closeSpan(delim, i, i + 2);
      } else {
        tryOpenSpan(delim, i, i + 2);
      }
      i += 2;
      continue;
    }

    if (c === "~" && source[i + 1] === "~") {
      const openIdx = matchOpenSpan("~~");
      if (openIdx >= 0) {
        closeSpan("~~", i, i + 2);
      } else {
        tryOpenSpan("~~", i, i + 2);
      }
      i += 2;
      continue;
    }

    if (c === "*" || c === "_") {
      const delim = c as "*" | "_";
      const openIdx = matchOpenSpan(delim);
      if (openIdx >= 0) {
        closeSpan(delim, i, i + 1);
      } else {
        tryOpenSpan(delim, i, i + 1);
      }
      i += 1;
      continue;
    }

    pushTextPart(c, i, i + 1);
    i += 1;
  }

  // Compose final outputs.
  const htmlOut: string[] = [];
  const textOut: string[] = [];
  // s2t: source-char → text-char. Size = source.length + 1.
  const s2t = new Uint32Array(source.length + 1);
  let textPos = 0;
  // Tracks the "current" textPos for unmapped source positions inside
  // tag-source ranges (so they map to the start of the next text run).
  for (const part of parts) {
    if (part.kind === "text") {
      // Spread textPos across the source range. Single text part covers
      // source [from, to) producing `part.text` chars. If text length
      // equals source-range length, map 1:1; otherwise distribute linearly
      // (sufficient for escapes: source 2 chars → 1 text char).
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
      // Tag boundary: no text width. Map its source positions to the
      // current textPos so they collapse to the boundary.
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
// Lezer-tree inline-subset walker.
//
// Walks any tree and emits HTML/text for inline-subset nodes only. Block
// nodes recurse into their children and only their visible text is
// emitted. Math nodes set `hasMath: true` and emit their source verbatim.
// ---------------------------------------------------------------------------

interface WalkResult {
  html: string;
  text: string;
  hasMath: boolean;
}

interface Resolvers {
  linkResolver?: LinkResolver;
  refResolver?: RefResolver;
  resolveAssetUrl?: (path: string) => string;
}

function walkTree(source: string, tree: Tree, resolvers: Resolvers): WalkResult {
  let hasMath = false;
  const htmlOut: string[] = [];
  const textOut: string[] = [];

  // Recursive walk over a node range, emitting child nodes inline. Anything
  // we don't recognize emits its plain text content.
  function renderNode(node: import("@lezer/common").SyntaxNode): void {
    const name = node.name;

    // Structural markers — emit nothing. They guard syntax but produce
    // no visible content. The "gap" emission in renderChildren picks up
    // visible text around them.
    if (
      name === "HeaderMark" ||
      name === "QuoteMark" ||
      name === "ListMark" ||
      name === "TaskMarker" ||
      name === "CodeMark" ||
      name === "CodeInfo" ||
      name === "EmphasisMark" ||
      name === "StrikethroughMark" ||
      name === "LinkMark" ||
      name === "URL" ||
      name === "LinkTitle" ||
      name === NODE.FencedDivFence ||
      name === NODE.FencedDivAttributes ||
      name === "TableDelimiter" ||
      name === NODE.HorizontalRule
    ) {
      return;
    }

    // Inline subset
    switch (name) {
      case NODE.Emphasis:
        htmlOut.push("<em>");
        renderChildren(node);
        htmlOut.push("</em>");
        return;
      case NODE.StrongEmphasis:
        htmlOut.push("<strong>");
        renderChildren(node);
        htmlOut.push("</strong>");
        return;
      case NODE.Strikethrough:
        htmlOut.push("<del>");
        renderChildren(node);
        htmlOut.push("</del>");
        return;
      case NODE.InlineCode: {
        // Strip backtick fences from both sides. The content between them
        // is the visible code; emit escaped.
        const raw = source.slice(node.from, node.to);
        // Number of backticks on each side: matches /^`+/.
        const m = raw.match(/^`+/);
        const fenceLen = m ? m[0].length : 1;
        const inner = raw.slice(fenceLen, raw.length - fenceLen);
        htmlOut.push("<code>");
        htmlOut.push(escapeHtml(inner));
        htmlOut.push("</code>");
        textOut.push(inner);
        return;
      }
      case NODE.Link: {
        emitLink(node);
        return;
      }
      case NODE.Image: {
        emitImage(node);
        return;
      }
      case "Autolink": {
        const raw = source.slice(node.from, node.to);
        // Strip surrounding < … >.
        const href = raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
        if (isSafeUrl(href)) {
          htmlOut.push(`<a href="${escapeHtml(href)}">`);
          htmlOut.push(escapeHtml(href));
          htmlOut.push("</a>");
        } else {
          htmlOut.push(escapeHtml(href));
        }
        textOut.push(href);
        return;
      }
      case NODE.InlineMath:
      case NODE.DisplayMath: {
        hasMath = true;
        // v1: emit math source verbatim (visible dollar signs).
        const raw = source.slice(node.from, node.to);
        htmlOut.push(escapeHtml(raw));
        textOut.push(raw);
        return;
      }
      case NODE.Escape: {
        // \X → emit X.
        const raw = source.slice(node.from, node.to);
        const ch = raw.length >= 2 ? raw.slice(1) : raw;
        htmlOut.push(escapeHtml(ch));
        textOut.push(ch);
        return;
      }
      case NODE.Text: {
        const raw = source.slice(node.from, node.to);
        htmlOut.push(escapeHtml(raw));
        textOut.push(raw);
        return;
      }
    }

    // Block-level constructs we deliberately do NOT render structurally
    // in v1: emit only their visible text content by recursing into
    // children and flattening to plain text. (No <h1>, no <ul>, etc.)
    // For block separation between sibling blocks at the document level,
    // we insert "\n\n" between top-level children below.
    renderChildren(node);
  }

  function renderChildren(parent: import("@lezer/common").SyntaxNode): void {
    let child = parent.firstChild;
    if (!child) {
      // No children — emit the node's source range as plain text. This
      // happens for Paragraph (which doesn't subdivide unmarked text)
      // and for any unmodeled leaf.
      const raw = source.slice(parent.from, parent.to);
      htmlOut.push(escapeHtml(raw));
      textOut.push(raw);
      return;
    }
    let cursor = parent.from;
    while (child) {
      // Emit any source slice between previous cursor and this child as
      // plain text (escape rules: leave as-is since the parser already
      // marked the inline nodes; this is whitespace, etc.).
      if (child.from > cursor) {
        const gap = source.slice(cursor, child.from);
        // Preserve newlines as-is for text output; HTML output also
        // includes them verbatim (renderToHtml does not add <br>).
        htmlOut.push(escapeHtml(gap));
        textOut.push(gap);
      }
      renderNode(child);
      cursor = child.to;
      child = child.nextSibling;
    }
    if (cursor < parent.to) {
      const tail = source.slice(cursor, parent.to);
      htmlOut.push(escapeHtml(tail));
      textOut.push(tail);
    }
  }

  function emitLink(node: import("@lezer/common").SyntaxNode): void {
    // Link node shape: `[text](url)` — children include LinkMark, the
    // label content, and the URL child. We read URL via getChild("URL").
    const urlChild = node.getChild("URL");
    let href = urlChild ? source.slice(urlChild.from, urlChild.to) : "";

    // Extract label text from children between the first and the second
    // `LinkMark` (i.e. between `[` and `]`).
    const labelStart = node.from + 1; // after `[`
    // The label ends just before the URL paren block, or end of node.
    let labelEnd = node.to;
    if (urlChild) {
      // Find `]` before urlChild — walk backwards from urlChild.from.
      for (let i = urlChild.from - 1; i >= labelStart; i--) {
        if (source[i] === "]") {
          labelEnd = i;
          break;
        }
      }
    }
    const labelText = source.slice(labelStart, labelEnd);

    // Resolver chance.
    let className: string | undefined;
    let title: string | undefined;
    if (resolvers.linkResolver?.resolve) {
      const resolved = resolvers.linkResolver.resolve(href, labelText, {});
      if (resolved) {
        if (resolved.href !== undefined) href = resolved.href;
        if (resolved.className !== undefined) className = resolved.className;
        if (resolved.title !== undefined) title = resolved.title;
      }
    }

    if (!isSafeUrl(href)) {
      // Unsafe href → render as plain text (the label).
      htmlOut.push(escapeHtml(labelText));
      textOut.push(labelText);
      return;
    }

    let attrs = ` href="${escapeHtml(href)}"`;
    if (className) attrs += ` class="${escapeHtml(className)}"`;
    if (title) attrs += ` title="${escapeHtml(title)}"`;
    htmlOut.push(`<a${attrs}>`);
    // The label sits between the opening `[` LinkMark and the closing `]`
    // LinkMark. Children of the Link node include the LinkMarks, URL,
    // optional LinkTitle, and any inline child nodes (Emphasis, etc.)
    // that fall inside the label. We walk children left-to-right and
    // fill gaps within [labelStart, labelEnd) with plain text.
    let lblCursor = labelStart;
    let lblChild = node.firstChild;
    while (lblChild) {
      if (lblChild.from >= labelEnd) break;
      if (lblChild.to <= labelStart) {
        lblChild = lblChild.nextSibling;
        continue;
      }
      // Skip structural marker nodes; their source positions are still
      // used to bound `lblCursor` so we don't emit `[` etc.
      if (
        lblChild.name === "LinkMark" ||
        lblChild.name === "URL" ||
        lblChild.name === "LinkTitle"
      ) {
        if (lblChild.to > lblCursor) lblCursor = lblChild.to;
        lblChild = lblChild.nextSibling;
        continue;
      }
      if (lblChild.from > lblCursor) {
        const gap = source.slice(lblCursor, lblChild.from);
        htmlOut.push(escapeHtml(gap));
        textOut.push(gap);
      }
      renderNode(lblChild);
      lblCursor = lblChild.to;
      lblChild = lblChild.nextSibling;
    }
    if (lblCursor < labelEnd) {
      const tail = source.slice(lblCursor, labelEnd);
      htmlOut.push(escapeHtml(tail));
      textOut.push(tail);
    }
    htmlOut.push("</a>");
  }

  function emitImage(node: import("@lezer/common").SyntaxNode): void {
    const urlChild = node.getChild("URL");
    let src = urlChild ? source.slice(urlChild.from, urlChild.to) : "";

    // Alt text: between `![` and `]`.
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

    // Synchronous asset resolution only.
    if (resolvers.resolveAssetUrl) {
      try {
        const resolved = resolvers.resolveAssetUrl(src);
        if (typeof resolved === "string") src = resolved;
      } catch {
        // Ignore — keep raw src.
      }
    }

    if (!isSafeUrl(src)) {
      // Unsafe src → render as plain text (the alt).
      htmlOut.push(escapeHtml(alt));
      textOut.push(alt);
      return;
    }
    htmlOut.push(`<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`);
    textOut.push(alt);
  }

  // Document is the tree root. Walk top-level block children with "\n\n"
  // joins so headings/paragraphs/lists end up separated in text output.
  const root = tree.topNode;
  let topChild = root.firstChild;
  let first = true;
  let cursor = root.from;
  if (!topChild) {
    // Empty doc or single text run — fall back to rendering the entire
    // source as plain text.
    htmlOut.push(escapeHtml(source));
    textOut.push(source);
  } else {
    while (topChild) {
      if (!first) {
        // Block separator. Use the actual whitespace between blocks from
        // source so text round-trips reasonably; HTML separator: also
        // raw whitespace (we emit no <p> in v1).
        const gap = source.slice(cursor, topChild.from);
        htmlOut.push(escapeHtml(gap));
        textOut.push(gap);
      } else if (topChild.from > root.from) {
        // Leading whitespace before the first block.
        const lead = source.slice(root.from, topChild.from);
        htmlOut.push(escapeHtml(lead));
        textOut.push(lead);
      }
      renderNode(topChild);
      cursor = topChild.to;
      first = false;
      topChild = topChild.nextSibling;
    }
    if (cursor < root.to) {
      const tail = source.slice(cursor, root.to);
      htmlOut.push(escapeHtml(tail));
      textOut.push(tail);
    }
  }

  return { html: htmlOut.join(""), text: textOut.join(""), hasMath };
}

// ---------------------------------------------------------------------------
// DOMPurify sanitization.
//
// Reader is Node-importable; the existing `sanitizeRenderedHtml` requires
// a real `window`. We accept that limitation here: if a DOM window is
// available (browser or jsdom), we run sanitization. Otherwise we skip it
// — the reader emits only a known-safe inline tag set with all text and
// attribute values escaped at the call site, so the sanitizer is defense
// in depth, not the primary guard.
// ---------------------------------------------------------------------------

const ALLOWED_TAGS = [
  "em", "strong", "del", "code", "a", "img",
];
const ALLOWED_ATTR = ["href", "src", "alt", "title", "class"];

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
  });
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Render a FORMAT.md source string to sanitized HTML.
 *
 * v1 scope: inline subset only — bold, italic, strikethrough, inline code,
 * links, autolinks, images. Block-level constructs (headings, lists,
 * tables, blockquotes, fenced divs) are flattened to their visible text.
 * Math source is preserved as plain text and `hasMath` indicates whether
 * the input contained math (so wrappers can lazy-load KaTeX in Phase 2+).
 *
 * Sanitization: when a DOM window is available (browser or jsdom), HTML
 * is passed through DOMPurify before return. The renderer itself only
 * emits a small inline-subset tag set with escaped text and attributes.
 */
export function renderToHtml(
  source: string,
  ctx?: DocumentContext,
): { html: string; hasMath: boolean } {
  const resolvers = buildResolvers(ctx);

  if (!FAST_PATH_RE.test(source)) {
    // Fast path: no Lezer parse. Plain inline markdown only.
    const fast = fastRenderInline(source);
    return { html: sanitize(fast.html), hasMath: false };
  }

  const tree = parseSource(source);
  const result = walkTree(source, tree, resolvers);
  return { html: sanitize(result.html), hasMath: result.hasMath };
}

/**
 * Render a FORMAT.md source string to readable plain text.
 *
 * Inline markup is stripped: `**bold**` → `bold`, `[label](url)` → `label`,
 * `` `code` `` → `code`. Block markers are dropped; line breaks in source
 * are preserved. Math source is rendered verbatim (e.g. `$x^2$` becomes
 * literal `$x^2$`); Phase 2 will replace it with a placeholder.
 *
 * `sourceToText` is provided only when the fast path was taken (linear,
 * cheap correspondence). It is `undefined` for inputs that triggered the
 * Lezer parser — building an accurate map across block flattening and
 * link-label rewrites adds complexity not justified by v1 callers. FTS
 * highlighting consumers should fall back to substring search when the
 * map is absent.
 */
export function renderToText(
  source: string,
  ctx?: DocumentContext,
): { text: string; sourceToText?: Uint32Array } {
  const resolvers = buildResolvers(ctx);

  if (!FAST_PATH_RE.test(source)) {
    const fast = fastRenderInline(source);
    return { text: fast.text, sourceToText: fast.sourceToText };
  }

  const tree = parseSource(source);
  const result = walkTree(source, tree, resolvers);
  return { text: result.text };
}

function buildResolvers(ctx: DocumentContext | undefined): Resolvers {
  if (!ctx) return {};
  const fs = ctx.fileSystem;
  let resolveAssetUrl: ((path: string) => string) | undefined;
  if (fs && typeof fs.resolveAssetUrl === "function") {
    // Only adopt if synchronous — async resolution requires the React
    // wrapper (Phase 4).
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

