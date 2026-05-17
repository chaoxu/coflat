/**
 * Shared document context consumed by both the reader and the editor.
 *
 * The pure type definitions (LinkResolver, RefResolver, CitationFormatter,
 * DocumentContext, EMPTY_DOCUMENT_CONTEXT) live in
 * src/core/document-context-types.ts. This file re-exports them for
 * backwards-compatible imports and adds the CM6 Facet machinery that
 * requires @codemirror/state.
 *
 * v1 assumes context is immutable for the render lifetime — hosts that
 * need to change resolvers (new bib loaded, new page added) remount
 * their instances. Reactivity (`version` / `subscribe`) is a follow-up.
 *
 * See READER.md for the design rationale.
 */

import { Facet } from "@codemirror/state";
import {
  EMPTY_DOCUMENT_CONTEXT,
  type DocumentContext,
} from "./core/document-context-types";

export type {
  LinkResolver,
  RefResolver,
  CitationFormatter,
  DocumentContext,
} from "./core/document-context-types";
export { EMPTY_DOCUMENT_CONTEXT } from "./core/document-context-types";

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
