import type { EditorPlugin } from "./editor-plugin";
import { listOutlinerExtension } from "./list-outliner";

export type EditorPluginPresetName = "core" | "workbench" | "full";

export const listOutlinerEditorPlugin: EditorPlugin = {
  id: "list-outliner",
  name: "List Outliner",
  description: "Tab/Shift-Tab list indentation behavior",
  defaultEnabled: true,
  readyPhase: "outline-ready",
  extensions: () => listOutlinerExtension,
};

export const referenceAutocompleteEditorPlugin: EditorPlugin = {
  id: "reference-autocomplete",
  name: "Reference Autocomplete",
  description: "Inline completions for document references and citations",
  defaultEnabled: true,
  loadTiming: "after-mount",
  readyPhase: "autocomplete-ready",
  load: async () => (await import("./reference-autocomplete")).referenceAutocompleteExtension,
};

export const blockTypePickerEditorPlugin: EditorPlugin = {
  id: "block-type-picker",
  name: "Block Type Picker",
  description: "Quick picker for fenced block types",
  defaultEnabled: true,
  loadTiming: "after-mount",
  readyPhase: "block-type-picker-ready",
  load: async () => (await import("./block-type-picker")).blockTypePickerExtension,
};

export const workbenchEditorPlugins: readonly EditorPlugin[] = [
  listOutlinerEditorPlugin,
  referenceAutocompleteEditorPlugin,
  blockTypePickerEditorPlugin,
];

export const fullEditorPlugins: readonly EditorPlugin[] = [
  ...workbenchEditorPlugins,
];

export const editorPluginPresets: Record<EditorPluginPresetName, readonly EditorPlugin[]> = {
  core: [],
  workbench: workbenchEditorPlugins,
  full: fullEditorPlugins,
};

export function resolveEditorPluginPreset(
  preset: EditorPluginPresetName | readonly EditorPlugin[] | undefined,
): readonly EditorPlugin[] {
  if (!preset) return editorPluginPresets.full;
  if (typeof preset !== "string") return preset;
  return editorPluginPresets[preset];
}
