/**
 * `@chaoxu/coflat` — editable document surface.
 *
 * This entry mounts the shared CM6 rich editor core. Optional UI such as the
 * block picker and fenced-code language packs load dynamically after first
 * editor mount or on demand.
 */

import type { ChangeSet, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { CslJsonItem } from "./src/core/citations/csl-json";
import type { DocumentContext } from "./src/core/document-context-types";
import type { FileSystem } from "./src/core/lib/file-system-types";
import {
  sourceElementAtPosition,
  visibleSourcePositionInScroller,
} from "./src/core/source-range-surface";
import {
  type AssetUploader,
  assetUploaderExtension,
  formatUploadedAssetMarkdown,
} from "./src/editor/asset-uploader";
import { autocompleteSourceExtension } from "./src/editor/autocomplete-source-controller";
import {
  documentContextExtension,
  setDocumentContext,
} from "./src/editor/document-context";
import {
  createEditor,
  type EditorConfig,
  type EditorFeature,
  editorModeField,
  setEditorMode,
} from "./src/editor/editor";
import {
  type AutocompleteSource,
  type AutocompleteEnv,
  type AutocompleteRequest,
  type AutocompleteResult,
  autocompleteSourcesFacet,
  type RequestHandler,
  requestHandlerFacet,
  type SaveHandler,
  type StatusEvents,
  type Suggestion,
  saveHandlerFacet,
  statusEventsFacet,
} from "./src/editor/editor-host-api";
import type {
  EditorPlugin,
  EditorPluginLifecycleEvent,
} from "./src/editor/editor-plugin";
import type { EditorPluginPresetName } from "./src/editor/editor-plugin-presets";
import {
  type Counts,
  type CursorContext,
  createPerFilePanelApi,
  type HeadlessPanelStore,
  type OutlineEntry,
  type ScrollToLineOptions,
  type ScrollToPositionOptions,
} from "./src/editor/headless/per-file-panels";
import { documentPathFacet, fileSystemFacet } from "./src/editor/lib/types";
import { sidenotesCollapsedField } from "./src/editor/render";
import { createSaveController, saveExtension } from "./src/editor/save-handler";
import { type BibData, bibDataEffect } from "./src/editor/state/bib-data";
export {
  type FrontmatterState,
  frontmatterField,
} from "./src/editor/state/frontmatter-state";
import { programmaticDocumentChangeAnnotation } from "./src/editor/state/programmatic-document-change";

export type EditorMode = "rich" | "rich-readonly" | "source";

export interface MountEditorOptions {
  readonly parent: HTMLElement;
  readonly doc?: string;
  readonly mode?: EditorMode;
  readonly context?: DocumentContext;
  readonly fileSystem?: FileSystem;
  readonly from?: string;
  readonly extensions?: readonly Extension[];
  readonly pluginPreset?: EditorPluginPresetName;
  readonly plugins?: readonly EditorPlugin[];
  readonly requestHandler?: RequestHandler;
  readonly statusEvents?: StatusEvents;
  readonly saveHandler?: SaveHandler;
  readonly assetUploader?: AssetUploader;
  readonly autocompleteSources?: readonly AutocompleteSource[];
  readonly sidenotesCollapsed?: boolean;
  readonly onChange?: (doc: string) => void;
  readonly onDocumentChange?: (change: EditorDocumentChange) => void;
  readonly onModeChange?: (mode: EditorMode) => void;
  readonly onFeatureReady?: (feature: EditorFeature) => void;
  readonly onPluginReady?: (event: EditorPluginLifecycleEvent) => void;
}

export interface EditorDocumentChange {
  readonly changes: ChangeSet;
}

export interface EditorSourcePosition {
  readonly pos: number;
  readonly line: number;
  readonly viewportRatio?: number;
  readonly viewportY?: number;
}

export interface EditorVisibleSourcePositionOptions {
  readonly viewportRatio?: number;
  readonly x?: number;
  readonly y?: number;
}

export interface EditorScrollToSourcePositionOptions {
  readonly pos?: number;
  readonly line?: number;
  readonly viewportRatio?: number;
  readonly viewportY?: number;
  readonly select?: boolean;
  readonly center?: boolean;
}

export interface MountedEditor {
  getDoc(): string;
  setDoc(doc: string): void;
  setContext(context: DocumentContext): void;
  getMode(): EditorMode;
  setMode(mode: EditorMode): void;
  getVisibleSourcePosition(opts?: EditorVisibleSourcePositionOptions): EditorSourcePosition | null;
  scrollToSourcePosition(position: EditorSourcePosition | EditorScrollToSourcePositionOptions): void;
  readonly outline: HeadlessPanelStore<readonly OutlineEntry[]>;
  readonly counts: HeadlessPanelStore<Counts>;
  readonly cursorContext: HeadlessPanelStore<CursorContext>;
  scrollToLine(line: number, opts?: ScrollToLineOptions): void;
  scrollToPosition(from: number, opts?: ScrollToPositionOptions): void;
  focus(): void;
  isSaved(): boolean;
  triggerSave(reason?: "manual" | "command"): Promise<void>;
  unmount(): void;
}

function toEditorMode(mode: string | undefined): EditorMode {
  if (mode === "source" || mode === "rich-readonly") return mode;
  return "rich";
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function getVisibleSourcePosition(
  view: EditorView,
  opts: EditorVisibleSourcePositionOptions = {},
): EditorSourcePosition | null {
  if (opts.x === undefined && opts.y === undefined) {
    const renderedPosition = visibleSourcePositionInScroller(view.scrollDOM, {
      viewportRatio: opts.viewportRatio,
    });
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

export function mountEditor(options: MountEditorOptions): MountedEditor {
  const initialDoc = options.doc ?? "";
  const initialMode = options.mode ?? "rich";
  const initialSidenotesCollapsed = options.sidenotesCollapsed ?? initialMode !== "source";
  let currentDoc: string | null = initialDoc;
  let currentMode: EditorMode = "rich";
  let suppressModeCallback = false;
  const panelApi = createPerFilePanelApi();

  options.parent.replaceChildren();

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      currentDoc = null;
      const programmaticDocChange = update.transactions.some((tr) =>
        tr.annotation(programmaticDocumentChangeAnnotation),
      );
      if (!programmaticDocChange) {
        if (options.onChange) {
          const nextDoc = update.state.doc.toString();
          currentDoc = nextDoc;
          options.onChange(nextDoc);
        }
        options.onDocumentChange?.({ changes: update.changes });
      }
    }

    const nextMode = toEditorMode(update.state.field(editorModeField, false));
    if (nextMode !== currentMode) {
      currentMode = nextMode;
      if (!suppressModeCallback) {
        options.onModeChange?.(nextMode);
      }
    }
  });

  const editorConfig: EditorConfig = {
    parent: options.parent,
    doc: initialDoc,
    pluginPreset: options.pluginPreset ?? "workbench",
    plugins: options.plugins,
    onFeatureReady: options.onFeatureReady,
    onPluginReady: options.onPluginReady,
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
      documentContextExtension(options.context),
    ],
  };
  let view: EditorView | null = createEditor(editorConfig);
  panelApi.attach(view);
  const initialBibData = bibDataFromDocumentContext(options.context);
  if (initialBibData) view.dispatch({ effects: bibDataEffect.of(initialBibData) });

  if (initialMode !== "rich") {
    suppressModeCallback = true;
    setEditorMode(view, initialMode);
    suppressModeCallback = false;
  }

  currentMode = toEditorMode(view.state.field(editorModeField, false));
  const saveController = createSaveController(view);

  return {
    getDoc() {
      if (currentDoc === null) {
        currentDoc = view?.state.doc.toString() ?? "";
      }
      return currentDoc;
    },

    setDoc(doc) {
      currentDoc = doc;
      if (!view || doc === view.state.doc.toString()) return;
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
      const center = "center" in position ? position.center !== false : true;
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
      if (typeof viewportRatio !== "number") return;

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

    isSaved() {
      return view ? saveController.isSaved() : true;
    },

    async triggerSave(reason: "manual" | "command" = "manual") {
      if (!view) return;
      await saveController.triggerSave(reason);
    },

    unmount() {
      if (!view) return;
      const mountedView = view;
      view = null;
      panelApi.detach();
      mountedView.destroy();
      options.parent.replaceChildren();
    },
  };
}

export type {
  AssetUploader,
  AutocompleteEnv,
  AutocompleteRequest,
  AutocompleteResult,
  AutocompleteSource,
  Counts,
  CursorContext,
  DocumentContext,
  EditorFeature,
  EditorPlugin,
  EditorPluginLifecycleEvent,
  EditorPluginPresetName,
  HeadlessPanelStore,
  OutlineEntry,
  RequestHandler,
  SaveHandler,
  ScrollToLineOptions,
  ScrollToPositionOptions,
  Suggestion,
  StatusEvents,
};

export { formatUploadedAssetMarkdown };
