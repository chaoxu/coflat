/**
 * Unified CM6 StateField for rendering all [@id] and @id references.
 *
 * Replaces the separate crossref-render and citation-render ViewPlugins
 * with a single tree walk that routes each reference through the shared
 * presentation planner. Unmatched ids stay on the crossref path by default.
 *
 * Widget classes remain render-owned; this plugin only handles discovery and
 * routing.
 */

import {
  Decoration,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { type ChangeSet, type EditorState, type Extension, type Range, type Transaction } from "@codemirror/state";
import { CSS } from "../../core/constants/css-classes";
import { documentSurfacePolicy } from "../../core/document-surface-policy";
import { escapeHtml } from "../../core/lib/html-escape";
import { forEachOverlappingOrderedRange } from "../lib/range-helpers";
import type { CitationFormatter } from "../../core/document-context-types";
import type { BibStore } from "../state/bib-data";
import { CitationWidget, HostRefWidget } from "./citation-widget";
import {
  CrossrefWidget,
  ClusteredCrossrefWidget,
  MixedClusterWidget,
  UnresolvedRefWidget,
} from "./crossref-render";
import { buildDecorations, pushWidgetDecoration } from "./decoration-core";
import {
  type ReferenceSemantics,
} from "../semantics/document";
import {
  type DirtyRange,
  expandChangeRangeToLines,
  mergeDirtyRanges,
} from "./incremental-dirty-ranges";
import {
  findFocusedInlineRevealTarget,
  inlineRevealTargetChanged,
} from "./inline-reveal-policy";
import { isDebugRenderFlagEnabled } from "./debug-render-flags";
import { createLifecycleDecorationStateField } from "./decoration-field";
import {
  editorFocusField,
  focusTracker,
} from "./focus-state";
import {
  createEditorReferencePresentationController,
  ensureEditorReferencePresentationCitationsRegistered,
  type ReferencePresentationClusteredCrossrefPart,
  type ReferencePresentationHostRefRoute,
  type ReferencePresentationMixedPart,
  type ReferencePresentationRoute,
  type ResolvedCrossref,
} from "../references/presentation";
import {
  getReferenceRenderAnalysis,
  getReferenceRenderState,
  referenceRenderRebuildDependenciesChanged,
  referenceRenderSliceChanged,
} from "../state/reference-render-state";

export {
  getReferenceRenderDependencySignature,
  referenceRenderDependenciesChanged,
} from "../state/reference-render-state";

function getRevealedReferenceTarget(
  state: EditorState,
  focused: boolean,
): Pick<ReferenceSemantics, "from" | "to"> | null {
  const analysis = getReferenceRenderAnalysis(state);
  return findFocusedInlineRevealTarget(
    state.selection.main,
    analysis.references,
    focused,
  );
}

// ── Render-plan types ──────────────────────────────────────────────

/** A planned reference rendering before widget emission. */
export type ReferenceRenderItem =
  | { readonly kind: "source-mark"; readonly from: number; readonly to: number }
  | { readonly kind: "citation"; readonly from: number; readonly to: number; readonly rendered: string; readonly ids: readonly string[]; readonly narrative: boolean }
  | { readonly kind: "mixed-cluster"; readonly from: number; readonly to: number; readonly parts: readonly ReferencePresentationMixedPart[]; readonly raw: string }
  | { readonly kind: "crossref"; readonly from: number; readonly to: number; readonly resolved: ResolvedCrossref; readonly raw: string }
  | { readonly kind: "clustered-crossref"; readonly from: number; readonly to: number; readonly parts: readonly ReferencePresentationClusteredCrossrefPart[]; readonly raw: string }
  | { readonly kind: "unresolved"; readonly from: number; readonly to: number; readonly raw: string }
  | (ReferencePresentationHostRefRoute & { readonly from: number; readonly to: number });

function toRenderItem(
  route: ReferencePresentationRoute,
  from: number,
  to: number,
): ReferenceRenderItem {
  switch (route.kind) {
    case "citation":
      return { ...route, from, to };
    case "mixed-cluster":
      return { ...route, from, to };
    case "crossref":
      return { ...route, from, to };
    case "clustered-crossref":
      return { ...route, from, to };
    case "unresolved":
      return { ...route, from, to };
    case "host-ref":
      return { ...route, from, to };
  }
}

// ── Plan: pure routing without widget creation ─────────────────────

/**
 * Classify each reference into a render-plan item.
 *
 * Routing per reference:
 * - Focused cursor/selection inside → source-mark
 * - Bracketed single id, block/heading/equation → crossref
 * - Bracketed multi id → clustered-crossref
 *   with unresolved items degraded in place
 * - Bracketed single id, unresolved → unresolved
 * - Narrative, block/heading/equation → crossref
 * - Narrative, unresolved → unresolved
 *
 * Citation routes are still supported for explicit custom presentation
 * contexts. Citations must be registered with the processor before calling this
 * function (see {@link ensureEditorReferencePresentationCitationsRegistered}).
 */
function isEditorView(value: EditorState | EditorView): value is EditorView {
  return "state" in value;
}

export function planReferenceRendering(
  view: EditorView,
  store: BibStore,
  formatter: CitationFormatter | null,
  references?: readonly ReferenceSemantics[],
): ReferenceRenderItem[];
export function planReferenceRendering(
  state: EditorState,
  focused: boolean,
  store: BibStore,
  formatter: CitationFormatter | null,
  references?: readonly ReferenceSemantics[],
): ReferenceRenderItem[];
export function planReferenceRendering(
  viewOrState: EditorView | EditorState,
  focusedOrStore: boolean | BibStore,
  storeOrFormatter: BibStore | CitationFormatter | null,
  formatterOrReferences?: CitationFormatter | null | readonly ReferenceSemantics[],
  maybeReferences?: readonly ReferenceSemantics[],
): ReferenceRenderItem[] {
  const state = isEditorView(viewOrState) ? viewOrState.state : viewOrState;
  const focused = isEditorView(viewOrState)
    ? viewOrState.hasFocus
    : focusedOrStore as boolean;
  const store = isEditorView(viewOrState)
    ? focusedOrStore as BibStore
    : storeOrFormatter as BibStore;
  const formatter = isEditorView(viewOrState)
    ? storeOrFormatter as CitationFormatter | null
    : (formatterOrReferences as CitationFormatter | null);
  const references = (
    isEditorView(viewOrState)
      ? formatterOrReferences as readonly ReferenceSemantics[] | undefined
      : maybeReferences
  ) ?? getReferenceRenderAnalysis(state).references;

  const controller = createEditorReferencePresentationController(state, {
    store,
    formatter,
    surface: documentSurfacePolicy("editor-preview").referenceHostSurface,
  });
  const items: ReferenceRenderItem[] = [];
  const activeRef = getRevealedReferenceTarget(state, focused);

  for (const ref of references) {
    if (activeRef && activeRef.from === ref.from && activeRef.to === ref.to) {
      items.push({ kind: "source-mark", from: ref.from, to: ref.to });
      continue;
    }

    const raw = state.sliceDoc(ref.from, ref.to);
    const route = controller.planReference({
      bracketed: ref.bracketed,
      ids: ref.ids,
      locators: ref.locators,
      raw,
      sourceRange: { from: ref.from, to: ref.to },
    });
    if (!route) continue;

    // Compatibility path for explicit custom contexts that still classify a
    // reference as a citation without attaching a formatter.
    if (route.kind === "citation" && !formatter) {
      items.push(buildDegradedCitationItem(ref.ids, ref.bracketed, ref.from, ref.to, raw));
      continue;
    }

    items.push(toRenderItem(route, ref.from, ref.to));
  }

  return items;
}


function buildDegradedCitationItem(
  ids: readonly string[],
  bracketed: boolean,
  from: number,
  to: number,
  raw: string,
): ReferenceRenderItem {
  const mode: "bracketed" | "narrative" = bracketed ? "bracketed" : "narrative";
  // Single-key cluster: record the key as a data attribute and render the
  // canonical `[@key]` / `@key` text. Multi-key clusters keep the raw source.
  const singleKey = ids.length === 1 ? ids[0] : null;
  const display = singleKey
    ? (bracketed ? `[@${singleKey}]` : `@${singleKey}`)
    : raw;
  const keyAttr = singleKey ? ` data-ref-key="${escapeHtml(singleKey)}"` : "";
  const html =
    `<span class="${CSS.citationUnresolved}"`
    + keyAttr
    + ` data-ref-mode="${mode}">${escapeHtml(display)}</span>`;
  return {
    kind: "host-ref",
    from,
    to,
    key: singleKey ?? "",
    mode,
    html,
    hasOnClick: false,
    raw,
    ids,
    locators: ids.map(() => undefined),
  };
}

// ── Emit: map plan items to CM6 decorations ────────────────────────

function emitReferenceDecorations(plan: readonly ReferenceRenderItem[]): Range<Decoration>[] {
  const sourceMarkDecoration = Decoration.mark({ class: CSS.referenceSource });
  const ranges: Range<Decoration>[] = [];
  const disableReferenceWidgets = isDebugRenderFlagEnabled("disableReferenceWidgets");

  for (const item of plan) {
    switch (item.kind) {
      case "source-mark":
        ranges.push(sourceMarkDecoration.range(item.from, item.to));
        break;
      case "citation":
        if (!disableReferenceWidgets) {
          pushWidgetDecoration(
            ranges,
            new CitationWidget(item.rendered, item.ids, item.narrative),
            item.from,
            item.to,
          );
        }
        break;
      case "mixed-cluster":
        if (!disableReferenceWidgets) {
          pushWidgetDecoration(ranges, new MixedClusterWidget(item.parts, item.raw), item.from, item.to);
        }
        break;
      case "crossref":
        if (!disableReferenceWidgets) {
          pushWidgetDecoration(ranges, new CrossrefWidget(item.resolved, item.raw), item.from, item.to);
        }
        break;
      case "clustered-crossref":
        if (!disableReferenceWidgets) {
          pushWidgetDecoration(
            ranges,
            new ClusteredCrossrefWidget(item.parts, item.raw),
            item.from,
            item.to,
          );
        }
        break;
      case "unresolved":
        if (!disableReferenceWidgets) {
          pushWidgetDecoration(ranges, new UnresolvedRefWidget(item.raw), item.from, item.to);
        }
        break;
      case "host-ref":
        if (!disableReferenceWidgets) {
          pushWidgetDecoration(
            ranges,
            new HostRefWidget(
              item.html,
              item.key,
              item.mode,
              item.href,
              item.className,
              item.hasOnClick,
            ),
            item.from,
            item.to,
          );
        }
        break;
    }
  }

  return ranges;
}

// ── Public entry point (composes plan + emit) ──────────────────────

/**
 * Collect decoration ranges for all references (crossrefs + citations).
 *
 * Ensures citations are registered, builds a render plan, then emits
 * CM6 decorations from that plan.
 */
export function collectReferenceRanges(
  view: EditorView,
  store: BibStore,
  formatter?: CitationFormatter | null,
  references?: readonly ReferenceSemantics[],
): Range<Decoration>[];
export function collectReferenceRanges(
  state: EditorState,
  focused: boolean,
  store: BibStore,
  formatter?: CitationFormatter | null,
  references?: readonly ReferenceSemantics[],
): Range<Decoration>[];
export function collectReferenceRanges(
  viewOrState: EditorView | EditorState,
  focusedOrStore: boolean | BibStore,
  storeOrFormatter?: BibStore | CitationFormatter | null,
  formatterOrReferences?: CitationFormatter | null | readonly ReferenceSemantics[],
  maybeReferences?: readonly ReferenceSemantics[],
): Range<Decoration>[] {
  const state = isEditorView(viewOrState) ? viewOrState.state : viewOrState;
  const focused = isEditorView(viewOrState)
    ? viewOrState.hasFocus
    : focusedOrStore as boolean;
  const store = isEditorView(viewOrState)
    ? focusedOrStore as BibStore
    : storeOrFormatter as BibStore;
  const formatter = isEditorView(viewOrState)
    ? (storeOrFormatter as CitationFormatter | null | undefined) ?? null
    : (formatterOrReferences as CitationFormatter | null | undefined) ?? null;
  const references = maybeReferences ?? getReferenceRenderState(state).analysis.references;
  const { analysis, bibliography } = getReferenceRenderState(state);
  const effectiveFormatter = formatter ?? bibliography.formatter ?? null;

  // Citation cluster registration is global to document order. Cache it at the
  // (analysis, bibliography-store) boundary so ordinary navigation does not
  // reset and replay every citation cluster.
  ensureEditorReferencePresentationCitationsRegistered(analysis, store, effectiveFormatter);

  return emitReferenceDecorations(
    planReferenceRendering(
      state,
      focused,
      store,
      effectiveFormatter,
      references,
    ),
  );
}

/** Build reference decorations from the view state. */
function buildReferenceDecorations(state: EditorState): DecorationSet {
  const { bibliography } = getReferenceRenderState(state);
  const { store, formatter } = bibliography;
  return buildDecorations(collectReferenceRanges(state, referenceStateFocus(state), store, formatter));
}

function collectDirtyReferences(
  references: readonly ReferenceSemantics[],
  dirtyRanges: readonly DirtyRange[],
): ReferenceSemantics[] {
  if (dirtyRanges.length === 0 || references.length === 0) return [];
  const dirty: ReferenceSemantics[] = [];
  const seenFrom = new Set<number>();
  for (const range of dirtyRanges) {
    forEachOverlappingOrderedRange(references, range, (reference) => {
      if (seenFrom.has(reference.from)) return;
      seenFrom.add(reference.from);
      dirty.push(reference);
    });
  }
  return dirty;
}

function mappedDecorationsWithFreshWidgetSources(
  decorations: DecorationSet,
  changes: ChangeSet,
): DecorationSet {
  return decorations.map(changes);
}

function mergeDirtyRangesWithActiveReference(
  dirtyRanges: readonly DirtyRange[],
  ...references: readonly (Pick<ReferenceSemantics, "from" | "to"> | null)[]
): DirtyRange[] {
  const activeRanges = references.flatMap((reference) => (
    reference ? [{ from: reference.from, to: reference.to }] : []
  ));
  if (activeRanges.length === 0) return [...dirtyRanges];
  return mergeDirtyRanges([...dirtyRanges, ...activeRanges]);
}

function mapReferenceDirtyRange(
  range: Pick<ReferenceSemantics, "from" | "to">,
  changes: ChangeSet,
): DirtyRange {
  const from = changes.mapPos(range.from, -1);
  const to = changes.mapPos(range.to, 1);
  return { from, to: Math.max(from, to) };
}

interface ReferenceDocDirtyRanges {
  readonly ranges: readonly DirtyRange[];
  readonly couldContainReferences: boolean;
}

type ReferenceDocUpdate = Pick<
  Transaction,
  "changes" | "docChanged" | "startState" | "state"
>;

function computeReferenceDocDirtyRanges(update: ReferenceDocUpdate): ReferenceDocDirtyRanges {
  if (!update.docChanged) {
    return { ranges: [], couldContainReferences: false };
  }

  const ranges: DirtyRange[] = [];
  let couldContainReferences = false;

  update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    const beforeRange = expandChangeRangeToLines(update.startState.doc, fromA, toA);
    const afterRange = expandChangeRangeToLines(update.state.doc, fromB, toB);
    const mappedBeforeRange = mapReferenceDirtyRange(beforeRange, update.changes);

    ranges.push(afterRange, mappedBeforeRange);

    if (
      !couldContainReferences &&
      (
        update.startState.sliceDoc(beforeRange.from, beforeRange.to).includes("@") ||
        update.state.sliceDoc(afterRange.from, afterRange.to).includes("@")
      )
    ) {
      couldContainReferences = true;
    }
  });

  return {
    ranges: mergeDirtyRanges(ranges),
    couldContainReferences,
  };
}

