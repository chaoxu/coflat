import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import {
  createEditor,
  editorModeField,
  setEditorMode,
} from "./src/editor";
import {
  createPerFilePanelApi,
  type Counts,
  type CursorContext,
  type HeadlessPanelStore,
  type OutlineEntry,
  type ScrollToLineOptions,
  type ScrollToPositionOptions,
} from "./src/headless/per-file-panels";
import { programmaticDocumentChangeAnnotation } from "./src/editor/programmatic-document-change";
import {
  requestHandlerFacet,
  statusEventsFacet,
  type RequestHandler,
  type StatusEvents,
} from "./src/editor-host-api";

export type StandaloneEditorMode = "rich" | "source";

export interface MountEditorOptions {
  /** DOM element that receives the mounted editor. */
  parent: HTMLElement;
  /** Initial markdown content. Defaults to an empty document. */
  doc?: string;
  /** Initial display mode. Standalone support is limited to rich/source. */
  mode?: StandaloneEditorMode;
  /** Extra CodeMirror extensions supplied by the host. */
  extensions?: readonly Extension[];
  /** Called for direct user edits only. */
  onChange?: (doc: string) => void;
  /** Called whenever the effective rich/source mode changes. */
  onModeChange?: (mode: StandaloneEditorMode) => void;
  /**
   * Host UI for request/response intents (link picker, upload toast,
   * autocomplete). Each method is optional; missing methods fall
   * through to the library's default chrome. See `RequestHandler`.
   */
  requestHandler?: RequestHandler;
  /**
   * Fire-and-forget lifecycle events (save, dirty-state, asset upload).
   * Specific events are emitted by later phases. See `StatusEvents`.
   */
  statusEvents?: StatusEvents;
}

export interface MountedEditor {
  getDoc: () => string;
  setDoc: (doc: string) => void;
  getMode: () => StandaloneEditorMode;
  setMode: (mode: StandaloneEditorMode) => void;
  outline: HeadlessPanelStore<readonly OutlineEntry[]>;
  counts: HeadlessPanelStore<Counts>;
  cursorContext: HeadlessPanelStore<CursorContext>;
  scrollToLine: (line: number, opts?: ScrollToLineOptions) => void;
  scrollToPosition: (from: number, opts?: ScrollToPositionOptions) => void;
  focus: () => void;
  unmount: () => void;
}

function toStandaloneMode(mode: string | undefined): StandaloneEditorMode {
  return mode === "source" ? "source" : "rich";
}

export function mountEditor(options: MountEditorOptions): MountedEditor {
  const initialDoc = options.doc ?? "";
  const initialMode = options.mode ?? "rich";
  let currentDoc = initialDoc;
  let currentMode: StandaloneEditorMode = "rich";
  let suppressModeCallback = false;
  const panelApi = createPerFilePanelApi();

  options.parent.replaceChildren();

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      const nextDoc = update.state.doc.toString();
      currentDoc = nextDoc;
      const programmaticDocChange = update.transactions.some((tr) =>
        tr.annotation(programmaticDocumentChangeAnnotation),
      );
      if (!programmaticDocChange) {
        options.onChange?.(nextDoc);
      }
    }

    const nextMode = toStandaloneMode(update.state.field(editorModeField, false));
    if (nextMode !== currentMode) {
      currentMode = nextMode;
      if (!suppressModeCallback) {
        options.onModeChange?.(nextMode);
      }
    }
  });

  let view: EditorView | null = createEditor({
    parent: options.parent,
    doc: initialDoc,
    extensions: [
      updateListener,
      panelApi.extension,
      ...(options.requestHandler
        ? [requestHandlerFacet.of(options.requestHandler)]
        : []),
      ...(options.statusEvents
        ? [statusEventsFacet.of(options.statusEvents)]
        : []),
      ...(options.extensions ?? []),
    ],
  });
  panelApi.attach(view);

  if (initialMode !== "rich") {
    suppressModeCallback = true;
    setEditorMode(view, initialMode);
    suppressModeCallback = false;
  }

  currentMode = toStandaloneMode(view.state.field(editorModeField, false));

  return {
    getDoc() {
      return currentDoc;
    },

    setDoc(doc) {
      currentDoc = doc;
      if (!view || doc === view.state.doc.toString()) {
        return;
      }

      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: doc,
        },
        selection: { anchor: 0 },
        annotations: programmaticDocumentChangeAnnotation.of(true),
      });
      view.scrollDOM.scrollTop = 0;
    },

    getMode() {
      return currentMode;
    },

    setMode(mode) {
      if (!view) {
        currentMode = mode;
        return;
      }
      setEditorMode(view, mode);
    },

    outline: panelApi.outline,

    counts: panelApi.counts,

    cursorContext: panelApi.cursorContext,

    scrollToLine(line, opts) {
      panelApi.scrollToLine(line, opts);
    },

    scrollToPosition(from, opts) {
      panelApi.scrollToPosition(from, opts);
    },

    focus() {
      view?.focus();
    },

    unmount() {
      if (!view) {
        return;
      }
      const mountedView = view;
      view = null;
      panelApi.detach();
      mountedView.destroy();
      options.parent.replaceChildren();
    },
  };
}

