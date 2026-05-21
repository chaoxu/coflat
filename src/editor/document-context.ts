/**
 * Shared document context consumed by both the reader and the editor.
 *
 * The pure type definitions live in src/core/document-context-types.ts. This
 * file adds the CM6 Facet machinery that requires @codemirror/state.
 *
 * Context is immutable for the render lifetime. Hosts that need to change
 * resolvers remount their instances with a new context.
 *
 * See READER.md for the design rationale.
 */

import { Facet } from "@codemirror/state";
import {
  EMPTY_DOCUMENT_CONTEXT,
  type DocumentContext,
} from "../core/document-context-types";

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
