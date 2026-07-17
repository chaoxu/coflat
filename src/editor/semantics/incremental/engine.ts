import type { Tree } from "@lezer/common";
import { buildDocumentIR } from "../../ir/document-ir-builder";
import type { DocumentIR } from "../../ir/types";
import { mapReferenceIndex } from "../../references/classifier";
import type {
  DocumentAnalysis,
  TextSource,
} from "../document-model";
import {
  computeNarrativeExtractions,
  type DirtyWindowPlan,
  type DirtyWindowPlanningOptions,
  mapFencedDivsOnly,
  mergeExcludedRanges,
  planDirtyWindows,
} from "./dirty-window-planning";
import {
  coalescePendingRegions,
  mapPendingRegions,
  mergePendingRegions,
  type PendingRegion,
  pendingRegionsEqual,
  pendingTailRegions,
  subtractPendingRegions,
} from "./pending-regions";
import {
  createFencedDivSlice,
  type DocumentAnalysisRevisionInfo,
  type DocumentAnalysisSliceName,
  type DocumentAnalysisSlices,
  type IncrementalDocumentAnalysisState,
  sameSlices,
  ZERO_REVISION_INFO,
} from "./slice-registry";
import {
  mergeEquationSlice,
} from "./slices/equation-slice";
import {
  mergeFencedDivSlice,
} from "./slices/fenced-div-slice";
import {
  mergeFootnoteSlice,
} from "./slices/footnote-slice";
import {
  mergeHeadingSlice,
} from "./slices/heading-slice";
import {
  computeMathOverhangRanges,
  expandDirtyMathExtractions,
  mapMathRegionUpdate,
  mergeMathSlice,
} from "./slices/math-slice";
import {
  mergeReferenceSlice,
} from "./slices/reference-slice";
import {
  buildSlicesAndExcludedRanges,
  canMapReferenceIndexInputs,
  createDocumentAnalysisSnapshotFromAnalysis as createSnapshotFromAnalysis,
  type DocumentAnalysisSnapshot,
  finalizeDocumentAnalysis,
  snapshotFor,
  withPendingRegions,
} from "./snapshot-finalize";
import type { SemanticDelta } from "./types";
import {
  backoffWindowStart,
  type ExcludedRange,
  expandRangeToParagraphBoundaries,
  extractStructuralWindow,
  scanFrontmatterOpener,
} from "./window-extractor";

export type {
  DocumentAnalysisRevisionInfo,
  DocumentAnalysisSliceName,
  DocumentAnalysisSliceRevisions,
  DocumentAnalysisSlices,
  FencedDivSlice,
  IncrementalDocumentAnalysisState,
} from "./slice-registry";
export type { DocumentAnalysisSnapshot } from "./snapshot-finalize";
export {
  createSnapshotFromAnalysis as createDocumentAnalysisSnapshotFromAnalysis,
};

export interface DocumentArtifacts {
  readonly analysis: DocumentAnalysis;
  readonly analysisSnapshot: DocumentAnalysisSnapshot;
  readonly ir: DocumentIR;
}

export interface DocumentAnalysisUpdateOptions {
  readonly isSyntaxTreeAvailable?: (to: number) => boolean;
}

function reuseEquivalentArray<T>(
  previous: readonly T[],
  next: readonly T[],
): readonly T[] {
  if (
    previous.length === next.length
    && next.every((value, index) => value === previous[index])
  ) {
    return previous;
  }

  return next;
}

/**
 * Largest position `p` such that analysis over `[0, p]` is backed by a real
 * parse. `tree.length` (the contiguous parsed prefix) is the O(1) fast path;
 * the binary search covers the rare fragment-gap case where availability is
 * smaller than the tree length. `isAvailable` must be monotone in `to`
 * (CodeMirror's `syntaxTreeAvailable` is).
 */
