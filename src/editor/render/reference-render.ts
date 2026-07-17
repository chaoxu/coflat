/**
 * Unified viewport-scoped CM6 ViewPlugin for rendering all [@id] and @id
 * references.
 *
 * Routes each reference through the shared presentation planner. Unmatched
 * ids stay on the crossref path by default. Decorations are collected only
 * for the visible ranges; emissions are inline-only (source-reveal marks and
 * inline replace widgets), so viewport scoping is safe. Citation-cluster
 * registration stays document-global inside `collectReferenceRanges` and is
 * cached at the analysis+store boundary, independent of which ranges get
 * decorated.
 *
 * Widget classes remain render-owned; this plugin only handles discovery and
 * routing.
 */

import { type ChangeSet, type EditorState, type Extension, type Range, type Transaction } from "@codemirror/state";
import {
  Decoration,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { CSS } from "../../core/constants/css-classes";
import type { CitationFormatter } from "../../core/document-context-types";
import { documentSurfacePolicy } from "../../core/document-surface-policy";
import { escapeHtml } from "../../core/lib/html-escape";
import { documentContextFacet } from "../document-context";
import { forEachOverlappingOrderedRange } from "../lib/range-helpers";
import {
  createEditorReferencePresentationController,
  ensureEditorReferencePresentationCitationsRegistered,
  getEditorNociteConfig,
  type ReferencePresentationClusteredCrossrefPart,
  type ReferencePresentationHostRefRoute,
  type ReferencePresentationMixedPart,
  type ReferencePresentationRoute,
  type ResolvedCrossref,
} from "../references/presentation";
import {
  type ReferenceSemantics,
} from "../semantics/document";
import type { BibStore } from "../state/bib-data";
import {
  getReferenceRenderAnalysis,
  getReferenceRenderState,
  referenceRenderRebuildDependenciesChanged,
  referenceRenderSliceChanged,
} from "../state/reference-render-state";
import { CitationWidget, HostRefWidget } from "./citation-widget";
import {
  ClusteredCrossrefWidget,
  CrossrefWidget,
  MixedClusterWidget,
  UnresolvedRefWidget,
} from "./crossref-render";
import { isDebugRenderFlagEnabled } from "./debug-render-flags";
import { pushWidgetDecoration } from "./decoration-core";
import {
  editorFocusField,
  focusTracker,
} from "./focus-state";
import {
  type DirtyRange,
  expandChangeRangeToLines,
  mergeDirtyRanges,
} from "./incremental-dirty-ranges";
import {
  findFocusedInlineRevealTarget,
  inlineRevealTargetChanged,
} from "./inline-reveal-policy";
import { createCursorSensitiveViewPlugin } from "./view-plugin-factories";

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
  const contextFormatter = state.facet(documentContextFacet).citationFormatter ?? null;

  const controller = createEditorReferencePresentationController(state, {
    store,
    formatter,
    surface: documentSurfacePolicy("editor").referenceHostSurface,
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
    if (route.kind === "citation" && !formatter && !contextFormatter) {
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
    parts: ids.map((id) => ({
      id,
      html,
      text: display,
    })),
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
  const documentContext = state.facet(documentContextFacet);
  const contextFormatter = documentContext.citationFormatter ?? null;
  const effectiveFormatter = formatter ?? bibliography.formatter ?? contextFormatter ?? null;
  const citationKeys = effectiveFormatter === contextFormatter
    ? documentContext.citationKeys
    : store;

  // Citation cluster registration is global to document order. Cache it at the
  // (analysis, bibliography-store) boundary so ordinary navigation does not
  // reset and replay every citation cluster.
  if (citationKeys) {
    ensureEditorReferencePresentationCitationsRegistered(
      analysis,
      citationKeys,
      effectiveFormatter,
      getEditorNociteConfig(state),
    );
  }

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

function referenceStateFocus(state: EditorState): boolean {
  return state.field(editorFocusField, false) ?? false;
}

// Reveal focus comes from editorFocusField (flipped by focusTracker's
// focusEffect transactions), not view.hasFocus, so plan-time and collect-time
// focus agree even when DOM focus has already flipped before the effect lands.
function getReferenceRevealChange(
  update: Pick<ViewUpdate, "startState" | "state">,
): ReferenceRevealChange {
  const beforeActive = getRevealedReferenceTarget(
    update.startState,
    referenceStateFocus(update.startState),
  );
  const afterActive = getRevealedReferenceTarget(
    update.state,
    referenceStateFocus(update.state),
  );
  return {
    beforeActive,
    afterActive,
    activeChanged: inlineRevealTargetChanged(beforeActive, afterActive),
  };
}

/** Line-expanded doc-change ranges that could add or remove reference tokens. */
function referenceDocChangeDirtyRanges(update: ViewUpdate): DirtyRange[] {
  const docDirty = computeReferenceDocDirtyRanges(update);
  // Reference tokens always contain "@", so changed lines without "@" on
  // either side of the edit cannot add or remove reference decorations.
  return docDirty.couldContainReferences ? [...docDirty.ranges] : [];
}

/** Ranges of the reveal targets entered/exited by a selection or focus change. */
function referenceRevealDirtyRanges(update: ViewUpdate): DirtyRange[] {
  const { beforeActive, afterActive, activeChanged } = getReferenceRevealChange(update);
  if (!activeChanged) return [];
  const mappedBeforeActive = beforeActive && update.docChanged
    ? mapReferenceDirtyRange(beforeActive, update.changes)
    : beforeActive;
  return mergeDirtyRangesWithActiveReference([], mappedBeforeActive, afterActive);
}

function collectVisibleReferenceRanges(
  view: EditorView,
  ranges: readonly DirtyRange[],
  skip: (nodeFrom: number) => boolean,
): Range<Decoration>[] {
  const { analysis, bibliography } = getReferenceRenderState(view.state);
  const visibleRefs = collectDirtyReferences(analysis.references, ranges)
    .filter((reference) => !skip(reference.from));
  if (visibleRefs.length === 0) return [];
  const { store, formatter } = bibliography;
  return collectReferenceRanges(
    view.state,
    referenceStateFocus(view.state),
    store,
    formatter,
    visibleRefs,
  );
}

const referenceViewPlugin = createCursorSensitiveViewPlugin(
  collectVisibleReferenceRanges,
  {
    contextChangeRanges: referenceRevealDirtyRanges,
    docChangeRanges: referenceDocChangeDirtyRanges,
    // Viewport rebuild when render dependencies change, or when the
    // references slice is replaced. The slice check must run on doc-changed
    // transactions too: in-transaction pending-region consumption can swap
    // references far from the edit (e.g. a fence opener recoding the tail of
    // the document) while referenceDocChangeDirtyRanges only covers
    // edit-local lines. When the slice is unchanged, the incremental
    // doc-change/mapping path below stays in effect.
    extraRebuildCheck: (update) =>
      referenceRenderRebuildDependenciesChanged(update.startState, update.state) ||
      referenceRenderSliceChanged(update.startState, update.state),
    spanName: "cm6.referenceRender",
  },
);

/** CM6 extension that renders all [@id] and @id references with Typora-style toggle. */
export const referenceRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  referenceViewPlugin,
];

function computeReferenceDirtyRanges(update: ViewUpdate): DirtyRange[] {
  return mergeDirtyRanges([
    ...referenceDocChangeDirtyRanges(update),
    ...referenceRevealDirtyRanges(update),
  ]);
}

export { computeReferenceDirtyRanges as _computeReferenceDirtyRangesForTest };