interface ReferenceRevealChange {
  readonly beforeActive: Pick<ReferenceSemantics, "from" | "to"> | null;
  readonly afterActive: Pick<ReferenceSemantics, "from" | "to"> | null;
  readonly activeChanged: boolean;
}

function getReferenceRevealChange(update: ViewUpdate): ReferenceRevealChange {
  const endFocused = update.view.hasFocus;
  const startFocused = update.focusChanged ? !endFocused : endFocused;
  const beforeActive = getRevealedReferenceTarget(update.startState, startFocused);
  const afterActive = getRevealedReferenceTarget(update.state, endFocused);
  return {
    beforeActive,
    afterActive,
    activeChanged: inlineRevealTargetChanged(beforeActive, afterActive),
  };
}

function referenceStateFocus(state: EditorState): boolean {
  return state.field(editorFocusField, false) ?? false;
}

function getReferenceRevealChangeForTransaction(tr: Transaction): ReferenceRevealChange {
  const beforeActive = getRevealedReferenceTarget(tr.startState, referenceStateFocus(tr.startState));
  const afterActive = getRevealedReferenceTarget(tr.state, referenceStateFocus(tr.state));
  return {
    beforeActive,
    afterActive,
    activeChanged: inlineRevealTargetChanged(beforeActive, afterActive),
  };
}

