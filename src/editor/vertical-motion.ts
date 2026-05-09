import { EditorSelection, type SelectionRange } from "@codemirror/state";
import { type EditorView } from "@codemirror/view";
import {
  activateStructureEditAt,
  clearStructureEditTarget,
  createStructureEditTargetAt,
  getActiveStructureEditTarget,
  structureEditTargetContainsPos,
} from "../state/cm-structure-edit";
import {
  activateHiddenWidgetStop,
  activateTableStop,
  displayMathExitRange,
  exitActiveDisplayMathTarget,
} from "./vertical-motion-entry-adapters";
import {
  planVerticalMotionStop,
  shouldCorrectStructureExit,
  shouldFallbackRootMotion,
  type VerticalMotionStopPlan,
} from "./vertical-motion-planner";
import {
  preserveDirectionalScrollTop,
  recordVerticalMotionGuardEvent,
  requestSelectionVisibility,
  scheduleReverseScrollGuard,
  snapshotVerticalMotion,
} from "./vertical-motion-scroll";
import { type VerticalMotionSnapshot } from "./vertical-motion-scroll-model";
import {
  firstHiddenWidgetStopBetweenLines,
  getWidgetStopIndex,
  hiddenWidgetStopAtPos,
} from "./widget-stop-index";

export {
  boundedDirectionalScrollTop,
  correctedReverseVerticalScrollTop,
  sumTraversedLineHeights,
  type VerticalMotionSnapshot,
} from "./vertical-motion-scroll-model";

export {
  clearVerticalMotionGuardEvents,
  getVerticalMotionGuardEvents,
  type VerticalMotionGuardEvent,
} from "./vertical-motion-scroll";

function fallbackVerticalCursor(
  view: EditorView,
  lineNumber: number,
  forward: boolean,
): SelectionRange {
  const targetLineNumber = forward
    ? Math.min(view.state.doc.lines, lineNumber + 1)
    : Math.max(1, lineNumber - 1);
  const targetLine = view.state.doc.line(targetLineNumber);
  return EditorSelection.cursor(
    forward ? targetLine.from : targetLine.to,
    forward ? 1 : -1,
  );
}

function recordCorrectedLineJump(
  view: EditorView,
  before: VerticalMotionSnapshot,
  rawTargetLine: number,
  correctedTargetLine: number,
  forward: boolean,
): void {
  recordVerticalMotionGuardEvent(view, {
    kind: "visible-line-jump",
    direction: forward ? "down" : "up",
    beforeLine: before.line,
    rawTargetLine,
    correctedTargetLine,
    timestamp: Date.now(),
  });
}

function finishHandledMotion(
  view: EditorView,
  before: VerticalMotionSnapshot,
  forward: boolean,
): void {
  preserveDirectionalScrollTop(view, before.scrollTop, forward);
  requestSelectionVisibility(view, forward ? "down" : "up", before.scrollTop);
  scheduleReverseScrollGuard(view, before, forward);
}

function activatePlannedStop(
  view: EditorView,
  plan: VerticalMotionStopPlan,
  forward: boolean,
): number | null {
  switch (plan.kind) {
    case "hidden-crossed":
      return activateHiddenWidgetStop(view, plan.stop, forward);
    case "hidden-landed":
      return activateHiddenWidgetStop(view, plan.stop, forward, plan.landedHead);
    case "table-crossed":
    case "table-landed":
      return activateTableStop(view, plan.table, forward);
  }
}

function handleActiveStructureMotion(
  view: EditorView,
  activeStructure: NonNullable<ReturnType<typeof getActiveStructureEditTarget>>,
  before: VerticalMotionSnapshot,
  nextRange: SelectionRange,
  forward: boolean,
): boolean {
  const nextTargetLine = view.state.doc.lineAt(nextRange.head).number;
  const nextInsideActiveStructure = structureEditTargetContainsPos(
    activeStructure,
    nextRange.head,
  );
  const shouldCorrectExit = shouldCorrectStructureExit(
    before.line,
    nextTargetLine,
    nextInsideActiveStructure,
    forward,
  );

  if (!nextInsideActiveStructure) {
    // Before exiting the active structure, check whether the natural motion
    // would skip over a hidden widget stop (e.g. a block image inside a
    // figure). If so, land the cursor on that stop instead of past it so the
    // user can reach the inner source line by ArrowDown — symmetric with
    // ArrowUp, which already enters the image source from below.
    const motionStartLine = view.state.doc.line(Math.min(before.line, nextTargetLine));
    const motionEndLine = view.state.doc.line(Math.max(before.line, nextTargetLine));
    const stopsBetween = getWidgetStopIndex(view, [{
      from: motionStartLine.from,
      to: motionEndLine.to,
    }]);
    const crossedStop = firstHiddenWidgetStopBetweenLines(
      stopsBetween,
      before.line,
      nextTargetLine,
      forward,
    );
    const currentStop = hiddenWidgetStopAtPos(stopsBetween, before.head);
    if (crossedStop && crossedStop !== currentStop) {
      clearStructureEditTarget(view);
      const correctedTargetLine = activateHiddenWidgetStop(view, crossedStop, forward);
      if (correctedTargetLine !== null) {
        if (correctedTargetLine !== nextTargetLine) {
          recordCorrectedLineJump(view, before, nextTargetLine, correctedTargetLine, forward);
        }
        finishHandledMotion(view, before, forward);
        return true;
      }
    }

    clearStructureEditTarget(view);
    const exitRange = activeStructure.kind === "display-math"
      ? shouldCorrectExit
        ? displayMathExitRange(activeStructure, forward)
        : EditorSelection.cursor(nextRange.head, forward ? 1 : -1)
      : shouldCorrectExit
        ? fallbackVerticalCursor(view, before.line, forward)
        : EditorSelection.cursor(nextRange.head, forward ? 1 : -1);
    const correctedTargetLine = view.state.doc.lineAt(exitRange.head).number;
    if (correctedTargetLine !== nextTargetLine) {
      recordCorrectedLineJump(view, before, nextTargetLine, correctedTargetLine, forward);
    }
    view.dispatch({
      selection: exitRange,
      scrollIntoView: false,
      userEvent: "select",
    });
  } else {
    view.dispatch({
      selection: view.state.selection.replaceRange(nextRange),
      scrollIntoView: false,
      userEvent: "select",
    });
  }

  finishHandledMotion(view, before, forward);
  return true;
}

