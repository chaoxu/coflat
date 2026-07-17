import { codeLanguageDescriptions } from "./code-languages";
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

export const fenceLanguageAutocompleteEditorPlugin: EditorPlugin = {
  id: "fence-language-autocomplete",
  name: "Fence Language Autocomplete",
  description: "Completions for code-fence info strings (``` languages)",
  defaultEnabled: true,
  loadTiming: "after-mount",
  readyPhase: "fence-language-autocomplete-ready",
  // Served through the single autocompletion instance owned by
  // reference-autocomplete (extraCompletionSourcesFacet), so this plugin is
  // inert until the reference-autocomplete plugin is active.
  load: async () =>
    (await import("./fence-language-autocomplete")).fenceLanguageAutocompleteExtension(
      codeLanguageDescriptions,
    ),
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
  fenceLanguageAutocompleteEditorPlugin,
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
