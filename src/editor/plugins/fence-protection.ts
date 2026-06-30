/**
 * Transaction filters and atomic ranges that protect fenced block fence syntax
 * (fenced divs, fenced code blocks, and display math) from accidental edits
 * in rich mode.
 *
 * Extracted from plugin-render.ts so that fence protection is a standalone
 * module with clear boundaries. The blockRenderPlugin wires this extension
 * into the editor; block-type-picker uses the bypass annotation.
 *
 * Unified in #441 to cover both `::: {.class} ... :::` fenced divs and
 * ``` ``` ... ``` ``` fenced code blocks with a single protection stack.
 * Extended in #777 to cover `$$ ... $$` and `\[ ... \]` display math.
 *
 * Provides:
 * - `fenceOperationAnnotation` — bypass annotation for programmatic edits
 * - `getClosingFenceRanges` — closing fence line ranges (divs + code blocks + math)
 * - `getOpeningFenceColonRanges` — opening fence colon-prefix ranges (divs only)
 * - `getOpeningFenceBacktickRanges` — opening fence backtick-prefix ranges (code blocks only)
 * - `getOpeningMathDelimiterRanges` — opening math delimiter ranges (display math only)
 * - `fenceProtectionExtension` — unified CM6 extension with one transaction pipeline
 * - `pairedMathEntry` — auto-insert closing delimiter when typing $$ or \[
 * - `closingFenceAtomicRanges` — cursor skips over hidden closing fences
 */

import {
  Annotation,
  EditorState,
  type Extension,
  type Transaction,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { programmaticDocumentChangeAnnotation } from "../state/programmatic-document-change";
import { createPairedMathEntry } from "./fence-math-entry";
import {
  docChangeCouldAffectDisplayMathFences,
  fenceProtectionCacheField,
  getFenceProtectionCache,
} from "./fence-protection-cache";
import {
  type FenceChangeSpec,
  type FenceRange,
} from "./fence-protection-pipeline";
import {
  createFenceProtectionTransactionFilter,
} from "./fence-transaction-filters";

// ---------------------------------------------------------------------------
// Fence protection
// ---------------------------------------------------------------------------

/** Annotation to bypass fence protection filters (used by block-type picker). */
export const fenceOperationAnnotation = Annotation.define<true>();

function shouldBypassFenceProtection(tr: Transaction): boolean {
  return !tr.docChanged
    || Boolean(tr.annotation(fenceOperationAnnotation))
    || Boolean(tr.annotation(programmaticDocumentChangeAnnotation));
}

function annotateFenceRewrite(
  changes: FenceChangeSpec | readonly FenceChangeSpec[],
) {
  return {
    changes,
    annotations: fenceOperationAnnotation.of(true),
  };
}

/**
 * Collect closing fence line ranges for protection from fenced divs,
 * fenced code blocks, and display math. All multi-line code blocks and
 * display math blocks are protected unconditionally (they have no
 * registry/class filtering like divs).
 */
export function getClosingFenceRanges(state: EditorState): readonly FenceRange[] {
  return getFenceProtectionCache(state).closingFenceRanges;
}

/** Collect opening fence colon-prefix ranges for protection (fenced divs only). */
export function getOpeningFenceColonRanges(state: EditorState): readonly FenceRange[] {
  return getFenceProtectionCache(state).openingFenceColonRanges;
}

/** Collect opening fence backtick-prefix ranges for protection (code blocks only). */
export function getOpeningFenceBacktickRanges(state: EditorState): readonly FenceRange[] {
  return getFenceProtectionCache(state).openingFenceBacktickRanges;
}

/** Collect opening math delimiter ranges for protection (display math only). */
export function getOpeningMathDelimiterRanges(state: EditorState): readonly FenceRange[] {
  return getFenceProtectionCache(state).openingMathDelimiterRanges;
}

/**
 * Atomic ranges for closing fence lines so the cursor skips over them.
 *
 * Covers both fenced divs and fenced code blocks. Uses EditorView.atomicRanges
 * to make hidden closing fences behave as a single atomic unit — the cursor
 * jumps from the last content line to the start of the next block or paragraph
 * without stopping on the fence.
 */
const closingFenceAtomicRanges = EditorView.atomicRanges.of((view) => {
  return getFenceProtectionCache(view.state).closingFenceAtomicRanges;
});

/**
 * Input handler for paired math entry. When the user completes a display math
 * opening delimiter on a blank line ($$ or \[), auto-insert the closing
 * delimiter and place the cursor between them.
 *
 * Skips auto-insert if the next non-blank line already contains the matching
 * closing delimiter (bracket-match skip).
 */
const pairedMathEntry = createPairedMathEntry(fenceOperationAnnotation);

const fenceProtectionTransactionFilter = createFenceProtectionTransactionFilter({
  shouldBypassFenceProtection,
  annotateFenceRewrite,
  getFenceProtectionDecisionInputs(state) {
    const cache = getFenceProtectionCache(state);
    return {
      allFencedBlocks: cache.allFencedBlocks,
      closingFenceRanges: cache.closingFenceRanges,
      openingFenceColonRanges: cache.openingFenceColonRanges,
      openingFenceBacktickRanges: cache.openingFenceBacktickRanges,
      openingMathDelimiterRanges: cache.openingMathDelimiterRanges,
    };
  },
});

/**
 * Combined CM6 extension for all fence protection behavior.
 *
 * Covers fenced divs, fenced code blocks (#441), and display math (#777).
 * The transaction filter now runs one explicit decision pipeline:
 * block illegal edits first, then apply cleanup rewrites, so behavior no
 * longer depends on a stack of separately registered filters.
 */
export const fenceProtectionExtension: Extension = [
  fenceProtectionCacheField,
  fenceProtectionTransactionFilter,
  pairedMathEntry,
  closingFenceAtomicRanges,
];

export type { FenceRange } from "./fence-protection-pipeline";
export { docChangeCouldAffectDisplayMathFences as _docChangeCouldAffectDisplayMathFencesForTest, fenceProtectionCacheField as _fenceProtectionCacheFieldForTest };
