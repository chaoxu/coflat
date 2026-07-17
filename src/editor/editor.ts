import { historyField } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "../core/document-surface-classes";
import { autocorrectExtension } from "./autocorrect";
import {
  createMarkdownLanguageExtensions,
  createProjectConfigExtensions,
} from "./base-editor-extensions";
import { codeLanguageDescriptions } from "./code-languages";
import { commandKeymapExtension } from "./command-registry";
import { builtinCommandRegistryExtension } from "./commands";
import {
  autocorrectCompartment,
  blockTypePickerCompartment,
  syntaxHighlightCompartment,
  themeCompartment,
  treeViewCompartment,
} from "./compartments";
import { emitWindowDebugLaneStateChange } from "./debug-lane-state";
import { editorModeField } from "./editor-mode-state";
import type {
  EditorPlugin,
  EditorPluginLifecycleEvent,
  EditorPluginManager as EditorPluginManagerType,
} from "./editor-plugin";
import { EditorPluginManager } from "./editor-plugin";
import {
  type EditorPluginPresetName,
  resolveEditorPluginPreset,
} from "./editor-plugin-presets";
import {
  renderModeExtensions,
  userSettingsExtensions,
} from "./extension-builders";
import { footnoteCommandsExtension } from "./footnote-commands";
import { formattingToolbarExtension } from "./formatting-toolbar";
import { headingFold } from "./heading-fold";
import { editorKeybindings } from "./keybindings";
import { listRenumberExtension } from "./list-renumber";
import { mutedLinesExtension } from "./muted-lines";
import { defaultPlugins } from "./plugins";
import { type ProjectConfig, type ProjectConfigStatus } from "./project-config";
import { cm6RichRenderExtensions } from "./render/cm6-rich-render-extensions";
import { richMouseSelectionStyle } from "./rich-mouse-selection";
import { htmlCopyRendererFacet, richPasteExtension } from "./rich-paste";
import { scrollStabilityExtension } from "./scroll-stability";
import { shellSurfaceOverlayExtension } from "./shell-surface-overlay";
import { stableHeightOracleExtension } from "./stable-height-oracle";
import { coreDocumentStateExtensions } from "./state/document-state-extensions";
import { tableEditingKeymap } from "./table-commands";
import { coflatDarkTheme, coflatTheme } from "./theme";
import { typewriterModeExtension } from "./typewriter-mode";
import { widgetStopIndexCleanupExtension } from "./widget-stop-index";

export {
  type EditorMode,
  editorModeField,
  markdownEditorModes,
  setEditorMode,
} from "./editor-mode-state";

const fallbackDocument = "# Untitled\n";
const debugLaneCompartment = new Compartment();
const pendingDebugLaneEnabled = new WeakSet<EditorView>();
const pendingTreeViewEnabled = new WeakSet<EditorView>();
const defaultDebugLaneExtensions: Extension[] = [];
const cm6DocumentSurfaceExtensions: Extension[] = [
  EditorView.editorAttributes.of({
    class: documentSurfaceClassNames(DOCUMENT_SURFACE_CLASS.surface),
  }),
  EditorView.contentAttributes.of({
    class: documentSurfaceClassNames(DOCUMENT_SURFACE_CLASS.flow),
  }),
];

export {
  autocorrectCompartment,
  lineNumbersCompartment,
  tabSizeCompartment,
  themeCompartment,
  wordWrapCompartment,
} from "./compartments";

