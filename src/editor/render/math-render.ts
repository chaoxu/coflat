import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { getBlockManifestEntry } from "../../core/constants/block-manifest";
import { CSS } from "../../core/constants/css-classes";
import { getLastFencedDivContentLine } from "../fenced-block/model";
import { measureSync } from "../lib/perf";
import {
  type DocumentAnalysis,
  getEquationNumbersCacheKey,
  type MathSemantics,
} from "../semantics/document";
import { createChangeChecker } from "../state/change-detection";
import { getActiveStructureEditTarget } from "../state/cm-structure-edit";
import { documentAnalysisField } from "../state/document-analysis";
import { mathMacrosField } from "../state/math-macros";
import { programmaticDocumentChangeAnnotation } from "../state/programmatic-document-change";
import { isDebugRenderFlagEnabled } from "./debug-render-flags";
import {
  buildDecorations,
  pushBlockWidgetReplacementDecoration,
  pushWidgetDecoration,
} from "./decoration-core";
import { createDecorationStateField } from "./decoration-field";
import {
  editorFocusField,
  focusTracker,
} from "./focus-state";
import { mergeDirtyRanges } from "./incremental-dirty-ranges";
import {
  findFocusedInlineRevealTarget,
  inlineRevealTargetChanged,
} from "./inline-reveal-policy";
import {
  inlineMathSelectionAtomPlugin,
  mathMouseSelectionStyle,
} from "./math-interactions";
import { createMathWidgetMetadataPlugin } from "./math-metadata";
import { mathPrewarmPlugin } from "./math-prewarm";
import {
  collectActiveMathDirtyRanges,
  collectDirtyMathRegions,
  collectMathDirtyRanges,
  decorationIntersectsMathDirtyRanges,
  docChangeCanShiftDecorationSet,
  docChangeCanShiftMathDecorations,
  summarizeMathChanges,
} from "./math-render-dirty-ranges";
import {
  buildEquationNumbersByFrom,
  getDisplayEquationNumber,
} from "./math-source";
import { MathWidget } from "./math-widget";
import {
  activeFlowBlockquoteRange,
  enclosingFlowBlockquote,
  flowBlockquoteRangesEqual,
  selectionIntersectsRange,
} from "./rendered-block-flow";
import { serializeMacros } from "./source-widget";
import { planSemanticSensitiveUpdate } from "./view-plugin-factories";

export { renderKatexToHtml } from "./inline-shared";
export { resolveClickToSourcePos } from "./math-interactions";
export {
  _snapToTokenBoundary,
  DISPLAY_DELIMITERS,findActiveMath, 
  getDisplayMathContentEnd,
  INLINE_DELIMITERS,
  MATH_TYPES,
  stripMathDelimiters
} from "./math-source";
export { clearKatexCache, MathWidget, renderKatex } from "./math-widget";

const EMPTY_MACROS: Record<string, string> = {};

function sameSerializedMacros(
  before: Record<string, string>,
  after: Record<string, string>,
): boolean {
  return before === after || serializeMacros(before) === serializeMacros(after);
}

function buildQedDisplayMathStarts(
  state: EditorState,
  analysis: DocumentAnalysis,
  regions: readonly MathSemantics[],
): ReadonlySet<number> {
  const displayMathByLastLineFrom = new Map<number, MathSemantics[]>();
  let regionFrom = Number.POSITIVE_INFINITY;
  let regionTo = Number.NEGATIVE_INFINITY;
  for (const region of regions) {
    if (!region.isDisplay) continue;
    regionFrom = Math.min(regionFrom, region.from);
    regionTo = Math.max(regionTo, region.to);
    const lastLine = state.doc.lineAt(Math.max(region.from, region.to - 1));
    const bucket = displayMathByLastLineFrom.get(lastLine.from);
    if (bucket) {
      bucket.push(region);
    } else {
      displayMathByLastLineFrom.set(lastLine.from, [region]);
    }
  }
  if (displayMathByLastLineFrom.size === 0) return new Set();

  const starts = new Set<number>();
  for (const div of analysis.fencedDivs) {
    if (div.closeFenceFrom < 0) continue;
    if (div.openFenceTo > regionTo || div.closeFenceFrom < regionFrom) continue;
    const entry = getBlockManifestEntry(div.primaryClass);
    if (entry?.specialBehavior !== "qed") continue;
    const lastContentLine = getLastFencedDivContentLine(state.doc, div);
    if (!lastContentLine) continue;
    const candidates = displayMathByLastLineFrom.get(lastContentLine.from);
    const region = candidates?.find((candidate) =>
      candidate.from >= div.openFenceTo && candidate.to <= div.closeFenceFrom
    );
    if (region) {
      starts.add(region.from);
    }
  }
  return starts;
}