export function computeAnalyzableFrontier(
  docLength: number,
  tree: Tree,
  isAvailable?: (to: number) => boolean,
): number {
  let hi = Math.min(tree.length, docLength);
  if (!isAvailable || isAvailable(hi)) return hi;
  let lo = 0;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (isAvailable(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function createDocumentAnalysisSnapshot(
  doc: TextSource,
  tree: Tree,
  options: DocumentAnalysisUpdateOptions = {},
): DocumentAnalysisSnapshot {
  const { slices, excludedRanges } = buildSlicesAndExcludedRanges(doc, tree);
  const frontier = computeAnalyzableFrontier(
    doc.length,
    tree,
    options.isSyntaxTreeAvailable,
  );
  return finalizeDocumentAnalysis(
    undefined,
    slices,
    excludedRanges,
    doc,
    undefined,
    pendingTailRegions(frontier, doc.length),
  );
}

export function createDocumentAnalysis(
  doc: TextSource,
  tree: Tree,
): DocumentAnalysis {
  return createDocumentAnalysisSnapshot(doc, tree).analysis;
}

export function buildDocumentArtifacts(
  analysis: DocumentAnalysis | DocumentAnalysisSnapshot,
  doc: TextSource,
  tree: Tree,
): DocumentArtifacts {
  const snapshot = snapshotFor(analysis)
    ?? createSnapshotFromAnalysis(doc, tree, analysis);
  return {
    analysis: snapshot.analysis,
    analysisSnapshot: snapshot,
    ir: buildDocumentIR({
      analysis: snapshot.analysis,
      doc,
      docText: doc.slice(0, doc.length),
      tree,
    }),
  };
}

export function createDocumentArtifacts(
  doc: TextSource,
  tree: Tree,
): DocumentArtifacts {
  return buildDocumentArtifacts(createDocumentAnalysisSnapshot(doc, tree), doc, tree);
}

/**
 * Bounded per-transaction reconciliation of below-frontier pending regions on
 * doc-changed transactions and idle pending-drain ticks. Keeps structural
 * keystrokes O(budget) instead of O(pending suffix) while still converging to
 * full-rebuild equality: leftovers are consumed by the idle drain driver
 * (budgeted, one oversized window allowed per tick) and by tree-progress
 * ticks (doc unchanged), which consume without a budget, matching the cost
 * ceiling of the full rebuild they replace.
 */
const DOC_CHANGED_PENDING_RECONCILE_BUDGET = 16384;

function deepValueEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!deepValueEqual(left[index], right[index])) return false;
    }
    return true;
  }
  if (left instanceof Map || right instanceof Map) {
    if (!(left instanceof Map) || !(right instanceof Map)) return false;
    if (left.size !== right.size) return false;
    for (const [key, value] of left) {
      if (!right.has(key) || !deepValueEqual(value, right.get(key))) return false;
    }
    return true;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  // Two plain loops instead of a Set union: avoids the per-object Set/spread
  // allocation on this hot recursive path while keeping the same semantics
  // (an explicitly-undefined key still equals an absent key).
  for (const key of Object.keys(leftRecord)) {
    if (!deepValueEqual(leftRecord[key], rightRecord[key])) return false;
  }
  for (const key of Object.keys(rightRecord)) {
    if (!(key in leftRecord) && rightRecord[key] !== undefined) return false;
  }
  return true;
}

/**
 * Tree-progress re-extraction rebuilds value-equal objects for everything in
 * its windows; restore identity so unchanged slices keep their revision.
 */
function reuseValueEquivalent<T>(previous: T, next: T): T {
  return deepValueEqual(previous, next) ? previous : next;
}

function collectTreeProgressCandidates(
  pendingRegions: readonly PendingRegion[],
  tree: Tree,
  doc: TextSource,
  frontier: number,
  budget: number,
  allowOversized: boolean,
): readonly PendingRegion[] {
  const candidates: PendingRegion[] = [];
  let spent = 0;
  for (const region of pendingRegions) {
    if (region.from >= frontier) break;
    if (spent >= budget) break;
    // Budget honesty: the backoff-expanded window is what actually gets
    // extracted, so its full length is charged, not just region.from..to.
    const from = backoffWindowStart(tree, doc, region.from);
    const to = Math.min(region.to, frontier);
    const remaining = budget - spent;
    if (to - from > remaining) {
      const cappedTo = Math.min(to, from + remaining);
      if (cappedTo > region.from) {
        // Truncated coverage still reaches into the region; the remainder
        // stays pending for a later tick.
        candidates.push({ from, to: cappedTo });
      } else if (allowOversized && candidates.length === 0) {
        // The backoff span alone exceeds the budget. On drain ticks, seed
        // one window that reaches into the region anyway; the extraction
        // budget's oversized allowance lets its chase complete atomically,
        // guaranteeing per-tick progress.
        candidates.push({ from, to: Math.min(to, region.from + remaining) });
      }
      break;
    }
    spent += to - from;
    candidates.push({ from, to });
  }
  // Backoff can make neighbouring candidates overlap; coalesce before
  // planning so windows are not extracted twice.
  return coalescePendingRegions(candidates);
}

