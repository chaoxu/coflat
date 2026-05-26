import type { EditorView } from "@codemirror/view";
import type { BlockCounterEntry } from "../../core/lib/file-system-types";
import { documentContextFacet } from "../document-context";
import { documentPathFacet } from "../lib/types";
import { blockCounterField } from "../state/block-counter";
import { bibDataField } from "../state/bib-data";
import { documentAnalysisField } from "../state/document-analysis";
import { frontmatterField } from "../state/frontmatter-state";
import { pluginRegistryField } from "../state/plugin-registry";
import { getPlugin } from "../state/plugin-registry-core";
import type { PreviewBlockRenderOptions } from "./preview-block-renderer";

export function buildPreviewBlockOptions(
  view: EditorView,
  macros: Record<string, string>,
  imageUrlOverrides?: ReadonlyMap<string, string>,
): PreviewBlockRenderOptions {
  const { store, formatter } = view.state.field(bibDataField);
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
  };
}
