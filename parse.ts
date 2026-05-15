/**
 * `@chaoxu/coflat-editor/parse` — Node-importable parsing utilities.
 *
 * No DOM, no React, no CodeMirror view. Reuses the same Lezer markdown
 * parser the editor uses internally so that escape rules and code-span
 * exclusion are honored consistently. See READER.md "Lezer is the parser.
 * Regex is a sieve." for the policy.
 */

import { parser as baseMarkdownParser } from "@lezer/markdown";
import type { SyntaxNodeRef } from "@lezer/common";

import { extractRawFrontmatter, markdownExtensions } from "./src/parser";
import { CROSS_REFERENCE_PREFIXES } from "./src/constants/block-manifest";
import { NODE } from "./src/constants/node-types";
import {
  BRACKETED_REFERENCE_EXACT_RE,
  NARRATIVE_REFERENCE_GLOBAL_RE,
  parseReferenceClusterBody,
} from "./src/lib/reference-grammar";

export type ReferenceKind = "link" | "image" | "ref" | "crossref";

export interface ExtractedReference {
  readonly kind: ReferenceKind;
  /** Source slice corresponding to [from, to). */
  readonly raw: string;
  readonly from: number;
  readonly to: number;
  /** Present on `link` and `image`: the href as written in source. */
  readonly href?: string;
  /** Present on `ref` and `crossref`: the key after `@`. */
  readonly key?: string;
  /** Present on `ref` only: bracketed `[@key]` vs narrative `@key`. */
  readonly mode?: "bracketed" | "narrative";
}

const CROSSREF_PREFIX_SET = new Set(CROSS_REFERENCE_PREFIXES);
const markdownParser = baseMarkdownParser.configure(markdownExtensions);

function isCrossrefKey(key: string): boolean {
  const colon = key.indexOf(":");
  if (colon <= 0) return false;
  return CROSSREF_PREFIX_SET.has(key.slice(0, colon));
}

function getUrlChild(node: SyntaxNodeRef): { from: number; to: number } | null {
  const url = node.node.getChild("URL");
  if (!url) return null;
  return { from: url.from, to: url.to };
}

function emitLinkOrRef(
  source: string,
  node: SyntaxNodeRef,
  out: ExtractedReference[],
): void {
  // A Link node covers both `[text](href)` and the citation cluster `[@key]`
  // because they look like links to the markdown parser. Try the citation
  // cluster grammar first; if it matches the *exact* shape `[…]`, this is a
  // bracketed reference, not a link.
  const raw = source.slice(node.from, node.to);
  const clusterMatch = BRACKETED_REFERENCE_EXACT_RE.exec(raw);
  if (clusterMatch) {
    const body = clusterMatch[1] ?? "";
    const parts = parseReferenceClusterBody(body);
    if (parts) {
      for (const part of parts) {
        // markerFrom/markerTo are offsets within `body`; body starts at
        // node.from + 1 (after the opening `[`).
        const from = node.from + 1 + part.markerFrom;
        const to = node.from + 1 + part.markerTo;
        const key = part.id;
        const isCross = isCrossrefKey(key);
        out.push({
          kind: isCross ? "crossref" : "ref",
          raw: source.slice(from, to),
          from,
          to,
          key,
          ...(isCross ? {} : { mode: "bracketed" as const }),
        });
      }
      return;
    }
  }

  const url = getUrlChild(node);
  if (!url) return;
  const href = source.slice(url.from, url.to);
  out.push({
    kind: "link",
    raw,
    from: node.from,
    to: node.to,
    href,
  });
}

function emitImage(
  source: string,
  node: SyntaxNodeRef,
  out: ExtractedReference[],
): void {
  const url = getUrlChild(node);
  if (!url) return;
  out.push({
    kind: "image",
    raw: source.slice(node.from, node.to),
    from: node.from,
    to: node.to,
    href: source.slice(url.from, url.to),
  });
}

function emitAutolink(
  source: string,
  node: SyntaxNodeRef,
  out: ExtractedReference[],
): void {
  const url = getUrlChild(node);
  // Autolink uses URL child for the inside of `<...>`.
  const href = url
    ? source.slice(url.from, url.to)
    : source.slice(node.from + 1, node.to - 1);
  out.push({
    kind: "link",
    raw: source.slice(node.from, node.to),
    from: node.from,
    to: node.to,
    href,
  });
}

/** Ranges to skip when scanning paragraph text for bare `@key` (narrative refs). */
type Range = { from: number; to: number };

function inRanges(pos: number, ranges: readonly Range[]): boolean {
  for (const r of ranges) {
    if (pos >= r.from && pos < r.to) return true;
  }
  return false;
}

/**
 * Lezer-markdown does not tokenize bare `@key` narrative refs. Apply the
 * narrative-ref regex sieve over the entire source, then filter out matches
 * that fall inside ranges the parser has already claimed (code, math, links,
 * footnote refs, fenced divs' fence/attrs, etc.). This matches the policy:
 * Lezer is the parser; regex is only a sieve over text the parser has
 * already determined is plain inline.
 */
function collectNarrativeRefs(
  source: string,
  excludedRanges: readonly Range[],
  out: ExtractedReference[],
): void {
  for (const match of source.matchAll(NARRATIVE_REFERENCE_GLOBAL_RE)) {
    const from = match.index ?? 0;
    if (inRanges(from, excludedRanges)) continue;
    const id = match[1] ?? "";
    if (!id) continue;
    const to = from + 1 + id.length;
    const isCross = isCrossrefKey(id);
    out.push({
      kind: isCross ? "crossref" : "ref",
      raw: source.slice(from, to),
      from,
      to,
      key: id,
      ...(isCross ? {} : { mode: "narrative" as const }),
    });
  }
}

/**
 * Extract every reference-like span from a FORMAT.md source string.
 *
 * Returned items are sorted by `from`. Nothing in this module touches the
 * DOM, KaTeX, citation-js, or React; safe to call from Node, CLIs, and
 * server indexers.
 */
export function extractReferences(source: string): ExtractedReference[] {
  const tree = markdownParser.parse(source);
  const out: ExtractedReference[] = [];
  const excluded: Range[] = [];

  // Lezer's markdown parser doesn't know about frontmatter; the leading
  // `---\n...\n---` block parses as HorizontalRule + headings. Exclude
  // it textually so bare `@key` in YAML values isn't extracted as a ref.
  const frontmatter = extractRawFrontmatter(source);
  if (frontmatter) excluded.push({ from: 0, to: frontmatter.end });

  tree.iterate({
    enter(node) {
      switch (node.name) {
        case NODE.Link:
          emitLinkOrRef(source, node, out);
          // Whatever this node turned into, its span is claimed.
          excluded.push({ from: node.from, to: node.to });
          return false;
        case NODE.Image:
          emitImage(source, node, out);
          excluded.push({ from: node.from, to: node.to });
          return false;
        case "Autolink":
          emitAutolink(source, node, out);
          excluded.push({ from: node.from, to: node.to });
          return false;
        case NODE.InlineCode:
        case NODE.InlineMath:
        case NODE.DisplayMath:
        case NODE.FencedCode:
        case NODE.FootnoteRef:
        case NODE.HTMLBlock:
        case "CommentBlock":
        case NODE.FencedDivFence:
        case NODE.FencedDivAttributes:
        case NODE.Frontmatter:
          excluded.push({ from: node.from, to: node.to });
          return false;
        default:
          return undefined;
      }
    },
  });

  collectNarrativeRefs(source, excluded, out);

  out.sort((a, b) => a.from - b.from || a.to - b.to);
  return out;
}
