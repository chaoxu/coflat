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
} from "./src/editor/headless/per-file-panels";
import { programmaticDocumentChangeAnnotation } from "./src/editor/programmatic-document-change";
import {
  autocompleteSourcesFacet,
  requestHandlerFacet,
  saveHandlerFacet,
  statusEventsFacet,
  type AutocompleteSource,
  type RequestHandler,
  type SaveHandler,
  type StatusEvents,
} from "./src/editor/editor-host-api";
import {
  commandRegistryExtension,
  type Command,
} from "./src/editor/command-registry";
import type { DocumentContext } from "./src/core/document-context-types";
import {
  documentContextExtension,
  setDocumentContext,
} from "./src/editor/document-context";
import { documentPathFacet } from "./src/editor/lib/types";
import { createSaveController, saveExtension } from "./src/editor/save-handler";
import {
  assetUploaderExtension,
  type AssetUploader,
} from "./src/editor/asset-uploader";
import { autocompleteSourceExtension } from "./src/editor/autocomplete-source-controller";
import { hoverPreviewExtension } from "./src/editor/render/hover-preview";

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
  /** Host context for links, references, citations, file I/O, and math. */
  context?: DocumentContext;
  /** Host commands; ids matching built-ins override the library command. */
  commands?: readonly Command[];
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
  /**
   * Host-supplied persistence. When present, Ctrl/Cmd-S, autosave, and
   * {@link MountedEditor.triggerSave} dispatch through {@code save}.
   * See `SaveHandler`.
   */
  saveHandler?: SaveHandler;
  /**
   * Host-supplied asset upload pipeline for paste/drop. When present,
   * dropped/pasted files insert an `upload:<id>` placeholder, fire
   * {@link StatusEvents.onAssetUploading}, and rewrite to the returned
   * path (or an `upload-error:<id>` marker) once the host resolves.
   * See `AssetUploader`.
   */
  assetUploader?: AssetUploader;
  /**
   * Trigger-based autocomplete sources. Each source declares
   * a `trigger` string (e.g. "[@", "#"). On match, the library debounces
   * (~80ms by default), calls `suggest(prefix, env)` with a cancellable
   * AbortSignal, aggregates results from sources sharing the trigger,
   * and forwards to {@link RequestHandler.openAutocomplete} (or the
   * library default picker).
   */
  autocompleteSources?: readonly AutocompleteSource[];
  /**
   * Optional source-file identifier passed into
   * {@link AutocompleteEnv.from}. Usually the path the document was
   * loaded from.
   */
  from?: string;
}

export interface MountedEditor {
  getDoc: () => string;
  setDoc: (doc: string) => void;
  setContext: (context: DocumentContext) => void;
  getMode: () => StandaloneEditorMode;
  setMode: (mode: StandaloneEditorMode) => void;
  outline: HeadlessPanelStore<readonly OutlineEntry[]>;
  counts: HeadlessPanelStore<Counts>;
  cursorContext: HeadlessPanelStore<CursorContext>;
  scrollToLine: (line: number, opts?: ScrollToLineOptions) => void;
  scrollToPosition: (from: number, opts?: ScrollToPositionOptions) => void;
  focus: () => void;
  unmount: () => void;
  /** True when the live doc matches the last successfully-saved source. */
  isSaved: () => boolean;
  /** Explicit save entry point. Resolves once the dispatch settles. */
  triggerSave: (reason?: "manual" | "command") => Promise<void>;
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
      ...(options.saveHandler
        ? [saveHandlerFacet.of(options.saveHandler)]
        : []),
      saveExtension(),
      ...(options.assetUploader
        ? [assetUploaderExtension(options.assetUploader)]
        : []),
      ...(options.autocompleteSources && options.autocompleteSources.length > 0
        ? [
            autocompleteSourcesFacet.of(options.autocompleteSources),
            autocompleteSourceExtension({ from: options.from }),
          ]
        : []),
      ...(options.from ? [documentPathFacet.of(options.from)] : []),
      hoverPreviewExtension,
      ...(options.extensions ?? []),
      ...(options.commands ? [commandRegistryExtension(options.commands)] : []),
      documentContextExtension(options.context),
    ],
  });
  panelApi.attach(view);

  if (initialMode !== "rich") {
    suppressModeCallback = true;
    setEditorMode(view, initialMode);
    suppressModeCallback = false;
  }

  currentMode = toStandaloneMode(view.state.field(editorModeField, false));

  const saveController = createSaveController(view);

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

    setContext(context) {
      if (!view) return;
      setDocumentContext(view, context);
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

    isSaved() {
      return view ? saveController.isSaved() : true;
    },

    async triggerSave(reason: "manual" | "command" = "manual") {
      if (!view) return;
      await saveController.triggerSave(reason);
    },
  };
}

export {
  EditableReader,
  preloadEditableReaderEditor,
  type EditableReaderMode,
  type EditableReaderProps,
  type EditableReaderRenderOptions,
} from "./editable-reader";
export type {
  DocumentContext,
  HostLinkResolution,
  HostReferenceResolution,
  LinkResolver,
  LinkResolverEnv,
  RefResolver,
  RefResolverClusterEnv,
  RefResolverEnv,
  ReferenceMode,
  SourceRange,
} from "./src/core/document-context-types";

// Lower-level editor API for hosts that need direct CodeMirror control.
export * from "./src/editor";
export * from "./src/editor/headless/per-file-panels";
