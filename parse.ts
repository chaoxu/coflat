/**
 * `@chaoxu/coflat/parse` — Node-importable parsing utilities.
 *
 * No DOM, no React, no CodeMirror view. Reuses the same Lezer markdown
 * parser the editor uses internally so that escape rules and code-span
 * exclusion are honored consistently. See READER.md "Lezer is the parser.
 * Regex is a sieve." for the policy.
 */

import type { SyntaxNodeRef } from "@lezer/common";

import { parse as parseYaml, parseDocument as parseYamlDocument, stringify as stringifyYaml, isMap, isScalar } from "yaml";

import { extractRawFrontmatter, parseMarkdownSource } from "./src/core/parser";
import { parseFrontmatter as parseCoflatFrontmatter } from "./src/core/parser/frontmatter";
import { NODE } from "./src/core/constants/node-types";
import {
  BRACKETED_REFERENCE_EXACT_RE,
  NARRATIVE_REFERENCE_GLOBAL_RE,
  parseReferenceClusterBody,
} from "./src/core/lib/reference-grammar";
import { buildLineOffsets, lineAt } from "./src/core/lib/line-offsets";
import {
  blockReferenceTarget,
  buildReferenceTargetIndexes,
  equationReferenceTarget,
  headingReferenceTarget,
  sortDocumentReferenceTargets,
} from "./src/core/reference-targets";
import type {
  DocumentReferenceTarget,
  DocumentReferenceTargetKind,
} from "./src/core/reference-targets";
import {
  analyzeHeadings,
  analyzeDocumentSemantics,
  stringTextSource,
} from "./src/editor/semantics/document";
import {
  blockTitleOverridesFromConfig,
  computeBlockNumbers,
  createConfiguredBlockNumberingSpecLookup,
  displayTitleForBlockType,
} from "./src/core/semantics/block-numbering";
export {
  createNumericCitationFormatter,
  parseBibliographyKeys,
  type NumericCitationEntry,
} from "./src/core/citations/numeric";
export {
  markdownReferencePathCandidatesFromDocument,
  normalizeMarkdownReferencePath,
  relativeMarkdownReferencePathFromDocument,
  resolveMarkdownReferencePathFromDocument,
} from "./src/editor/lib/markdown-reference-paths";

export type ReferenceKind = "link" | "image" | "crossref";

