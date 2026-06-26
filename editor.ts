import type { ChangeSet, Extension } from "@codemirror/state";
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
import { programmaticDocumentChangeAnnotation } from "./src/editor/state/programmatic-document-change";
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
import type { CslJsonItem } from "./src/core/citations/csl-json";
import type { FileSystem } from "./src/core/lib/file-system-types";
import {
  sourceElementAtPosition,
  visibleSourcePositionInScroller,
} from "./src/core/source-range-surface";
import {
  documentContextExtension,
  setDocumentContext,
} from "./src/editor/document-context";
import { documentPathFacet, fileSystemFacet } from "./src/editor/lib/types";
import { bibDataEffect, type BibData } from "./src/editor/state/bib-data";
import { createSaveController, saveExtension } from "./src/editor/save-handler";
import {
  assetUploaderExtension,
  type AssetUploader,
} from "./src/editor/asset-uploader";
import { autocompleteSourceExtension } from "./src/editor/autocomplete-source-controller";
import { sidenotesCollapsedField } from "./src/editor/render";

export type StandaloneEditorMode = "rich" | "rich-readonly" | "source";

export interface MountEditorOptions {
  /** DOM element that receives the mounted editor. */
  parent: HTMLElement;
  /** Initial markdown content. Defaults to an empty document. */
  doc?: string;
  /**
   * Initial display mode. `rich-readonly` uses the same CM6-rendered document
   * surface as rich mode, disables editing, and collapses footnotes into the
   * reader-style document-tail section.
   */
  mode?: StandaloneEditorMode;
  /** Extra CodeMirror extensions supplied by the host. */
  extensions?: readonly Extension[];
  /** Initial sidenote layout. Collapsed renders footnotes in the document tail. */
  sidenotesCollapsed?: boolean;
  /** Host context for links, references, citations, file I/O, and math. */
  context?: DocumentContext;
  /** Host-backed file system for local media previews and repository assets. */
  fileSystem?: FileSystem;
  /** Host commands; ids matching built-ins override the library command. */
  commands?: readonly Command[];
  /** Called for direct user edits only. */
  onChange?: (doc: string) => void;
  /** Called for direct user edits with CodeMirror change metadata. */
  onDocumentChange?: (change: MountedDocumentChange) => void;
  /** Called whenever the effective rich/rich-readonly/source mode changes. */
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

export interface MountedDocumentChange {
  changes: ChangeSet;
}

export interface EditorSourcePosition {
  /** Absolute UTF-16 source offset in the current document. */
  readonly pos: number;
  /** 1-based source line containing `pos`. */
  readonly line: number;
  /** Vertical viewport ratio of the rendered source carrier, when available. */
  readonly viewportRatio?: number;
  /** Absolute viewport y coordinate of the rendered source carrier, when available. */
  readonly viewportY?: number;
}

export interface VisibleSourcePositionOptions {
  /**
   * Vertical viewport ratio to sample inside the editor scroller. Defaults to
   * 0.5 so hosts can map "the content I am looking at" across read/edit modes.
   */
  readonly viewportRatio?: number;
  /** Absolute viewport x coordinate. Defaults to the editor scroller center. */
  readonly x?: number;
  /** Absolute viewport y coordinate. Overrides `viewportRatio` when supplied. */
  readonly y?: number;
}

export interface ScrollToSourcePositionOptions extends ScrollToPositionOptions {
  readonly pos?: number;
  readonly line?: number;
  readonly viewportRatio?: number;
  readonly viewportY?: number;
  readonly select?: boolean;
}

export interface MountedEditor {
  getDoc: () => string;
  setDoc: (doc: string) => void;
  setContext: (context: DocumentContext) => void;
  getMode: () => StandaloneEditorMode;
  setMode: (mode: StandaloneEditorMode) => void;
  getVisibleSourcePosition: (opts?: VisibleSourcePositionOptions) => EditorSourcePosition | null;
  scrollToSourcePosition: (position: EditorSourcePosition | ScrollToSourcePositionOptions) => void;
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
  if (mode === "source" || mode === "rich-readonly") return mode;
  return "rich";
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function bibDataFromDocumentContext(context: DocumentContext | undefined): BibData | null {
  if (!context?.citationFormatter || !context.citationKeys || context.citationKeys.size === 0) {
    return null;
  }
  const store = new Map<string, CslJsonItem>();
  for (const id of context.citationKeys) {
    store.set(id, { id, type: "article" });
  }
  return { store, formatter: context.citationFormatter };
}

function applyDocumentContext(view: EditorView, context: DocumentContext): void {
  setDocumentContext(view, context);
  const bibData = bibDataFromDocumentContext(context);
  if (bibData) view.dispatch({ effects: bibDataEffect.of(bibData) });
}

function getVisibleSourcePosition(
  view: EditorView,
  opts: VisibleSourcePositionOptions = {},
): EditorSourcePosition | null {
  if (opts.x === undefined && opts.y === undefined) {
    const renderedPosition = visibleSourcePositionInScroller(view.scrollDOM, { viewportRatio: opts.viewportRatio });
    if (renderedPosition) {
      const pos = Math.max(0, Math.min(view.state.doc.length, renderedPosition.pos));
      return {
        pos,
        line: view.state.doc.lineAt(pos).number,
        viewportRatio: renderedPosition.viewportRatio,
        viewportY: renderedPosition.viewportY,
      };
    }
  }
  const rect = view.scrollDOM.getBoundingClientRect();
  const x = opts.x ?? rect.left + Math.max(1, rect.width / 2);
  const y = opts.y ?? rect.top + rect.height * clampRatio(opts.viewportRatio ?? 0.5);
  let rawPos = view.viewport.from;
  try {
    rawPos = view.posAtCoords({ x, y }, false) ?? view.viewport.from;
  } catch (_error) {
    rawPos = view.viewport.from;
  }
  if (!Number.isFinite(rawPos)) return null;
  const pos = Math.max(0, Math.min(view.state.doc.length, rawPos));
  return {
    pos,
    line: view.state.doc.lineAt(pos).number,
  };
}

export function mountEditor(options: MountEditorOptions): MountedEditor {
  const initialDoc = options.doc ?? "";
  const initialMode = options.mode ?? "rich";
  const initialSidenotesCollapsed = options.sidenotesCollapsed ?? initialMode === "rich-readonly";
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
        options.onDocumentChange?.({ changes: update.changes });
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
      ...(options.fileSystem ? [fileSystemFacet.of(options.fileSystem)] : []),
      [sidenotesCollapsedField.init(() => initialSidenotesCollapsed)],
      ...(options.extensions ?? []),
      ...(options.commands ? [commandRegistryExtension(options.commands)] : []),
      documentContextExtension(options.context),
    ],
  });
  panelApi.attach(view);
  const initialBibData = bibDataFromDocumentContext(options.context);
  if (initialBibData) view.dispatch({ effects: bibDataEffect.of(initialBibData) });

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
      applyDocumentContext(view, context);
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

    getVisibleSourcePosition(opts) {
      return view ? getVisibleSourcePosition(view, opts) : null;
    },

    scrollToSourcePosition(position) {
      if (!view) return;
      const pos = typeof position.pos === "number"
        ? position.pos
        : typeof position.line === "number"
          ? view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, position.line))).from
          : 0;
      const center = "center" in position ? position.center : true;
      const target = Math.max(0, Math.min(view.state.doc.length, pos));
      const select = "select" in position ? position.select !== false : true;
      view.dispatch({
        selection: select ? { anchor: target } : undefined,
        effects: center || !select
          ? EditorView.scrollIntoView(target, center ? { y: "center" } : undefined)
          : undefined,
        scrollIntoView: select && !center,
      });
      const viewportY = "viewportY" in position ? position.viewportY : undefined;
      const viewportRatio = "viewportRatio" in position ? position.viewportRatio : undefined;
      if (typeof viewportRatio === "number") {
        const ratio = clampRatio(viewportRatio);
        const align = () => {
          if (!view) return;
          const targetY = typeof viewportY === "number" && Number.isFinite(viewportY) ? viewportY : undefined;
          const element = sourceElementAtPosition(view.scrollDOM, target);
          if (element) {
            const rect = view.scrollDOM.getBoundingClientRect();
            const elementRect = element.getBoundingClientRect();
            view.scrollDOM.scrollTop += elementRect.top - (targetY ?? (rect.top + rect.height * ratio));
            return;
          }
          let coords: ReturnType<EditorView["coordsAtPos"]>;
          try {
            coords = view.coordsAtPos(target);
          } catch (_error) {
            return;
          }
          if (!coords) return;
          const rect = view.scrollDOM.getBoundingClientRect();
          view.scrollDOM.scrollTop += coords.top - (targetY ?? (rect.top + rect.height * ratio));
        };
        let frames = 0;
        const alignFrame = () => {
          align();
          frames += 1;
          if (frames < 8) requestAnimationFrame(alignFrame);
        };
        requestAnimationFrame(alignFrame);
      }
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
