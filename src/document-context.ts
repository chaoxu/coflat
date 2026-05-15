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

export interface DocumentContext {
  fileSystem?: FileSystem;
  linkResolver?: LinkResolver;
  refResolver?: RefResolver;
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