function createTreeProgressDelta(
  candidates: readonly PendingRegion[],
): SemanticDelta {
  return {
    rawChangedRanges: [],
    dirtyWindows: candidates.map((range) => ({
      fromOld: range.from,
      toOld: range.to,
      fromNew: range.from,
      toNew: range.to,
    })),
    docChanged: false,
    syntaxTreeChanged: true,
    globalInvalidation: false,
    // Forces the "full" structural extraction mode in classifyStructuralExtraction.
    plainInlineTextOnlyChange: false,
    mapOldToNew: (pos) => pos,
    mapNewToOld: (pos) => pos,
  };
}

/**
 * Reconcile pending regions that the parse frontier now covers, reusing the
 * doc-changed windowed-merge machinery with an identity position mapping.
 * Replaces the former whole-document rebuild on tree-progress transactions.
 */
function updateForTreeProgress(
  previous: DocumentAnalysisSnapshot,
  doc: TextSource,
  tree: Tree,
  frontier: number,
  options: DocumentAnalysisUpdateOptions,
  budget: number = Number.POSITIVE_INFINITY,
  allowOversizedWindow = false,
): DocumentAnalysisSnapshot {
  const previousState = previous.incrementalState;
  const candidates = collectTreeProgressCandidates(
    previousState.pendingRegions,
    tree,
    doc,
    frontier,
    budget,
    allowOversizedWindow,
  );
  if (candidates.length === 0) {
    return previous;
  }

  const identityDelta = createTreeProgressDelta(candidates);
  const planningOptions: DirtyWindowPlanningOptions = Number.isFinite(budget)
    ? {
        ...options,
        extractionBudget: {
          remaining: budget,
          oversizedAllowance: allowOversizedWindow ? 1 : 0,
        },
      }
    : options;
  const plan = planDirtyWindows(previousState, doc, tree, identityDelta, planningOptions);
  const merged = mergeSlicesFromPlan(previousState, doc, tree, identityDelta, plan);

  const nextSlices: DocumentAnalysisSlices = {
    headingSlice: reuseValueEquivalent(previousState.headingSlice, merged.slices.headingSlice),
    footnoteSlice: reuseValueEquivalent(previousState.footnoteSlice, merged.slices.footnoteSlice),
    fencedDivSlice: reuseValueEquivalent(previousState.fencedDivSlice, merged.slices.fencedDivSlice),
    equationSlice: reuseValueEquivalent(previousState.equationSlice, merged.slices.equationSlice),
    mathSlice: reuseValueEquivalent(previousState.mathSlice, merged.slices.mathSlice),
    referenceSlice: reuseValueEquivalent(previousState.referenceSlice, merged.slices.referenceSlice),
  };
  const excludedRanges = reuseValueEquivalent(
    previousState.excludedRanges,
    merged.excludedRanges,
  );

  // Only plan-level extraction ranges may be subtracted from pending;
  // engine-level math/narrative overhang expansions can cross the frontier
  // and must stay covered until genuinely re-extracted.
  let pendingRegions = subtractPendingRegions(
    previousState.pendingRegions,
    plan.dirtyExtractions.map((extraction) => extraction.range),
  );
  pendingRegions = mergePendingRegions(pendingRegions, plan.droppedWindows);

  if (
    sameSlices(previousState, nextSlices)
    && previousState.excludedRanges === excludedRanges
  ) {
    if (pendingRegionsEqual(previousState.pendingRegions, pendingRegions)) {
      return previous;
    }
    return withPendingRegions(previous, pendingRegions);
  }

  return finalizeDocumentAnalysis(
    previous,
    nextSlices,
    excludedRanges,
    doc,
    undefined,
    pendingRegions,
  );
}

function consumePendingBelowFrontier(
  snapshot: DocumentAnalysisSnapshot,
  doc: TextSource,
  tree: Tree,
  frontier: number,
  options: DocumentAnalysisUpdateOptions,
): DocumentAnalysisSnapshot {
  const pending = snapshot.incrementalState.pendingRegions;
  if (pending.length === 0 || pending[0].from >= frontier) {
    return snapshot;
  }
  return updateForTreeProgress(
    snapshot,
    doc,
    tree,
    frontier,
    options,
    DOC_CHANGED_PENDING_RECONCILE_BUDGET,
    false,
  );
}