const mathMacrosChanged = createChangeChecker({
  get: (state) => state.field(mathMacrosField, false) ?? EMPTY_MACROS,
  equals: sameSerializedMacros,
});

function getExplicitDisplayMathTarget(
  state: EditorState,
): Pick<MathSemantics, "from" | "to"> | undefined {
  const active = getActiveStructureEditTarget(state);
  return active?.kind === "display-math"
    ? { from: active.from, to: active.to }
    : undefined;
}

function getTouchedInlineMathTarget(
  state: EditorState,
  focused: boolean,
): Pick<MathSemantics, "from" | "to"> | null {
  return findFocusedInlineRevealTarget(
    state.selection.main,
    state.field(documentAnalysisField).mathRegions,
    focused,
    (region) => !region.isDisplay,
  );
}

function displayMathVisualReplacementFrom(
  state: EditorState,
  sourceFrom: number,
): number {
  const line = state.doc.lineAt(sourceFrom);
  if (line.from === sourceFrom) return sourceFrom;

  const prefix = state.sliceDoc(line.from, sourceFrom);
  return /^\s*$/.test(prefix) ? line.from : sourceFrom;
}

function displayMathContextClassNames(
  state: EditorState,
  analysis: DocumentAnalysis,
  region: MathSemantics,
): readonly string[] {
  if (!region.isDisplay) return [];
  const insideFencedBlockquote = analysis.fencedDivs.some((div) => {
    if (div.primaryClass !== "blockquote") return false;
    const contentTo = div.closeFenceFrom >= 0 ? div.closeFenceFrom : div.to;
    return region.from >= div.openFenceTo && region.to <= contentTo;
  });
  const insideMarkdownBlockquote = (() => {
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(region.from, -1);
    while (node) {
      if (node.name === "Blockquote" && region.to <= node.to) return true;
      node = node.parent;
    }
    return false;
  })();
  return insideFencedBlockquote || insideMarkdownBlockquote
    ? [CSS.blockquoteDisplayMath]
    : [];
}

function displayMathCoveredByInactiveBlockquoteFlow(
  state: EditorState,
  region: MathSemantics,
): boolean {
  if (!region.isDisplay) return false;
  const blockquote = enclosingFlowBlockquote(state, region.from, region.to);
  if (!blockquote) return false;
  return !selectionIntersectsRange(
    state,
    blockquote.from,
    blockquote.to,
    state.field(editorFocusField, false) ?? false,
  );
}

function getRevealedMathTarget(
  state: EditorState,
  focused: boolean,
): Pick<MathSemantics, "from" | "to"> | undefined {
  return getExplicitDisplayMathTarget(state)
    ?? getTouchedInlineMathTarget(state, focused)
    ?? undefined;
}

/**
 * Build decoration ranges for math nodes, skipping nodes where
 * `shouldSkip(from, to)` returns true.
 */
function buildMathItems(
  state: EditorState,
  regions: readonly MathSemantics[],
  shouldSkip: (from: number, to: number) => boolean,
): Range<Decoration>[] {
  const macros = state.field(mathMacrosField);
  const analysis = state.field(documentAnalysisField);
  const equationNumbersByFrom = buildEquationNumbersByFrom(analysis.equationById);
  const qedDisplayMathStarts = buildQedDisplayMathStarts(state, analysis, regions);
  const items: Range<Decoration>[] = [];
  const disableInlineMathWidgets = isDebugRenderFlagEnabled("disableInlineMathWidgets");
  const disableDisplayMathWidgets = isDebugRenderFlagEnabled("disableDisplayMathWidgets");

  for (const region of regions) {
    if (displayMathCoveredByInactiveBlockquoteFlow(state, region)) continue;
    if (shouldSkip(region.from, region.to)) {
      if (region.contentFrom > region.from) {
        // Keep delimiters on the lighter source-delimiter class so they
        // do not make the edited math line taller than the body content. (#789)
        items.push(
          Decoration.mark({ class: CSS.sourceDelimiter }).range(region.from, region.contentFrom),
        );
      }
      if (region.contentFrom < region.contentTo) {
        items.push(
          Decoration.mark({ class: CSS.mathSource }).range(region.contentFrom, region.contentTo),
        );
      }
      const closingDelimiterStart = region.isDisplay && region.labelFrom !== undefined
        ? region.labelFrom
        : region.to;
      if (closingDelimiterStart > region.contentTo) {
        items.push(
          Decoration.mark({ class: CSS.sourceDelimiter }).range(
            region.contentTo,
            closingDelimiterStart,
          ),
        );
      }
      if (region.isDisplay && region.labelFrom !== undefined && region.to > region.labelFrom) {
        items.push(
          Decoration.mark({ class: CSS.mathSource }).range(region.labelFrom, region.to),
        );
      }
      if (region.isDisplay && !disableDisplayMathWidgets) {
        // Display math stays rendered even while showing source marks so the
        // block height and click target remain stable during cursor reveal.
        const widget = new MathWidget(
          region.latex,
          state.sliceDoc(region.from, region.to),
          true,
          macros,
          region.contentFrom - region.from,
          getDisplayEquationNumber(region, equationNumbersByFrom),
          qedDisplayMathStarts.has(region.from),
          displayMathContextClassNames(state, analysis, region),
        );
        widget.sourceFrom = region.from;
        widget.sourceTo = region.to;
        items.push(Decoration.widget({ widget, block: true, side: 1 }).range(region.to));
      }
      continue;
    }

    if (region.isDisplay) {
      if (disableDisplayMathWidgets) continue;
      const widget = new MathWidget(
        region.latex,
        state.sliceDoc(region.from, region.to),
        true,
        macros,
        region.contentFrom - region.from,
        getDisplayEquationNumber(region, equationNumbersByFrom),
        qedDisplayMathStarts.has(region.from),
        displayMathContextClassNames(state, analysis, region),
      );
      pushBlockWidgetReplacementDecoration(
        items,
        widget,
        displayMathVisualReplacementFrom(state, region.from),
        region.to,
        region.from,
        region.to,
      );
    } else if (!disableInlineMathWidgets) {
      const widget = new MathWidget(
        region.latex,
        state.sliceDoc(region.from, region.to),
        false,
        macros,
        region.contentFrom - region.from,
      );
      pushWidgetDecoration(items, widget, region.from, region.to);
    }
  }

  return items;
}

