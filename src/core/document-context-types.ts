/**
 * Pure type definitions for the document-context API consumed by both the
 * reader and the editor.
 *
 * Lives in core/ so non-CM6 consumers (CLI renderers, server-side renderers,
 * static-site generators) can describe a document context without pulling
 * @codemirror/state at runtime. The CM6 Facet that distributes the value to
 * render plugins stays in src/document-context.ts and re-exports these types.
 *
 * See READER.md for the design rationale.
 */

import type { FileSystem } from "./lib/file-system-types";

export type ReferenceMode = "bracketed" | "narrative";

export interface SourceRange {
  readonly from: number;
  readonly to: number;
}

export interface RefResolverClusterEnv {
  readonly ids: readonly string[];
  readonly locators: readonly (string | undefined)[];
  readonly index: number;
  readonly raw: string;
}

export interface RefResolverEnv {
  readonly raw?: string;
  readonly sourceRange?: SourceRange;
  readonly locator?: string;
  readonly cluster?: RefResolverClusterEnv;
  readonly documentPath?: string;
  readonly surface?: "reader" | "editor" | "editor-widget" | "editor-hover" | "editor-completion" | (string & {});
}

export interface LinkResolverEnv {
  /** Current document path, when the host supplied one. */
  readonly from?: string;
  readonly raw?: string;
  readonly sourceRange?: SourceRange;
  readonly documentPath?: string;
  readonly surface?: "reader" | "editor" | "editor-widget" | "editor-hover" | "editor-completion" | (string & {});
}

export interface HostLinkResolution {
  href?: string;
  className?: string;
  title?: string;
  onClick?: (e: MouseEvent) => void;
}

export interface HostReferenceResolution {
  /** Sanitized HTML for the visible reference text. */
  content: string;
  href?: string;
  className?: string;
  onClick?: (e: MouseEvent) => void;
}

/**
 * Host-supplied resolver for `[text](href)` links. Coflat tokenizes
 * links and emits `<a>`; this resolver decorates the result — rewrites
 * the target, adds a class, attaches a click handler.
 */
export interface LinkResolver {
  resolve?(
    href: string,
    text: string,
    env: LinkResolverEnv,
  ): HostLinkResolution | null;
}

/**
 * Host-supplied resolver for `[@key]` (bracketed) and `@key` (narrative)
 * references. Unlike links, the source contains only a key — the host
 * produces both the display text and (optionally) a target.
 */
export interface RefResolver {
  resolve(
    key: string,
    mode: ReferenceMode,
    env?: RefResolverEnv,
  ): HostReferenceResolution | null;
}

/**
 * Per-item Pandoc citation fields beyond id/locator: prefix text before the
 * key (`[see @key]`) and the suppress-author flag (`-@key`). Suffix text
 * rides in the locator string and is split off by the formatter.
 */
export interface CitationCiteExtras {
  readonly prefix?: string;
  readonly suppressAuthor?: boolean;
}

/**
 * Host-supplied formatter for citation rendering. CSL-style numeric or
 * author-date formatting goes through this seam. See
 * `@chaoxu/coflat/citeproc` for a default CSL implementation.
 */
export interface CitationFormatter {
  cite(
    ids: readonly string[],
    locators: readonly (string | undefined)[],
    extras?: readonly (CitationCiteExtras | undefined)[],
  ): string;
  citeNarrative(id: string): string;
  bibliographyEntries(
    citedIds: readonly string[],
  ): readonly { readonly id: string; readonly html: string }[];
  registerCitations(
    clusters: readonly {
      readonly ids: readonly string[];
      readonly locators?: readonly (string | undefined)[];
    }[],
  ): void;
  readonly citationRegistrationKey: string | null;
  readonly revision: number;
}

export interface DocumentContext {
  fileSystem?: FileSystem;
  linkResolver?: LinkResolver;
  refResolver?: RefResolver;
  citationFormatter?: CitationFormatter;
  /**
   * The set of bibliography entry keys the `citationFormatter` knows. Lets a
   * surface tell a paper citation `[@cormen2009]` from an in-document crossref
   * `[@eq:gaussian]` or a host workspace ref, without a `has()` on the
   * formatter. Supplied alongside `citationFormatter`; the editor derives the
   * equivalent from its `BibStore`.
   */
  citationKeys?: ReadonlySet<string>;
  /** Math macros for KaTeX. Usually populated from frontmatter; this is an override. */
  mathMacros?: Record<string, string>;
}

export const EMPTY_DOCUMENT_CONTEXT: DocumentContext = Object.freeze({});