// React click-to-edit primitive (Phase 2.7, issue #4).
export {
  EditableReader,
  preloadEditableReaderEditor,
  type EditableReaderMode,
  type EditableReaderProps,
  type EditableReaderRenderOptions,
} from "./editable-reader";

// Lower-level API: re-export everything from src/editor/index.ts so that
// shells which need fine-grained control (compartments, plugins, theme,
// project config, etc.) can import them straight from this package.
export * from "./src/editor";
export * from "./src/headless/per-file-panels";

// Kitchen-sink re-exports for the coflat shell, which reaches into many
// editor-library submodules. Cosheaf only needs the standalone API above.
//
// Citation helpers (CslProcessor, parseBibTeX, etc.) have moved to the
// `@chaoxu/coflat-editor/citeproc` sub-entry so the main bundle no longer
// transitively depends on citation-js. Hosts that need them import from
// there explicitly.
export * from "./src/constants";
export * from "./src/constants/block-manifest";
export * from "./src/constants/css-classes";
export * from "./src/constants/events";
export * from "./src/debug/debug-bridge-ready";
export * from "./src/debug/editor-runtime-contract";
export * from "./src/debug/session-recorder";
export * from "./src/debug/tree-view-portal-context";
export * from "./src/debug/debug-bridge-contract-types";
export * from "./src/editor-display-mode";
export * from "./src/editor-host-api";
export * from "./src/product";
export * from "./src/project-config";
export * from "./src/theme-contract";
export * from "./src/document-surfaces";
export * from "./src/document-surface-classes";
export * from "./src/inline-editor";
export * from "./src/inline-fragments";
export * from "./src/inline-surface";
export * from "./src/preview-surface";
export * from "./src/filesystem/file-system-context";
// export * from "./src/render/reference-render-test-utils"; // test utils only, imports vitest
// export * from "./src/test-utils"; // test utils only, imports vitest
export * from "./src/semantics/document";
export * from "./src/editor/debug-lane-state";
export * from "./src/editor/editor-plugin-metadata";
export * from "./src/editor/image-insert";
export * from "./src/editor/programmatic-document-change";
export * from "./src/editor/scroll-stability";
export * from "./src/editor/theme-config";
export * from "./src/index";
export * from "./src/index/indexer";
export * from "./src/index/query-api";
export * from "./src/latex/index";
export * from "./src/lib/context-menu";
export * from "./src/lib/debug-types";
export * from "./src/lib/editor-document-diff";
export * from "./src/lib/file-tree-model";
export * from "./src/lib/katex-options";
export * from "./src/lib/markdown-reference-paths";
// ./src/lib/markdown/heading-syntax covered by ./src/semantics/document
// export * from "./src/lib/markdown/headings"; // conflicts with ./src/semantics/document on findTrailingHeadingAttributes, hasUnnumberedHeadingAttributes
export * from "./src/lib/markdown/index";
export * from "./src/lib/markdown/label-parser";
export * from "./src/lib/markdown/text-lines";
export * from "./src/lib/open-link";
export * from "./src/lib/perf";
export * from "./src/lib/project-file-paths";
export * from "./src/lib/tauri";
export * from "./src/lib/types";
// ./src/lib/ui/context-menu conflicts with ./src/lib/context-menu (same symbol names; picked the latter)
export * from "./src/lib/utils";
export * from "./src/parser";
export * from "./src/parser/equation-label";
export * from "./src/parser/fenced-div";
export * from "./src/parser/footnote";
export * from "./src/parser/frontmatter";
export * from "./src/parser/math-backslash";
export * from "./src/plugins";
export * from "./src/plugins/plugin-types";
export * from "./src/render";
export * from "./src/render/image-url-cache";
export * from "./src/render/inline-shared";
export * from "./src/render/pdf-preview-cache";
export * from "./src/render/render-core";
// ./src/search doesn't exist as a barrel
// ./src/semantics/document covered above by re-export
export * from "./src/semantics/document-label-backlinks";
export * from "./src/semantics/document-label-rename";
export * from "./src/semantics/heading-ancestry-types";
export * from "./src/semantics/incremental/cached-document-analysis";
export * from "./src/semantics/reference-catalog";
export * from "./src/semantics/reference-conflicts";
export * from "./src/state/bib-data";
export * from "./src/state/block-counter";
export * from "./src/state/change-detection";
export * from "./src/state/dev-settings";
export * from "./src/state/document-analysis";
export * from "./src/state/document-label-graph";
export * from "./src/state/frontmatter-state";
export * from "./src/state/math-macros";
export * from "./src/state/plugin-registry";
