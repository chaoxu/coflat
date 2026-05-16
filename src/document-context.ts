/**
 * Shared document context consumed by both the reader and the editor.
 *
 * v1 assumes context is immutable for the render lifetime — hosts that
 * need to change resolvers (new bib loaded, new page added) remount
 * their instances. Reactivity (`version` / `subscribe`) is a follow-up.
 *
 * See READER.md for the design rationale.
 */

import { Facet } from "@codemirror/state";
import type { FileSystem } from "./lib/types";

/**
 * Host-supplied resolver for `[text](href)` links. Coflat tokenizes
 * links and emits `<a>`; this resolver decorates the result — rewrites
 * the target, adds a class, attaches a click handler.
 *
 * The host does *not* produce display text; the source already contains
 * it. For references where the host produces both text and target, use
 * `RefResolver` instead.
 *
 * Bare same-document anchors (`href="#eq:foo"`) are resolved by coflat
 * against the in-doc label index and never reach `LinkResolver`.
 */
export interface LinkResolver {
  resolve?(
    href: string,
    text: string,
    env: { from?: string },
  ): {
    href?: string;
    className?: string;
    title?: string;
    onClick?: (e: MouseEvent) => void;
  } | null;
}

/**
 * Host-supplied resolver for `[@key]` (bracketed) and `@key` (narrative)
 * references. Unlike links, the source contains only a key — the host
 * produces both the display text and (optionally) a target.
 *
 * Cross-refs within a document (`@eq:foo`, `@sec:bar`, `@thm:baz`) are
 * resolved by coflat against the in-doc label index and do *not* go
 * through `RefResolver`.
 */
export interface RefResolver {
  resolve(
    key: string,
    mode: "bracketed" | "narrative",
  ): {
    /**
     * Sanitized HTML for the visible reference text. Coflat passes this
     * through DOMPurify before injecting into the DOM.
     */
    content: string;
    href?: string;
    className?: string;
    onClick?: (e: MouseEvent) => void;
  } | null;
}

/**
 * Host-supplied formatter for citation rendering.
 *
 * Unlike `RefResolver` (single-key, sanitized HTML), a `CitationFormatter`
 * understands clusters of citation keys with optional locators ("knuth1984, p.
 * 24"). Bibliography rendering and CSL-style numeric/author-date formatting go
 * through this seam.
 *
 * The main editor bundle no longer ships a default citation formatter. Hosts
 * that want classic CSL-formatted citations import the helper from
 * `@chaoxu/coflat-editor/citeproc` (see `createCslCitationFormatter`).
 *
 * v1 assumption: a formatter, once attached, is stable for the editor
 * lifetime. Mutating its internal state via `registerCitations()` is fine, but
 * swapping formatters means a remount. The `revision` field gives the renderer
 * a coarse-grained invalidation hook.
 */
export interface CitationFormatter {
  /** Bracketed cluster: `[@a; @b, p. 5]`. */
  cite(ids: readonly string[], locators: readonly (string | undefined)[]): string;
  /** Narrative `@key` rendering (author 2024). */
  citeNarrative(id: string): string;
  /**
   * Render the formatted bibliography entries for the cited ids. The returned
   * list is `id`-aligned but may be shorter (entries missing from the
   * formatter's bib are dropped).
   */
  bibliographyEntries(
    citedIds: readonly string[],
  ): readonly { readonly id: string; readonly html: string }[];
  /**
   * Tell the formatter about every cluster in the document so it can compute
   * numbering and disambiguation. Implementations should be idempotent when
   * called with the same set of clusters in the same order.
   */
  registerCitations(
    clusters: readonly {
      readonly ids: readonly string[];
      readonly locators?: readonly (string | undefined)[];
    }[],
  ): void;
  /**
   * Cache key for the most recent `registerCitations` call. Renderers use
   * this to skip redundant registration. May be `null` before any clusters
   * are registered.
   */
  readonly citationRegistrationKey: string | null;
  /** Monotonically increasing on style/data changes. */
  readonly revision: number;
}

export interface DocumentContext {
  fileSystem?: FileSystem;
  linkResolver?: LinkResolver;
  refResolver?: RefResolver;
  /**
   * Optional citation formatter for CSL-style bracketed/narrative citations.
   * The main editor bundle no longer ships one; import from
   * `@chaoxu/coflat-editor/citeproc` to attach a CSL implementation.
   */
  citationFormatter?: CitationFormatter;
  /** Math macros for KaTeX. Usually populated from frontmatter; this is an override. */
  mathMacros?: Record<string, string>;
}

const EMPTY_DOCUMENT_CONTEXT: DocumentContext = Object.freeze({});

/**
 * Pattern follows fileSystemFacet: at most one provider, last wins.
 */
export const documentContextFacet = Facet.define<
  DocumentContext,
  DocumentContext
>({
  combine(values) {
    return values.length > 0 ? values[values.length - 1] : EMPTY_DOCUMENT_CONTEXT;
  },
});
