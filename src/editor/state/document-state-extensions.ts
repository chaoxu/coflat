import { type Extension } from "@codemirror/state";
import { referencePresentationField } from "../references/presentation";
import {
  documentReferenceCatalogField,
  editorBlockReferenceTargetInputsField,
} from "../semantics/editor-reference-catalog";
import { bibDataField } from "./bib-data";
import { blockCounterField } from "./block-counter";
import type { BlockPlugin } from "./block-plugin";
import { activeStructureEditField } from "./cm-structure-edit";
import { documentAnalysisField } from "./document-analysis";
import { documentLabelGraphField } from "./document-label-graph";
import { frontmatterField } from "./frontmatter-state";
import { imageUrlField } from "./image-url";
import { pdfPreviewField } from "./pdf-preview";
import { pendingAnalysisDrainPlugin } from "./pending-analysis-drain";
import { createPluginRegistryField } from "./plugin-registry";

export function coreDocumentStateExtensions(
  defaultPlugins: readonly BlockPlugin[],
): Extension[] {
  return [
    frontmatterField,
    activeStructureEditField,
    documentAnalysisField,
    // Idle consumer for pending analysis regions the budgeted doc-changed
    // reconcile leaves behind (no-op outside an EditorView).
    pendingAnalysisDrainPlugin,
    createPluginRegistryField(defaultPlugins),
    blockCounterField,
    editorBlockReferenceTargetInputsField,
    documentReferenceCatalogField,
    documentLabelGraphField,
    bibDataField,
    // Presentation text depends on bibliography and reference-catalog state.
    referencePresentationField,
    pdfPreviewField,
    imageUrlField,
  ];
}
