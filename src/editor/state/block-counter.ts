import { type EditorState, StateField, type Transaction } from "@codemirror/state";

import type { NumberingScheme } from "../../core/parser/frontmatter";
import {
  type BlockCounterState,
  computeBlockNumbers,
} from "./block-counter-core";
import { createChangeChecker } from "./change-detection";
import {
  documentAnalysisField,
  getDocumentAnalysisSliceRevision,
} from "./document-analysis";
import { frontmatterField } from "./frontmatter-state";
import { pluginRegistryField } from "./plugin-registry";

export type {
  BlockCounterState,
  NumberedBlock,
} from "./block-counter-core";

/** Read the effective numbering scheme from frontmatter state. */
function getEffectiveNumbering(state: EditorState): NumberingScheme {
  return state.field(frontmatterField).config.numbering ?? "grouped";
}

const fencedDivsRevisionChanged = createChangeChecker((state) =>
  getDocumentAnalysisSliceRevision(state.field(documentAnalysisField), "fencedDivs")
);

const blockCounterConfigChanged = createChangeChecker(
  (state) => state.field(pluginRegistryField),
  getEffectiveNumbering,
);

function shouldRecomputeBlockNumbers(tr: Transaction): boolean {
  // Check fencedDivs first — revision can change from async tree updates
  // (Lezer parse completion), not just doc edits. Without this, block
  // numbers go stale when the parser discovers new fenced divs after the
  // initial partial parse (#752).
  if (fencedDivsRevisionChanged(tr)) {
    return true;
  }

  if (!tr.docChanged && !tr.reconfigured) {
    return false;
  }

  return blockCounterConfigChanged(tr);
}


/**
 * CM6 StateField that maintains block numbering.
 *
 * Depends on the pluginRegistryField to know which plugins are
 * registered and which counter groups they use.
 *
 * Usage:
 * ```ts
 * const counters = state.field(blockCounterField);
 * const entry = counters.byId.get("thm-1");
 * ```
 */
export const blockCounterField = StateField.define<BlockCounterState>({
  create(state) {
    return computeBlockNumbers(
      state,
      state.field(pluginRegistryField),
      getEffectiveNumbering(state),
    );
  },

  update(value, tr) {
    if (!shouldRecomputeBlockNumbers(tr)) {
      return value;
    }

    // Recompute straight from the analysis snapshot. `byPosition` is looked up
    // with the positions the renderer reads out of that same snapshot
    // (`collectFencedDivs`), so the two must come from one source: mapping the
    // previous positions through `tr.changes` instead, or keeping them on a
    // no-doc-change reconciliation, lets the counter drift out of the
    // renderer's reach and the block header silently loses its number until
    // some later edit happens to force a full recompute.
    return computeBlockNumbers(
      tr.state,
      tr.state.field(pluginRegistryField),
      getEffectiveNumbering(tr.state),
    );
  },

  compare(a, b) {
    if (a.blocks.length !== b.blocks.length) return false;
    for (let i = 0; i < a.blocks.length; i++) {
      const ba = a.blocks[i];
      const bb = b.blocks[i];
      if (
        ba.from !== bb.from || ba.to !== bb.to ||
        ba.type !== bb.type || ba.id !== bb.id ||
        ba.number !== bb.number
      ) return false;
    }
    return true;
  },
});
