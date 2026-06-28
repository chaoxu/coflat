import type { EditorPlugin } from "./editor-plugin";
import { focusModeExtension } from "./render/focus-mode";
import { spellcheckExtension } from "./spellcheck";
import {
  debugInspectorPluginMetadata,
  findReplacePluginMetadata,
  focusModePluginMetadata,
  hoverPreviewPluginMetadata,
  spellcheckPluginMetadata,
} from "./editor-plugin-metadata";

export const focusModePlugin: EditorPlugin = {
  ...focusModePluginMetadata,
  extensions: () => focusModeExtension,
};

export const debugInspectorEditorPlugin: EditorPlugin = {
  ...debugInspectorPluginMetadata,
  loadTiming: "after-mount",
  readyPhase: "debug-inspector-ready",
  load: async () => (await import("./render/debug-inspector")).debugInspectorPlugin,
};

export const hoverPreviewPlugin: EditorPlugin = {
  ...hoverPreviewPluginMetadata,
  loadTiming: "after-mount",
  readyPhase: "hover-preview-ready",
  load: async () => (await import("./render/hover-preview")).hoverPreviewExtension,
};

export const spellcheckPlugin: EditorPlugin = {
  ...spellcheckPluginMetadata,
  extensions: () => spellcheckExtension,
};

export const findReplacePlugin: EditorPlugin = {
  ...findReplacePluginMetadata,
  loadTiming: "after-mount",
  readyPhase: "find-replace-ready",
  load: async () => (await import("./find-replace")).findReplaceExtension,
};

export const defaultEditorPlugins: EditorPlugin[] = [
  focusModePlugin,
  debugInspectorEditorPlugin,
  spellcheckPlugin,
  findReplacePlugin,
];