/**
 * Synchronously consume all pending regions the parse frontier covers.
 * For one-shot consumers (readers, indexers) that are not keystroke-latency
 * bound and never see tree-progress or idle-drain transactions — without
 * this, a snapshot left partially reconciled by the doc-changed budget would
 * stay stale forever behind unchanged-text fast paths.
 */
export function drainPendingDocumentAnalysis(
  snapshot: DocumentAnalysisSnapshot,
  doc: TextSource,
  tree: Tree,
  options: DocumentAnalysisUpdateOptions = {},
): DocumentAnalysisSnapshot {
  let current = snapshot;
  while (current.incrementalState.pendingRegions.length > 0) {
    const frontier = computeAnalyzableFrontier(
      doc.length,
      tree,
      options.isSyntaxTreeAvailable,
    );
    const next = updateForTreeProgress(current, doc, tree, frontier, options);
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * Frontmatter is a textual overlay (`extractRawFrontmatter`), not a tree
 * block, so block backoff cannot bound it: adding or removing a closing
 * `---` reinterprets everything back to position 0. Returns 0 when this edit
 * could change the closure scan; `undefined` when it provably cannot — no
 * `---` opener, or the scan already terminates at a closing delimiter
 * entirely before the first changed position (the scan only reads the
 * unchanged prefix, so its result is unchanged).
 */
function frontmatterGuardStart(
  doc: TextSource,
  firstChanged: number,
): number | undefined {
  const scan = scanFrontmatterOpener(doc);
  if (!scan) return undefined;
  // An unclosed block (end === undefined) stays guarded: the edit may be
  // what closes it, reinterpreting everything above.
  if (scan.end !== undefined && scan.end <= firstChanged) {
    return undefined;
  }
  return 0;
}

/**
 * Backoff-expanded start of the first changed range. A structural edit can
 * reinterpret everything after it (fence toggling, frontmatter closure, list
 * or blockquote context flips), so the whole suffix is recorded pending.
 *
 * Backward influence is bounded by `backoffWindowStart`: markdown block
 * structure is prefix-determined, so the set of blocks open at the first
 * changed position is a function of the unchanged text before it — an edit
 * can only alter structures whose enclosing top-level block contains that
 * position (e.g. closing an earlier-opened fence or div), plus
 * paragraph-level inline effects (setext underlines, lazy continuations),
 * both of which `backoffWindowStart` covers by taking the minimum of the
 * enclosing block start and the paragraph start. At position 0 the backoff
 * trivially bottoms out at 0. Two cases escape that bound and are handled
 * conservatively: frontmatter closure (`frontmatterGuardStart`), and a tree
 * not yet parsed up to the first change, where the enclosing block cannot be
 * resolved — there the guard starts no later than the parsed prefix end, so
 * everything the tree cannot yet bound stays pending until a tree-progress
 * tick re-applies the backoff on a fresher tree.
 */
function reinterpretationGuardRegion(
  doc: TextSource,
  tree: Tree,
  delta: SemanticDelta,
): PendingRegion {
  let firstChanged = doc.length;
  for (const range of delta.rawChangedRanges) {
    if (range.fromNew < firstChanged) {
      firstChanged = range.fromNew;
    }
  }
  const frontmatterFrom = frontmatterGuardStart(doc, firstChanged);
  if (frontmatterFrom !== undefined) {
    return { from: frontmatterFrom, to: doc.length };
  }
  const from = firstChanged <= tree.length
    ? backoffWindowStart(tree, doc, firstChanged)
    : Math.min(
        tree.length,
        expandRangeToParagraphBoundaries(doc, {
          from: firstChanged,
          to: firstChanged,
        }).from,
      );
  return { from, to: doc.length };
}

export function updateDocumentAnalysisSnapshot(
  previous: DocumentAnalysisSnapshot,
  doc: TextSource,
  tree: Tree,
  delta: SemanticDelta,
  options: DocumentAnalysisUpdateOptions = {},
): DocumentAnalysisSnapshot {
  const next = computeNextDocumentAnalysisSnapshot(previous, doc, tree, delta, options);
  // Collapse guard-then-consume round trips: when the analysis object,
  // revisions, and pending bookkeeping all end up unchanged, keep snapshot
  // identity so no-op transactions stay free for consumers.
  if (
    next !== previous
    && next.analysis === previous.analysis
    && next.incrementalState.revisions === previous.incrementalState.revisions
    && pendingRegionsEqual(
      next.incrementalState.pendingRegions,
      previous.incrementalState.pendingRegions,
    )
  ) {
    return previous;
  }
  return next;
}

function computeNextDocumentAnalysisSnapshot(
  previous: DocumentAnalysisSnapshot,
  doc: TextSource,
  tree: Tree,
  delta: SemanticDelta,
  options: DocumentAnalysisUpdateOptions,
): DocumentAnalysisSnapshot {
  const previousState = previous.incrementalState;
  const frontier = computeAnalyzableFrontier(
    doc.length,
    tree,
    options.isSyntaxTreeAvailable,
  );

  if (!delta.docChanged) {
    if (delta.globalInvalidation) {
      const { slices, excludedRanges } = buildSlicesAndExcludedRanges(doc, tree);
      return finalizeDocumentAnalysis(
        previous,
        slices,
        excludedRanges,
        doc,
        undefined,
        pendingTailRegions(frontier, doc.length),
      );
    }
    if (delta.syntaxTreeChanged) {
      return updateForTreeProgress(previous, doc, tree, frontier, options);
    }
    if (delta.pendingDrain) {
      // Idle drain tick: consume a bounded chunk, allowing one oversized
      // atomic window so blocks larger than the budget still converge.
      return updateForTreeProgress(
        previous,
        doc,
        tree,
        frontier,
        options,
        DOC_CHANGED_PENDING_RECONCILE_BUDGET,
        true,
      );
    }
    return previous;
  }

  if (delta.globalInvalidation || delta.dirtyWindows.length === 0) {
    const { slices, excludedRanges } = buildSlicesAndExcludedRanges(doc, tree);
    return finalizeDocumentAnalysis(
      previous,
      slices,
      excludedRanges,
      doc,
      undefined,
      pendingTailRegions(frontier, doc.length),
    );
  }

  const plan = planDirtyWindows(previousState, doc, tree, delta, options);
  const { slices: nextSlices, excludedRanges } = mergeSlicesFromPlan(
    previousState,
    doc,
    tree,
    delta,
    plan,
  );

  const referenceIndex = canMapReferenceIndexInputs(previousState, nextSlices)
    ? mapReferenceIndex(previousState.referenceIndex, plan.changes)
    : undefined;

  let pendingRegions = mapPendingRegions(
    previousState.pendingRegions,
    delta.mapOldToNew,
    doc.length,
  );
  if (!delta.plainInlineTextOnlyChange) {
    pendingRegions = mergePendingRegions(pendingRegions, [
      reinterpretationGuardRegion(doc, tree, delta),
    ]);
  }
  pendingRegions = mergePendingRegions(pendingRegions, plan.droppedWindows);
  if (plan.structuralExtractionMode === "full") {
    // Paragraph-mode extractions collect inline exclusions only and must not
    // count as tree-backed structural analysis.
    pendingRegions = subtractPendingRegions(
      pendingRegions,
      plan.dirtyExtractions.map((extraction) => extraction.range),
    );
  }

  const result = finalizeDocumentAnalysis(
    previous,
    nextSlices,
    excludedRanges,
    doc,
    referenceIndex,
    pendingRegions,
  );

  if (!delta.syntaxTreeChanged) {
    return result;
  }
  return consumePendingBelowFrontier(result, doc, tree, frontier, options);
}

function mergeSlicesFromPlan(
  previousState: IncrementalDocumentAnalysisState,
  doc: TextSource,
  tree: Tree,
  delta: SemanticDelta,
  plan: DirtyWindowPlan,
): {
  slices: DocumentAnalysisSlices;
  excludedRanges: readonly ExcludedRange[];
} {
  const {
    changes,
    useParagraphStructuralExtraction,
    extractedDirtyWindows,
    dirtyExtractions,
  } = plan;

  const headingSlice = mergeHeadingSlice(
    previousState.headingSlice,
    delta,
    useParagraphStructuralExtraction ? [] : dirtyExtractions,
  );
  const footnoteSlice = mergeFootnoteSlice(
    previousState.footnoteSlice,
    delta,
    useParagraphStructuralExtraction ? [] : dirtyExtractions,
  );
  const mergedFencedDivs = useParagraphStructuralExtraction
    ? reuseEquivalentArray(
        previousState.fencedDivSlice.fencedDivs,
        mapFencedDivsOnly(previousState.fencedDivSlice.fencedDivs, changes),
      )
    : reuseEquivalentArray(
        previousState.fencedDivSlice.fencedDivs,
        mergeFencedDivSlice(
          previousState.fencedDivSlice.fencedDivs,
          changes,
          extractedDirtyWindows,
        ),
      );
  const fencedDivSlice = mergedFencedDivs === previousState.fencedDivSlice.fencedDivs
    ? previousState.fencedDivSlice
    : createFencedDivSlice(mergedFencedDivs);
  const mappedMathRegions = mapMathRegionUpdate(previousState.mathSlice, delta);
  const mathDirtyExtractions = expandDirtyMathExtractions(
    previousState.mathSlice,
    delta,
    dirtyExtractions,
    doc,
    tree,
    mappedMathRegions,
  );
  const mathSlice = mergeMathSlice(
    previousState.mathSlice,
    delta,
    mathDirtyExtractions,
    doc,
    tree,
    mappedMathRegions,
  );
  const mathOverhangRanges = computeMathOverhangRanges(
    previousState.mathSlice,
    delta,
    dirtyExtractions.map((e) => e.window),
    mappedMathRegions,
  );
  const baseEquationDirtyExtractions = useParagraphStructuralExtraction
    ? []
    : dirtyExtractions;
  const equationDirtyExtractions = mathOverhangRanges.length === 0
    ? baseEquationDirtyExtractions
    : [
      ...baseEquationDirtyExtractions,
      ...mathOverhangRanges.map((range) => ({
        window: { fromNew: range.from, toNew: range.to },
        structural: extractStructuralWindow(doc, tree, range, {
          includeNarrativeRefs: false,
        }),
      })),
    ];
  const equationSlice = mergeEquationSlice(
    previousState.equationSlice,
    delta,
    equationDirtyExtractions,
  );
  const excludedRanges = mergeExcludedRanges(
    previousState.excludedRanges,
    delta,
    dirtyExtractions,
  );

  const narrativeExtractions = computeNarrativeExtractions(
    doc,
    tree,
    dirtyExtractions,
    useParagraphStructuralExtraction,
  );

  const referenceSlice = mergeReferenceSlice(
    previousState.referenceSlice,
    delta,
    dirtyExtractions,
    narrativeExtractions,
  );

  return {
    slices: {
      headingSlice,
      footnoteSlice,
      fencedDivSlice,
      equationSlice,
      mathSlice,
      referenceSlice,
    },
    excludedRanges,
  };
}

export function updateDocumentAnalysis(
  previous: DocumentAnalysisSnapshot,
  doc: TextSource,
  tree: Tree,
  delta: SemanticDelta,
  options?: DocumentAnalysisUpdateOptions,
): DocumentAnalysisSnapshot;
export function updateDocumentAnalysis(
  previous: DocumentAnalysis,
  doc: TextSource,
  tree: Tree,
  delta: SemanticDelta,
  options?: DocumentAnalysisUpdateOptions,
): DocumentAnalysis;
export function updateDocumentAnalysis(
  previous: DocumentAnalysis | DocumentAnalysisSnapshot,
  doc: TextSource,
  tree: Tree,
  delta: SemanticDelta,
  options: DocumentAnalysisUpdateOptions = {},
): DocumentAnalysis | DocumentAnalysisSnapshot {
  const snapshot = snapshotFor(previous);
  if (!snapshot) {
    return createDocumentAnalysis(doc, tree);
  }
  return updateDocumentAnalysisSnapshot(snapshot, doc, tree, delta, options);
}

export function updateDocumentArtifacts(
  previous: DocumentArtifacts,
  doc: TextSource,
  tree: Tree,
  delta: SemanticDelta,
): DocumentArtifacts {
  return buildDocumentArtifacts(
    updateDocumentAnalysisSnapshot(previous.analysisSnapshot, doc, tree, delta),
    doc,
    tree,
  );
}

export function getDocumentAnalysisRevisionInfo(
  analysis: DocumentAnalysis | DocumentAnalysisSnapshot,
): DocumentAnalysisRevisionInfo {
  return snapshotFor(analysis)?.incrementalState.revisions ?? ZERO_REVISION_INFO;
}

export function getDocumentAnalysisRevision(
  analysis: DocumentAnalysis | DocumentAnalysisSnapshot,
): number {
  return getDocumentAnalysisRevisionInfo(analysis).revision;
}

export function getDocumentAnalysisSliceRevision(
  analysis: DocumentAnalysis | DocumentAnalysisSnapshot,
  slice: DocumentAnalysisSliceName,
): number {
  return getDocumentAnalysisRevisionInfo(analysis).slices[slice];
}
