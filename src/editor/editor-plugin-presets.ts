import type { EditorPlugin } from "./editor-plugin";
import { listOutlinerExtension } from "./list-outliner";

export type EditorPluginPresetName = "core" | "workbench";

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

export const findReplaceEditorPlugin: EditorPlugin = {
  id: "find-replace",
  name: "Find & Replace",
  description: "In-document search panel (Cmd+F)",
  defaultEnabled: true,
  loadTiming: "after-mount",
  readyPhase: "find-replace-ready",
  load: async () => (await import("./find-replace")).findReplaceExtension,
};

export const workbenchEditorPlugins: readonly EditorPlugin[] = [
  listOutlinerEditorPlugin,
  referenceAutocompleteEditorPlugin,
  blockTypePickerEditorPlugin,
  findReplaceEditorPlugin,
];

export const editorPluginPresets: Record<EditorPluginPresetName, readonly EditorPlugin[]> = {
  core: [],
  workbench: workbenchEditorPlugins,
};

export function resolveEditorPluginPreset(
  preset: EditorPluginPresetName | readonly EditorPlugin[] | undefined,
): readonly EditorPlugin[] {
  if (!preset) return editorPluginPresets.workbench;
  if (typeof preset !== "string") return preset;
  return editorPluginPresets[preset];
}