function handleRootMotion(
  view: EditorView,
  before: VerticalMotionSnapshot,
  nextRange: SelectionRange,
  forward: boolean,
): boolean {
  const initialTargetLine = view.state.doc.lineAt(nextRange.head).number;
  const fallbackRange = shouldFallbackRootMotion(before.line, initialTargetLine, forward)
    ? fallbackVerticalCursor(view, before.line, forward)
    : null;
  if (fallbackRange) {
    const correctedTargetLine = view.state.doc.lineAt(fallbackRange.head).number;
    recordCorrectedLineJump(view, before, initialTargetLine, correctedTargetLine, forward);
  }

  const normalizedNextRange = fallbackRange ?? nextRange;
  const rawTargetLine = view.state.doc.lineAt(normalizedNextRange.head).number;
  const motionStartLine = view.state.doc.line(Math.min(before.line, rawTargetLine));
  const motionEndLine = view.state.doc.line(Math.max(before.line, rawTargetLine));
  const widgetStops = getWidgetStopIndex(view, [{
    from: motionStartLine.from,
    to: motionEndLine.to,
  }]);
  const currentHiddenStop = hiddenWidgetStopAtPos(widgetStops, before.head);
  if (currentHiddenStop) {
    const correctedTargetLine = activateHiddenWidgetStop(
      view,
      currentHiddenStop,
      forward,
      before.head,
    );
    if (correctedTargetLine !== null) {
      recordCorrectedLineJump(view, before, rawTargetLine, correctedTargetLine, forward);
      finishHandledMotion(view, before, forward);
      return true;
    }
  }
  const stopPlan = planVerticalMotionStop(
    widgetStops,
    before.line,
    rawTargetLine,
    normalizedNextRange.head,
    forward,
  );

  if (stopPlan) {
    const correctedTargetLine = activatePlannedStop(view, stopPlan, forward);
    if (correctedTargetLine !== null) {
      recordCorrectedLineJump(view, before, rawTargetLine, correctedTargetLine, forward);
      finishHandledMotion(view, before, forward);
      return true;
    }
  }

  const landedStructureTarget = createStructureEditTargetAt(view.state, normalizedNextRange.head);
  if (
    landedStructureTarget &&
    structureEditTargetContainsPos(landedStructureTarget, normalizedNextRange.head) &&
    activateStructureEditAt(view, normalizedNextRange.head)
  ) {
    finishHandledMotion(view, before, forward);
    return true;
  }

  view.dispatch({
    selection: view.state.selection.replaceRange(normalizedNextRange),
    scrollIntoView: false,
    userEvent: "select",
  });
  finishHandledMotion(view, before, forward);
  return true;
}

export function moveVerticallyInRichView(
  view: EditorView,
  forward: boolean,
): boolean {
  const range = view.state.selection.main;
  if (!range.empty) return false;
  const activeStructure = getActiveStructureEditTarget(view.state);

  const before = snapshotVerticalMotion(view);
  const nextRange = view.moveVertically(range, forward);

  if (
    nextRange.anchor === range.anchor &&
    nextRange.head === range.head
  ) {
    if (exitActiveDisplayMathTarget(view, forward, before.scrollTop)) {
      scheduleReverseScrollGuard(view, before, forward);
      return true;
    }
    // Consume the key at rich-mode boundaries so CM6's default ArrowUp/Down
    // handler does not run a second vertical move with different assoc/goal
    // state and bounce between the terminal blank line and the last content line.
    return true;
  }

  if (activeStructure) {
    return handleActiveStructureMotion(view, activeStructure, before, nextRange, forward);
  }

  return handleRootMotion(view, before, nextRange, forward);
}