function referenceRenderDependenciesNeedRebuild(tr: Transaction): boolean {
  return referenceRenderRebuildDependenciesChanged(tr.startState, tr.state);
}

function computeReferenceDirtyRangesForTransaction(tr: Transaction): DirtyRange[] {
  const { beforeActive, afterActive, activeChanged } = getReferenceRevealChangeForTransaction(tr);
  const docDirty = computeReferenceDocDirtyRanges(tr);
  if (
    docDirty.ranges.length > 0 &&
    !activeChanged &&
    !docDirty.couldContainReferences
  ) {
    return [];
  }
  const mappedBeforeActive = activeChanged && beforeActive && tr.docChanged
    ? mapReferenceDirtyRange(beforeActive, tr.changes)
    : beforeActive;
  return mergeDirtyRangesWithActiveReference(
    docDirty.ranges,
    activeChanged ? mappedBeforeActive : null,
    activeChanged ? afterActive : null,
  );
}

function collectReferenceRangesForDirtySpans(
  state: EditorState,
  dirtyRanges: readonly DirtyRange[],
): Range<Decoration>[] {
  const { analysis, bibliography } = getReferenceRenderState(state);
  const { store, formatter } = bibliography;
  const dirtyRefs = collectDirtyReferences(
    analysis.references,
    dirtyRanges,
  );
  return dirtyRefs.length > 0
    ? collectReferenceRanges(state, referenceStateFocus(state), store, formatter, dirtyRefs)
    : [];
}