/** Core editor chrome that should be present before the first editable pixels. */
function editorChromeExtensions(isDark: boolean): Extension[] {
  return [
    headingFold,
    editorKeybindings,
    widgetStopIndexCleanupExtension,
    scrollStabilityExtension,
    stableHeightOracleExtension,
    richMouseSelectionStyle,
    blockTypePickerCompartment.of([]),
    builtinCommandRegistryExtension,
    commandKeymapExtension,

    // Text-level pipe-table editing. Must be ordered after the rich render
    // extensions so the widget-aware table keymap keeps priority while
    // tables render as widgets (both are Prec.high; extension order decides).
    tableEditingKeymap,

    // Autocorrect + magic quotes. Ordered after the list outliner (its
    // Prec.highest Enter/Backspace keep priority) and after the table
    // editing keymap (Enter in a table navigates rows instead of inserting
    // a newline). Wrapped in a compartment so hosts can disable or
    // reconfigure it at runtime.
    autocorrectCompartment.of(autocorrectExtension()),

    // Footnote authoring commands (Mod-Alt-f insert, Backspace ref guard).
    footnoteCommandsExtension,

    // Selection formatting toolbar (self-contained tooltip field).
    formattingToolbarExtension,

    // Rich clipboard: HTML→markdown paste + paste-plain (Mod-Shift-v).
    richPasteExtension(),

    // Default "Copy as HTML" renderer: the reader's renderToHtml, imported
    // lazily on first use so the reader module graph stays out of the eager
    // editor bundle (the static editor/reader dist graphs stay separate).
    // Hosts can override by providing this facet in `config.extensions`
    // (later values win).
    htmlCopyRendererFacet.of(async (markdown) =>
      (await import("../reader/reader")).renderToHtml(markdown).html,
    ),

    // Ordered-list renumbering after structural list edits.
    listRenumberExtension,

    // Optional writing modes (off by default; toggled via palette commands).
    typewriterModeExtension,
    mutedLinesExtension,

    debugLaneCompartment.of(defaultDebugLaneExtensions),
    coflatTheme,

    // Dark/light base theme (wrapped in compartment for live switching)
    themeCompartment.of(isDark ? coflatDarkTheme : []),

    // Debug tree view (off by default, toggle via window.__cmTreeView())
    treeViewCompartment.of([]),
  ];
}

export interface EditorConfig {
  /** The DOM element to mount the editor into. */
  parent: HTMLElement;
  /** Initial document content. */
  doc?: string;
  /** Project-level configuration to merge with per-file frontmatter. */
  projectConfig?: ProjectConfig;
  /** Structured status for the project configuration source. */
  projectConfigStatus?: ProjectConfigStatus;
  /** Plugin manager for toggleable editor features. */
  pluginManager?: EditorPluginManagerType;
  /**
   * Built-in plugin preset. `workbench` enables user-facing optional UI, and
   * `core` mounts only the shared render/edit surface plus essential editing
   * chrome.
   */
  pluginPreset?: EditorPluginPresetName;
  /** Explicit plugin descriptors. Overrides `pluginPreset` when provided. */
  plugins?: readonly EditorPlugin[];
  /** Additional CM6 extensions to include. */
  extensions?: Extension[];
  /** Optional restored CodeMirror history state for remounting the same document. */
  initialHistoryState?: Cm6HistoryState | null;
  /**
   * Called as optional editor startup features become interactive. These
   * features are dynamically imported so first editor pixels are not blocked
   * by autocomplete or picker UI code.
   */
  onFeatureReady?: (feature: EditorFeature) => void;
  /** Called as optional editor plugins become active. */
  onPluginReady?: (event: EditorPluginLifecycleEvent) => void;
}

export type Cm6HistoryState = unknown;
const editorFeatureIds = [
  "block-type-picker",
  "find-replace",
  "reference-autocomplete",
  "list-outliner",
] as const;
export type EditorFeature = (typeof editorFeatureIds)[number];
const editorFeatureIdSet = new Set<string>(editorFeatureIds);

export function captureEditorHistoryState(state: EditorState): Cm6HistoryState | undefined {
  return state.field(historyField, false);
}

function hasCompartmentContent(extension: Extension | undefined): boolean {
  return extension !== undefined && (!Array.isArray(extension) || extension.length > 0);
}

/**
 * Toggle the Lezer tree-view debug panel.
 * Call from console: `__cmDebug.toggleTreeView()`.
 */
