export {
  contentFont,
  defaultCodeFontStack,
  defaultContentFontStack,
  defaultUIFontStack,
  monoFont,
  uiFont,
} from "../core/constants/editor-constants";
export type {
  DocumentContext,
  HostLinkResolution,
  HostReferenceResolution,
  LinkResolver,
  LinkResolverEnv,
  ReferenceMode,
  RefResolver,
  RefResolverClusterEnv,
  RefResolverEnv,
  SourceRange,
} from "../core/document-context-types";
export {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "../core/document-surface-classes";
export {
  type AssetUploader,
  assetUploaderExtension,
  formatUploadedAssetMarkdown,
  isUploadedAssetImage,
  type UploadedAssetMarkdownInput,
  type UploadedAssetMarkdownKind,
  uploadedAssetLabel,
} from "./asset-uploader";
export { blockTypePickerExtension, isPickerVisible } from "./block-type-picker";
export {
  type Command,
  type CommandEnv,
  type CommandSurface,
  commandKeymapExtension,
  commandRegistryExtension,
  commandRegistryFacet,
  getPaletteCommands,
  getRegisteredCommands,
  getSlashCommands,
  runRegisteredCommand,
} from "./command-registry";
export {
  builtinCommandRegistryExtension,
  createHeadingCommands,
  getEditorCommandRegistry,
  getEditorCommands,
} from "./commands";
export {
  createDebugHelpers,
  type DebugHelpers,
  type DebugRenderState,
} from "./debug-helpers";
export {
  documentContextCompartment,
  documentContextExtension,
  documentContextFacet,
  setDocumentContext,
} from "./document-context";
export {
  type DocumentFragmentKind,
  type DocumentSurfaceFragment,
  type DocumentSurfaceMode,
  renderDocumentFragmentToDom,
  renderDocumentFragmentToHtml,
} from "./document-surfaces";
export {
  type Cm6HistoryState,
  captureEditorHistoryState,
  createEditor,
  type EditorConfig,
  type EditorLazyFeature,
  lineNumbersCompartment,
  tabSizeCompartment,
  tabSizeExtension,
  themeCompartment,
  wordWrapCompartment,
} from "./editor";
export {
  type AutocompleteEnv,
  type AutocompleteRequest,
  type AutocompleteResult,
  type AutocompleteSource,
  autocompleteSourcesFacet,
  type CommandPaletteRequest,
  type CommandPaletteResult,
  DEFAULT_AUTOCOMPLETE_DEBOUNCE_MS,
  DEFAULT_AUTOSAVE_DEBOUNCE_MS,
  type LinkPickerRequest,
  type LinkPickerResult,
  type RequestHandler,
  requestHandlerFacet,
  type SaveHandler,
  type StatusEvents,
  type Suggestion,
  type SuggestionId,
  saveHandlerFacet,
  statusEventsFacet,
  type UploadToastRequest,
} from "./editor-host-api";
export {
  type EditorMode as Cm6EditorMode,
  editorModeField,
  markdownEditorModes as cm6MarkdownEditorModes,
  setEditorMode,
} from "./editor-mode-state";
export {
  type EditorPlugin,
  type EditorPluginLifecycleEvent,
  type EditorPluginLoadTiming,
  EditorPluginManager,
  type EditorPluginRuntimeContext,
} from "./editor-plugin";
export {
  blockTypePickerEditorPlugin,
  type EditorPluginPresetName,
  editorPluginPresets,
  fullEditorPlugins,
  listOutlinerEditorPlugin,
  referenceAutocompleteEditorPlugin,
  resolveEditorPluginPreset,
  workbenchEditorPlugins,
} from "./editor-plugin-presets";
export { defaultEditorPlugins } from "./editor-plugins-registry";
export {
  closeSearch,
  collectVisibleSearchMatches,
  countSearchMatches,
  findReplaceExtension,
  getSearchControllerState,
  nextSearchMatch,
  openFindSearch,
  openReplaceSearch,
  previousSearchMatch,
  replaceAllSearchMatches,
  replaceCurrentSearchMatch,
  type SearchControllerState,
  type SearchMatchRange,
  type SearchUiState,
  searchControllerExtensions,
  searchUiStateField,
  setSearchControllerQuery,
  setSearchUiState,
  setSearchUiStateEffect,
} from "./find-replace";
export { type ImageDropConfig, imageDropExtension } from "./image-drop";
export { insertImageFromPicker } from "./image-insert";
export { type ImagePasteConfig, imagePasteExtension } from "./image-paste";
export { 
  createImageHandler,
  createImageSaver,
  escapeMarkdownPath,fileToDataUrl, 
  type HandleImageInsertOptions,
  handleImageInsert,
  IMAGE_EXTENSIONS,
  IMAGE_MIME_EXT,
  type ImageSaveConfig,
  type ImageSaveContext,
  insertImageMarkdown,
  isImageMime,
  saveImage,} from "./image-save";
export { createInlineEditor, type InlineEditorOptions } from "./inline-editor";
export { editorKeybindings } from "./keybindings";
export { listOutlinerExtension } from "./list-outliner";
export {
  mergeConfigs,
  PROJECT_CONFIG_FILE,
  type ProjectConfig,
  type ProjectConfigStatus,
  parseProjectConfig,
  projectConfigFacet,
  projectConfigStatusFacet,
} from "./project-config";
export {
  frontmatterDecoration,
} from "./render/frontmatter-render";
export { renderInlineMarkdown } from "./render/inline-render";
export {
  type FrontmatterState,
  frontmatterField,
} from "./state/frontmatter-state";
export {
  programmaticDocumentChangeAnnotation,
} from "./state/programmatic-document-change";
export { coflatDarkTheme, coflatTheme } from "./theme";
export {
  applyThemePreset,
  clearThemePreset,
  type HeadingStyle,
  type ThemePreset,
  themePresetKeys,
  themePresets,
} from "./theme-config";
export {
  blueprintBookThemeManifest,
  COFLAT_READER_CLASS,
  COFLAT_READER_DOCUMENT_CLASS,
  COFLAT_READER_SHELL_CLASS,
  COFLAT_READER_TOC_CLASS,
  COFLAT_THEME_SCOPE_CLASS,
  type CoflatThemeManifest,
  type CoflatThemeTarget,
  themeBlockTokens,
  themeFoundationTokens,
  themeLayerTokenDefaults,
  themeLayerTokens,
  themeTableTokens,
  themeTokenNames,
  themeTypographyTokens,
} from "./theme-contract";
