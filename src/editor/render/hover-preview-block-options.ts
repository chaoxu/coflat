import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { DocumentSurfaceName } from "../../core/document-surface-policy";
import type { BlockCounterEntry } from "../../core/lib/file-system-types";
import { documentContextFacet } from "../document-context";
import { documentPathFacet } from "../lib/types";
import { blockCounterField } from "../state/block-counter";
import { bibDataField } from "../state/bib-data";
import { documentAnalysisField } from "../state/document-analysis";
import { frontmatterField } from "../state/frontmatter-state";
import { mathMacrosField } from "../state/math-macros";
import { pluginRegistryField } from "../state/plugin-registry";
import { getPlugin } from "../state/plugin-registry-core";
import { getReferenceRenderDependencySignature } from "../state/reference-render-state";
import type { PreviewBlockRenderOptions } from "./preview-block-renderer";
import { serializeMacros } from "./source-widget";

const emptyPreviewConfig = {};
const previewConfigIdentityIds = new WeakMap<object, number>();
let nextPreviewConfigIdentityId = 1;

function getPreviewConfigIdentityId(value: object): number {
  let id = previewConfigIdentityIds.get(value);
  if (id === undefined) {
    id = nextPreviewConfigIdentityId++;
    previewConfigIdentityIds.set(value, id);
  }
  return id;
}

export function getPreviewRenderDependencySignature(
  state: EditorState,
  macros: Record<string, string> = state.field(mathMacrosField, false) ?? {},
): string {
  const config = state.field(frontmatterField, false)?.config ?? emptyPreviewConfig;
  return [
    getReferenceRenderDependencySignature(state),
    serializeMacros(macros),
    getPreviewConfigIdentityId(config),
  ].join("\u0001");
}

export function buildPreviewBlockOptions(
  view: EditorView,
  macros: Record<string, string>,
  imageUrlOverrides?: ReadonlyMap<string, string>,
  documentSurface: DocumentSurfaceName = "editor-preview",
): PreviewBlockRenderOptions {
  const bibData = view.state.field(bibDataField, false);
  const store = bibData?.store ?? new Map();
  const formatter = bibData?.formatter ?? null;
  const frontmatter = view.state.field(frontmatterField, false);
  const analysis = view.state.field(documentAnalysisField, false);
  const counterState = view.state.field(blockCounterField, false);
  const registry = view.state.field(pluginRegistryField, false);

  let blockCounters: Map<string, BlockCounterEntry> | undefined;
  if (counterState) {
    blockCounters = new Map<string, BlockCounterEntry>();
    for (const block of counterState.blocks) {
      if (block.id) {
        const plugin = registry ? getPlugin(registry, block.type) : undefined;
        blockCounters.set(block.id, {
          type: block.type,
          title: plugin?.title ?? block.type,
          number: block.number,
        });
      }
    }
  }

  return {
    macros,
    config: {
      ...frontmatter?.config,
      math: macros,
    },
    bibliography: store.size > 0 ? store : undefined,
    formatter: store.size > 0 ? formatter : undefined,
    blockCounters,
    ...(analysis ? { referenceSemantics: analysis } : {}),
    documentContext: view.state.facet(documentContextFacet),
    documentPath: view.state.facet(documentPathFacet),
    imageUrlOverrides,
    documentSurface,
  };
}