/**
 * Collect decoration ranges for math nodes outside the current reveal target.
 */
export function collectMathRanges(view: EditorView): Range<Decoration>[] {
  const activeMath = getRevealedMathTarget(view.state, view.hasFocus);
  return buildMathItems(
    view.state,
    view.state.field(documentAnalysisField).mathRegions,
    (from, to) => Boolean(activeMath?.from === from && activeMath?.to === to),
  );
}

function buildMathDecorationsFromState(state: EditorState): DecorationSet {
  const activeMath = getRevealedMathTarget(
    state,
    state.field(editorFocusField, false) ?? false,
  );
  const items = buildMathItems(
    state,
    state.field(documentAnalysisField).mathRegions,
    (from, to) => Boolean(activeMath?.from === from && activeMath?.to === to),
  );
  return buildDecorations(items);
}

function equationNumberingChanged(
  before: DocumentAnalysis,
  after: DocumentAnalysis,
): boolean {
  return before.equations !== after.equations
    && getEquationNumbersCacheKey(before) !== getEquationNumbersCacheKey(after);
}

function buildMathRangesForRegions(
  state: EditorState,
  regions: readonly MathSemantics[],
): Range<Decoration>[] {
  const activeMath = getRevealedMathTarget(
    state,
    state.field(editorFocusField, false) ?? false,
  );
  return buildMathItems(
    state,
    regions,
    (from, to) => Boolean(activeMath?.from === from && activeMath?.to === to),
  );
}

function rebuildMathDecorations(state: EditorState): DecorationSet {
  return buildMathDecorationsFromState(state);
}

/**
 * CM6 StateField that provides math rendering decorations.
 *
 * Uses a StateField so that block-level replace decorations for display math
 * are permitted by CM6.
 */