/** CM6 extension that renders all [@id] and @id references with Typora-style toggle. */
const referenceDecorationField = createLifecycleDecorationStateField<DirtyRange>({
  spanName: "cm6.referenceRender",
  build: buildReferenceDecorations,
  collectRanges: collectReferenceRangesForDirtySpans,
  semanticChanged: referenceRenderSliceChanged,
  contextChanged: (tr) =>
    getReferenceRevealChangeForTransaction(tr).activeChanged,
  contextUpdateMode: "dirty-ranges",
  shouldRebuild: (tr) => referenceRenderDependenciesNeedRebuild(tr),
  dirtyRangeFn: (tr) => computeReferenceDirtyRangesForTransaction(tr),
  mapDecorations: (decorations, tr) =>
    mappedDecorationsWithFreshWidgetSources(decorations, tr.changes),
});

export const referenceRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  referenceDecorationField,
];

function computeReferenceDirtyRanges(update: ViewUpdate): DirtyRange[] {
  const { beforeActive, afterActive, activeChanged } = getReferenceRevealChange(update);
  const docDirty = computeReferenceDocDirtyRanges(update);
  const changes = update.changes;
  if (
    docDirty.ranges.length > 0 &&
    !activeChanged &&
    !docDirty.couldContainReferences
  ) {
    return [];
  }
  const mappedBeforeActive = activeChanged && beforeActive && update.docChanged
    ? mapReferenceDirtyRange(beforeActive, changes)
    : beforeActive;
  return mergeDirtyRangesWithActiveReference(
    docDirty.ranges,
    activeChanged ? mappedBeforeActive : null,
    activeChanged ? afterActive : null,
  );
}

export { computeReferenceDirtyRanges as _computeReferenceDirtyRangesForTest };