export interface ExtractedReference {
  readonly kind: ReferenceKind;
  /** Source slice corresponding to [from, to). */
  readonly raw: string;
  readonly from: number;
  readonly to: number;
  /** Present on `link` and `image`: the href as written in source. */
  readonly href?: string;
  /** Present on `crossref`: the key after `@`. */
  readonly key?: string;
  /** Present on `crossref`: `true` for bracketed `[@key]`, `false` for a bare narrative `@key`. */
  readonly bracketed?: boolean;
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
        out.push({
          kind: "crossref",
          raw: source.slice(from, to),
          from,
          to,
          key,
          bracketed: true,
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
    out.push({
      kind: "crossref",
      raw: source.slice(from, to),
      from,
      to,
      key: id,
      bracketed: false,
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
  const tree = parseMarkdownSource(source, "semantic");
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

export type ReferenceCatalogTargetKind = DocumentReferenceTargetKind;

export interface ReferenceCatalogTarget {
  readonly id?: string;
  readonly kind: ReferenceCatalogTargetKind;
  readonly from: number;
  readonly to: number;
  /**
   * 1-based line number of `from`, counted over the full source (frontmatter
   * included). Convenience for line-based hosts (indexers, link tables) that
   * would otherwise recompute it from the offsets.
   */
  readonly line: number;
  readonly displayLabel: string;
  readonly number?: string;
  readonly ordinal?: number;
  readonly title?: string;
  readonly text?: string;
  readonly blockType?: string;
}

export interface ReferenceCatalogReference {
  readonly from: number;
  readonly to: number;
  /** 1-based line number of `from`, counted over the full source. */
  readonly line: number;
  readonly raw: string;
  readonly bracketed: boolean;
  readonly ids: readonly string[];
  readonly locators: readonly (string | undefined)[];
}

export interface ReferenceCatalog {
  readonly targets: readonly ReferenceCatalogTarget[];
  readonly targetsById: ReadonlyMap<string, readonly ReferenceCatalogTarget[]>;
  readonly uniqueTargetById: ReadonlyMap<string, ReferenceCatalogTarget>;
  readonly duplicatesById: ReadonlyMap<string, readonly ReferenceCatalogTarget[]>;
  readonly references: readonly ReferenceCatalogReference[];
}

export interface ReferenceCatalogOptions {
  readonly includeUnnumberedBlockOrdinals?: boolean;
}

function requireLineTarget(target: DocumentReferenceTarget): ReferenceCatalogTarget {
  if (target.line === undefined) {
    throw new Error(`Expected reference target line for ${target.kind} at ${target.from}`);
  }
  return target as ReferenceCatalogTarget;
}

/**
 * Build the shared reference catalog used by reader hosts and package tests.
 *
 * The output is parser/semantic data only: no DOM, React, CodeMirror view, or
 * citation-js dependencies.
 */
export function buildReferenceCatalog(
  source: string,
  _options: ReferenceCatalogOptions = {},
): ReferenceCatalog {
  const tree = parseMarkdownSource(source, "semantic");
  const analysis = analyzeDocumentSemantics(stringTextSource(source), tree);
  const lineOffsets = buildLineOffsets(source);
  const frontmatter = parseCoflatFrontmatter(source);
  const blockNumbers = computeBlockNumbers(
    analysis.fencedDivs,
    createConfiguredBlockNumberingSpecLookup(frontmatter.config.blocks),
    frontmatter.config.numbering ?? "grouped",
  );
  const blockTitles = blockTitleOverridesFromConfig(frontmatter.config.blocks);
  const targets: DocumentReferenceTarget[] = [];

  for (const block of analysis.fencedDivs) {
    if (!block.primaryClass) continue;
    const numbered = blockNumbers.byPosition.get(block.from);
    const ordinal = numbered?.number;
    const title = displayTitleForBlockType(block.primaryClass, blockTitles);
    targets.push(blockReferenceTarget({
      id: block.id,
      from: block.from,
      to: block.to,
      blockType: block.primaryClass,
      title: block.title,
      displayTitle: title,
      number: ordinal,
      line: lineAt(lineOffsets, block.from),
    }));
  }

  for (const equation of analysis.equations) {
    targets.push(equationReferenceTarget({
      ...equation,
      line: lineAt(lineOffsets, equation.from),
    }));
  }

  for (const heading of analysis.headings) {
    targets.push(headingReferenceTarget({
      ...heading,
      line: lineAt(lineOffsets, heading.from),
    }));
  }

  const sortedTargets = sortDocumentReferenceTargets(targets).map(requireLineTarget);
  const indexes = buildReferenceTargetIndexes(sortedTargets);

  return {
    targets: sortedTargets,
    targetsById: indexes.targetsById as ReadonlyMap<string, readonly ReferenceCatalogTarget[]>,
    uniqueTargetById: indexes.uniqueTargetById as ReadonlyMap<string, ReferenceCatalogTarget>,
    duplicatesById: indexes.duplicatesById as ReadonlyMap<string, readonly ReferenceCatalogTarget[]>,
    references: analysis.references.map((reference) => ({
      from: reference.from,
      to: reference.to,
      line: lineAt(lineOffsets, reference.from),
      raw: source.slice(reference.from, reference.to),
      bracketed: reference.bracketed,
      ids: reference.ids,
      locators: reference.locators,
    })),
  };
}

export function analyzeReferences(source: string): ReferenceCatalog {
  return buildReferenceCatalog(source);
}

/** Return the first level-1 ATX heading text using the Coflat Lezer parser. */
export function extractFirstH1(source: string): string | null {
  const tree = parseMarkdownSource(source, "semantic");
  const headings = analyzeHeadings(stringTextSource(source), tree);
  return headings.find((heading) => heading.level === 1)?.text ?? null;
}

// ---------------------------------------------------------------------------
// Frontmatter standalone exports
//
// These provide a *generic* frontmatter API for tools that need to read or
// rewrite YAML frontmatter without buying into the editor's schema-typed
// `FrontmatterConfig`. Built on top of the same `extractRawFrontmatter`
// boundary detector the editor uses internally so behavior agrees.
// ---------------------------------------------------------------------------

export interface ParsedFrontmatter {
  /** Parsed YAML mapping, or `null` if no frontmatter / malformed YAML. */
  readonly frontmatter: Record<string, unknown> | null;
  /** Document body, with the frontmatter block removed. */
  readonly body: string;
  /**
   * Byte offsets of the frontmatter block in the *source* string
   * (from the opening `---` to just past the closing `---\n`).
   * `null` when no frontmatter block was found.
   */
  readonly range: { from: number; to: number } | null;
}

/** Detect the predominant line ending of a string by scanning the first ~512 chars. */
function detectLineEnding(s: string): "\n" | "\r\n" {
  const sample = s.length > 512 ? s.slice(0, 512) : s;
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample.charCodeAt(i) === 0x0a) {
      if (i > 0 && sample.charCodeAt(i - 1) === 0x0d) crlf++;
      else lf++;
    }
  }
  return crlf > lf ? "\r\n" : "\n";
}

/** Keys, in source order, of a parsed YAML document's root mapping. */
function rootKeyOrder(rawYaml: string): string[] {
  const doc = parseYamlDocument(rawYaml);
  if (!doc.contents || !isMap(doc.contents)) return [];
  const keys: string[] = [];
  for (const item of doc.contents.items) {
    const k = item.key;
    if (isScalar(k) && typeof k.value === "string") {
      keys.push(k.value);
    } else if (typeof k === "string") {
      keys.push(k);
    }
  }
  return keys;
}

/**
 * Parse YAML frontmatter from a markdown document.
 *
 * Generic counterpart to the editor's schema-typed `parseFrontmatter` in
 * `src/parser/frontmatter.ts`. Returns the raw parsed mapping (no validation),
 * the body with the frontmatter removed, and the source range of the
 * frontmatter block.
 *
 * Semantics:
 * - No frontmatter present → `{ frontmatter: null, body: source, range: null }`.
 * - Empty frontmatter (`---\n---\n`) → `{ frontmatter: {}, body, range }`.
 * - Malformed YAML inside a well-formed `--- … ---` block →
 *   `{ frontmatter: null, body, range }`. Callers can distinguish "no block"
 *   from "invalid block" by checking `range`.
 * - Non-mapping YAML (e.g. a top-level scalar or sequence) is treated like
 *   malformed: `frontmatter: null` with `range` set.
 */
export function parseFrontmatter(source: string): ParsedFrontmatter {
  const extracted = extractRawFrontmatter(source);
  if (!extracted) {
    return { frontmatter: null, body: source, range: null };
  }
  const range = { from: 0, to: extracted.end };
  const body = source.slice(extracted.end);

  // Empty frontmatter — yaml.parse returns null/undefined for "".
  if (extracted.raw.trim().length === 0) {
    return { frontmatter: {}, body, range };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(extracted.raw);
  } catch {
    return { frontmatter: null, body, range };
  }

  if (parsed === null || parsed === undefined) {
    return { frontmatter: {}, body, range };
  }
  if (
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return { frontmatter: null, body, range };
  }
  return {
    frontmatter: parsed as Record<string, unknown>,
    body,
    range,
  };
}

/** Compose `frontmatter` + `body` into a single source string. */
export function serializeFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string,
  opts?: { keyOrder?: readonly string[] },
): string {
  const eol = detectLineEnding(body);
  const ordered = applyKeyOrder(frontmatter, opts?.keyOrder);

  // Empty mapping → emit empty `---\n---\n` block (no YAML body).
  let yamlText: string;
  if (Object.keys(ordered).length === 0) {
    yamlText = "";
  } else {
    // `yaml.stringify` always emits LF; rewrite to match the document EOL.
    yamlText = stringifyYaml(ordered);
    if (eol === "\r\n") {
      yamlText = yamlText.replace(/\r?\n/g, "\r\n");
    }
  }

  // yaml.stringify already ends with a trailing newline when there is content.
  const block = yamlText.length === 0
    ? `---${eol}---${eol}`
    : `---${eol}${yamlText}---${eol}`;

  return block + body;
}

/** Reorder a plain object's keys according to `keyOrder`, then insertion order. */
function applyKeyOrder(
  obj: Record<string, unknown>,
  keyOrder: readonly string[] | undefined,
): Record<string, unknown> {
  if (!keyOrder || keyOrder.length === 0) return obj;
  const out: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const key of keyOrder) {
    if (Object.hasOwn(obj, key)) {
      out[key] = obj[key];
      seen.add(key);
    }
  }
  for (const key of Object.keys(obj)) {
    if (!seen.has(key)) out[key] = obj[key];
  }
  return out;
}

/**
 * Read, mutate, and write a document's frontmatter.
 *
 * The mutator may mutate the input object in place (returning `void`/`undefined`)
 * or return a replacement object. By default keys are emitted in the source's
 * original order; new keys added by the mutator are appended.
 *
 * If `source` has no frontmatter block and the mutator produces a non-empty
 * mapping, a frontmatter block is synthesized at the top of the document.
 * If the mutator leaves the mapping empty *and* there was no original block,
 * `source` is returned unchanged.
 */
export function updateFrontmatter(
  source: string,
  mutator: (fm: Record<string, unknown>) => unknown,
): string {
  const parsed = parseFrontmatter(source);
  // Use parsed mapping when available; otherwise start from an empty object
  // so the mutator can add keys to a source with no/invalid frontmatter.
  const original = parsed.frontmatter ?? {};
  // Preserve source order. If we have a range (i.e. there *was* a block,
  // even malformed), try to recover key order from the raw YAML; otherwise
  // fall back to insertion order of the parsed object.
  let sourceOrder: string[] = [];
  if (parsed.range && parsed.frontmatter) {
    const raw = source.slice(0, parsed.range.to);
    // Strip the `---` delimiters and inner content via extractRawFrontmatter
    // for the same source — we already paid that cost above, but re-running
    // is cheap and keeps this helper self-contained.
    const extracted = extractRawFrontmatter(raw);
    if (extracted) {
      sourceOrder = rootKeyOrder(extracted.raw);
    }
  }

  // Run the mutator. A returned object replaces; void means "mutated in place".
  const returned = mutator(original);
  const next: Record<string, unknown> =
    returned === undefined ? original : (returned as Record<string, unknown>);

  // Compute final key order: source order first (for keys still present),
  // then any new keys in their insertion order on `next`.
  const ordered: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const key of sourceOrder) {
    if (Object.hasOwn(next, key)) {
      ordered[key] = next[key];
      seen.add(key);
    }
  }
  for (const key of Object.keys(next)) {
    if (!seen.has(key)) ordered[key] = next[key];
  }

  // No original block and mutator left mapping empty → no-op.
  if (!parsed.range && Object.keys(ordered).length === 0) {
    return source;
  }

  return serializeFrontmatter(ordered, parsed.body);
}