const mathDecorationField = createDecorationStateField({
  spanName: "cm6.mathDecorations",
  create(state) {
    return rebuildMathDecorations(state);
  },

  update(value, tr) {
    const analysisBefore = tr.startState.field(documentAnalysisField);
    const analysisAfter = tr.state.field(documentAnalysisField);
    const regionsBefore = analysisBefore.mathRegions;
    const regionsAfter = analysisAfter.mathRegions;
    const beforeActive = getRevealedMathTarget(
      tr.startState,
      tr.startState.field(editorFocusField, false) ?? false,
    );
    const afterActive = getRevealedMathTarget(
      tr.state,
      tr.state.field(editorFocusField, false) ?? false,
    );
    const activeMathChanged = inlineRevealTargetChanged(beforeActive, afterActive);
    const activeMathNeedsSelectionRefresh =
      tr.selection !== undefined && afterActive !== undefined;
    const beforeActiveBlockquote = activeFlowBlockquoteRange(
      tr.startState,
      tr.startState.field(editorFocusField, false) ?? false,
    );
    const afterActiveBlockquote = activeFlowBlockquoteRange(
      tr.state,
      tr.state.field(editorFocusField, false) ?? false,
    );
    const activeBlockquoteChanged = !flowBlockquoteRangesEqual(
      beforeActiveBlockquote,
      afterActiveBlockquote,
    );
    const mathPositionsMayShift = docChangeCanShiftMathDecorations(tr, regionsBefore);
    const mathChangeSummary = tr.docChanged
      ? summarizeMathChanges(tr, regionsBefore, regionsAfter)
      : {
          changedMathDirtyRanges: [],
          hasMathSyntaxEdit: false,
          touchesExistingMath: false,
        };
    const docChangeOnlyShiftsMath =
      tr.docChanged
      && !mathChangeSummary.hasMathSyntaxEdit
      && !mathChangeSummary.touchesExistingMath;

    const updatePlan = planSemanticSensitiveUpdate(tr, {
      docChanged: (transaction) => transaction.docChanged,
      semanticChanged: () => {
        if (docChangeOnlyShiftsMath && !mathPositionsMayShift) return false;
        return regionsBefore !== regionsAfter || mathPositionsMayShift;
      },
      contextChanged: () => activeMathChanged || activeBlockquoteChanged,
      contextUpdateMode: "dirty-ranges",
      // Edits after every math range can keep the DecorationSet by identity.
      // The "keep" branch below still maps when the actual decoration set
      // would shift or exceed the new document bounds.
      stableDocChangeMode: "keep",
      shouldRebuild: (_transaction, context) => {
        if (tr.annotation(programmaticDocumentChangeAnnotation) === true) {
          return true;
        }
        if (mathMacrosChanged(tr)) {
          return true;
        }
        if (docChangeOnlyShiftsMath) {
          return false;
        }
        if (
          context.docChanged
          && context.semanticChanged
          && regionsBefore.length !== regionsAfter.length
        ) {
          return true;
        }
        return context.docChanged
          && context.semanticChanged
          && equationNumberingChanged(analysisBefore, analysisAfter);
      },
      dirtyRanges: (_transaction, context) => {
        const activeDirtyRanges = collectActiveMathDirtyRanges(
          tr,
          activeMathChanged || activeMathNeedsSelectionRefresh,
          beforeActive,
          afterActive,
        );
        const blockquoteDirtyRanges = [
          beforeActiveBlockquote,
          afterActiveBlockquote,
        ].filter((range): range is { readonly from: number; readonly to: number } => range !== null);

        if (!context.docChanged) {
          return mergeDirtyRanges([
            ...activeDirtyRanges,
            ...blockquoteDirtyRanges,
          ]);
        }

        if (!context.docChanged || !context.semanticChanged) {
          return mergeDirtyRanges([
            ...activeDirtyRanges,
            ...blockquoteDirtyRanges,
          ]);
        }

        const mathDirtyRanges = collectMathDirtyRanges(
          tr,
          docChangeOnlyShiftsMath,
          mathChangeSummary.changedMathDirtyRanges,
        );
        return mergeDirtyRanges([
          ...mathDirtyRanges,
          ...activeDirtyRanges,
          ...blockquoteDirtyRanges,
        ]);
      },
    });

    switch (updatePlan.kind) {
      case "keep":
        return measureSync("cm6.mathDecorations.keep", () =>
          tr.docChanged && docChangeCanShiftDecorationSet(value, tr)
            ? value.map(tr.changes)
            : value
        );
      case "map":
        return measureSync("cm6.mathDecorations.map", () => value.map(tr.changes));
      case "rebuild":
        return measureSync(
          "cm6.mathDecorations.rebuild",
          () => rebuildMathDecorations(tr.state),
        );
      case "dirty": {
        return measureSync("cm6.mathDecorations.dirty", () => {
          const mapped = value.map(tr.changes);
          const dirtyRegions = collectDirtyMathRegions(regionsAfter, updatePlan.dirtyRanges);
          let next = mapped;
          for (const range of updatePlan.dirtyRanges) {
            next = next.update({
              filterFrom: range.from,
              filterTo: range.to,
              filter: (from, to) => !decorationIntersectsMathDirtyRanges(from, to, [range]),
            });
          }
          if (dirtyRegions.length > 0) {
            next = next.update({
              add: buildMathRangesForRegions(tr.state, dirtyRegions),
              sort: true,
            });
          }
          return next;
        });
      }
    }
  },
});

export { mathDecorationField as _mathDecorationFieldForTest };

const mathWidgetMetadataPlugin = createMathWidgetMetadataPlugin(mathDecorationField);

/** CM6 extension that renders math expressions with KaTeX (Typora-style toggle). */
export const mathRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  mathMacrosField,
  mathDecorationField,
  mathMouseSelectionStyle,
  inlineMathSelectionAtomPlugin,
  mathWidgetMetadataPlugin,
  mathPrewarmPlugin,
];