export function toggleTreeView(view: EditorView): boolean {
  const currentEnabled =
    pendingTreeViewEnabled.has(view) || hasCompartmentContent(treeViewCompartment.get(view.state));
  const nextEnabled = !currentEnabled;
  if (nextEnabled) {
    pendingTreeViewEnabled.add(view);
    void import("@overleaf/codemirror-tree-view").then(({ treeView }) => {
      if (!pendingTreeViewEnabled.has(view)) return;
      view.dispatch({
        effects: treeViewCompartment.reconfigure(treeView),
      });
    });
  } else {
    pendingTreeViewEnabled.delete(view);
    view.dispatch({
      effects: treeViewCompartment.reconfigure([]),
    });
  }
  return nextEnabled;
}

export function isDebugLaneEnabled(view: EditorView): boolean {
  return pendingDebugLaneEnabled.has(view) || hasCompartmentContent(debugLaneCompartment.get(view.state));
}

export function setDebugLaneEnabled(view: EditorView, enabled: boolean): boolean {
  if (enabled) {
    pendingDebugLaneEnabled.add(view);
    void import("./debug-panel").then(({ debugPanelExtension }) => {
      if (!pendingDebugLaneEnabled.has(view)) return;
      view.dispatch({
        effects: debugLaneCompartment.reconfigure([
          shellSurfaceOverlayExtension,
          debugPanelExtension,
        ]),
      });
      emitWindowDebugLaneStateChange();
    });
  } else {
    pendingDebugLaneEnabled.delete(view);
    view.dispatch({
      effects: debugLaneCompartment.reconfigure([]),
    });
    emitWindowDebugLaneStateChange();
  }
  return enabled;
}

export function toggleDebugLane(view: EditorView): boolean {
  const nextEnabled = !isDebugLaneEnabled(view);
  setDebugLaneEnabled(view, nextEnabled);
  return nextEnabled;
}

/** Create and mount a CodeMirror 6 markdown editor. */
export function createEditor(config: EditorConfig): EditorView {
  const isDark = document.documentElement.dataset.theme === "dark";
  const pluginManager = config.pluginManager ?? new EditorPluginManager(
    resolveEditorPluginPreset(config.plugins ?? config.pluginPreset),
  );
  const onPluginReady = (event: EditorPluginLifecycleEvent) => {
    config.onPluginReady?.(event);
    if (editorFeatureIdSet.has(event.id)) {
      config.onFeatureReady?.(event.id as EditorFeature);
    }
  };

  const state = EditorState.create({
    doc: config.doc ?? fallbackDocument,
    extensions: [
      // Project config (must come before frontmatterField so the facet is available)
      ...createProjectConfigExtensions(config.projectConfig, config.projectConfigStatus),

      // Parser: markdown with custom extensions + code block language support
      ...createMarkdownLanguageExtensions({
        codeLanguages: codeLanguageDescriptions,
        syntaxHighlighting: false,
      }),
      syntaxHighlightCompartment.of([]),

      // Core document state (frontmatter, semantics, block plugins, caches)
      ...coreDocumentStateExtensions(defaultPlugins),

      // Shared cross-editor document surface contract.
      ...cm6DocumentSurfaceExtensions,

      // Reference autocomplete + block picker are attached after mount.
      // Their module graphs include autocomplete/chrome UI that should not
      // block the first editable document surface.

      // Mode switching (render/editable/modeClass compartments)
      ...renderModeExtensions({
        editorModeField,
        renderingExtensions: cm6RichRenderExtensions,
      }),

      // Toggleable/optional editor plugins.
      ...pluginManager.initialExtensions({ isDark }),

      // User-configurable settings (word wrap, line numbers, tab size)
      ...userSettingsExtensions(tabSizeExtension(2)),

      // Editor chrome (folding, outliner, keybindings, picker, theme)
      ...editorChromeExtensions(isDark),

      ...(config.initialHistoryState
        ? [historyField.init(() => config.initialHistoryState)]
        : []),

      // User-provided extensions last
      ...(config.extensions ?? []),
    ],
  });

  const view = new EditorView({
    state,
    parent: config.parent,
  });
  pluginManager.attach(view, { context: { isDark }, onReady: onPluginReady });
  return view;
}

/** Build a tab-size extension from a numeric size (used by compartment reconfiguration). */
export function tabSizeExtension(size: number): Extension {
  return [EditorState.tabSize.of(size), indentUnit.of(" ".repeat(size))];
}
