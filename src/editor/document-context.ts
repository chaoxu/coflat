/**
 * Shared document context consumed by both the reader and the editor.
 *
 * The pure type definitions live in src/core/document-context-types.ts. This
 * file adds the CM6 Facet machinery that requires @codemirror/state.
 *
 * Context is live for mounted editor instances. Hosts can reconfigure the
 * compartment below without remounting the editor.
 *
 * See READER.md for the design rationale.
 */

import { Compartment, type Extension, Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  type DocumentContext,
  EMPTY_DOCUMENT_CONTEXT,
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

export const documentContextCompartment = new Compartment();

export function documentContextExtension(context?: DocumentContext): Extension {
  return documentContextCompartment.of(
    documentContextFacet.of(context ?? EMPTY_DOCUMENT_CONTEXT),
  );
}

export function setDocumentContext(
  view: EditorView,
  context: DocumentContext,
): void {
  view.dispatch({
    effects: documentContextCompartment.reconfigure(
      documentContextFacet.of(context),
    ),
  });
}
