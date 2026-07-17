/**
 * Lightweight inline CM6 editor factory.
 *
 * Creates a minimal EditorView with inline-level rendering:
 * math (KaTeX), bold/italic/code marker hiding, highlight/strikethrough,
 * link styling, and citation/crossref rendering.
 * Used for table cell editing, sidenote editing, and other embedded contexts.
 */

import {
  Compartment,
  EditorState,
  type Extension,
  type Transaction,
} from "@codemirror/state";
import { drawSelection, EditorView } from "@codemirror/view";
import { CSS } from "../core/constants/css-classes";
import type { DocumentContext } from "../core/document-context-types";
import {
  createMarkdownLanguageExtensions,
  createProjectConfigExtensions,
  inlineMarkdownExtensions,
  sharedInlineRenderExtensions,
} from "./base-editor-extensions";
import { documentContextExtension } from "./document-context";
import { referenceRenderPlugin } from "./render/reference-render";
import {
  externalDocumentReferenceCatalogField,
  setExternalDocumentReferenceCatalogEffect,
} from "./semantics/editor-reference-catalog";
import type { DocumentReferenceCatalog } from "./semantics/reference-catalog";
import { type BibData, bibDataEffect, bibDataField } from "./state/bib-data";
import { documentAnalysisField } from "./state/document-analysis";
import { frontmatterField } from "./state/frontmatter-state";

/**
 * Live-window variant configuration. When set, `doc` is the full host
 * document mirrored by this editor: the window extensions hide everything
 * outside the edited span and clamp edits to it, while the dispatch hook
 * applies transactions locally and forwards document changes to the host.
 */
export interface InlineEditorHostWindow {
  /** Extensions that hide/clamp the mirrored host document around the window. */
  extensions: Extension;
  /** Transaction router: applies to this editor and syncs with the host view. */
  dispatch: (tr: Transaction, view: EditorView) => void;
  /** Initial selection, in host-document coordinates. */
  selection?: { anchor: number; head?: number };
}

/** Options for creating a lightweight inline editor. */
export interface InlineEditorOptions {
  /** Parent element to mount the editor into. */
  parent: HTMLElement;
  /** Initial document content. */
  doc: string;
  /** KaTeX math macros to make available. */
  macros: Record<string, string>;
  /** Bibliography data for citation rendering. When provided, the inline
   *  editor renders [@id] citations and @id cross-references. */
  bibData?: BibData;
  /** Root-document reference catalog for resolving crossrefs in embedded editors. */
  referenceCatalog?: DocumentReferenceCatalog;
  /** Host document context for embedded reference/link rendering. */
  documentContext?: DocumentContext;
  /** Called whenever the document changes. */
  onChange: (newDoc: string) => void;
  /** Called when the editor loses focus. */
  onBlur?: () => void;
  /** Called on keydown; return true to prevent default handling. */
  onKeydown?: (event: KeyboardEvent) => boolean;
  /** Render as a read-only preview surface. */
  readOnly?: boolean;
  /** Live-window variant: mirror a host document instead of holding a
   *  detached mini-document. Absent for the default detached behavior. */
  hostWindow?: InlineEditorHostWindow;
}

export interface InlineEditorController {
  view: EditorView;
  setReadOnly: (readOnly: boolean) => void;
  setCallbacks: (
    callbacks: Pick<InlineEditorOptions, "onChange" | "onBlur" | "onKeydown">,
  ) => void;
  destroy: () => void;
}

/**
 * Create a lightweight CM6 EditorView with inline-level rendering.
 *
 * Includes math rendering (KaTeX), bold/italic/code marker hiding,
 * highlight and strikethrough support, link styling, and citation/crossref
 * rendering. No block-level elements (no headings, lists, code blocks,
 * fenced divs, etc.).
 */
export function createInlineEditorController(
  opts: InlineEditorOptions,
): InlineEditorController {
  const readOnly = opts.readOnly ?? false;
  const readOnlyCompartment = new Compartment();
  const editableCompartment = new Compartment();
  const callbacks = {
    onChange: opts.onChange,
    onBlur: opts.onBlur,
    onKeydown: opts.onKeydown,
  };
  const extensions: Extension[] = [
    ...createMarkdownLanguageExtensions({
      extensions: inlineMarkdownExtensions,
    }),
    ...createProjectConfigExtensions({ math: opts.macros }),
    ...sharedInlineRenderExtensions,
    frontmatterField,
    documentAnalysisField,
    documentContextExtension(opts.documentContext),
    bibDataField,
    externalDocumentReferenceCatalogField,
    referenceRenderPlugin,
    drawSelection(),
    readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
    editableCompartment.of(EditorView.editable.of(!readOnly)),
    EditorView.editorAttributes.of({ class: CSS.inlineEditor }),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        callbacks.onChange(update.state.doc.toString());
      }
    }),
    EditorView.domEventHandlers({
      blur: () => {
        callbacks.onBlur?.();
      },
      keydown: (event) => callbacks.onKeydown?.(event) ?? false,
    }),
  ];

  if (opts.hostWindow) {
    extensions.push(opts.hostWindow.extensions);
  }

  const view = new EditorView({
    state: EditorState.create({
      doc: opts.doc,
      selection: opts.hostWindow?.selection,
      extensions,
    }),
    parent: opts.parent,
    ...(opts.hostWindow ? { dispatch: opts.hostWindow.dispatch } : {}),
  });

  if (opts.bibData) {
    view.dispatch({ effects: bibDataEffect.of(opts.bibData) });
  }
  if (opts.referenceCatalog) {
    view.dispatch({
      effects: setExternalDocumentReferenceCatalogEffect.of(opts.referenceCatalog),
    });
  }

  return {
    view,
    setReadOnly(nextReadOnly) {
      view.dispatch({
        effects: [
          readOnlyCompartment.reconfigure(EditorState.readOnly.of(nextReadOnly)),
          editableCompartment.reconfigure(EditorView.editable.of(!nextReadOnly)),
        ],
      });
    },
    setCallbacks(nextCallbacks) {
      callbacks.onChange = nextCallbacks.onChange;
      callbacks.onBlur = nextCallbacks.onBlur;
      callbacks.onKeydown = nextCallbacks.onKeydown;
    },
    destroy() {
      view.destroy();
    },
  };
}

export function createInlineEditor(opts: InlineEditorOptions): EditorView {
  return createInlineEditorController(opts).view;
}
