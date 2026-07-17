import {
  forceParsing,
  syntaxParserRunning,
  syntaxTreeAvailable,
} from "@codemirror/language";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import {
  cancelScheduledHandle,
  type ScheduledHandle,
  scheduleIdleOrTimeout,
} from "../lib/idle-scheduler";
import { semanticPendingDrainAnnotation } from "../semantics/incremental/semantic-delta";
import { documentAnalysisField } from "./document-analysis";

const DRAIN_PARSE_BUDGET_MS = 25;
/**
 * Consecutive drain steps allowed to make no observable progress before the
 * driver stops rescheduling (until the next editor update). Progress is
 * normally guaranteed — this is a backstop against idle-loop spins.
 */
const MAX_STALLED_DRAIN_STEPS = 2;

/**
 * Idle drain driver for the incremental analysis engine's pending regions.
 *
 * The doc-changed reconcile budget can leave pending regions behind with no
 * scheduled consumer: when the incremental reparse completes within the
 * transaction, no tree-progress tick ever fires, so the stale suffix would
 * persist indefinitely. This plugin watches `documentAnalysisField` and,
 * while pending regions remain, keeps scheduling idle work: it nudges the
 * parser when the frontier does not cover the pending regions (tree-progress
 * ticks then reconcile them), and otherwise dispatches an empty
 * `semanticPendingDrainAnnotation` transaction so the engine consumes another
 * budgeted chunk, repeating until drained.
 */
export class PendingAnalysisDrainer {
  private scheduled: ScheduledHandle | null = null;
  private destroyed = false;
  private stalledSteps = 0;

  constructor(private readonly view: EditorView) {
    this.schedule();
  }

  update(update: ViewUpdate): void {
    // Only real progress resets the stall backstop; the driver's own no-op
    // drain transactions must not, or a stall would reschedule forever.
    if (
      update.docChanged
      || update.startState.field(documentAnalysisField, false)
        !== update.state.field(documentAnalysisField, false)
    ) {
      this.stalledSteps = 0;
    }
    this.schedule();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.scheduled !== null) {
      cancelScheduledHandle(this.scheduled);
      this.scheduled = null;
    }
  }

  private pendingRegions() {
    const snapshot = this.view.state.field(documentAnalysisField, false);
    return snapshot?.incrementalState.pendingRegions ?? [];
  }

  private schedule(): void {
    if (this.destroyed || this.scheduled !== null) return;
    if (this.pendingRegions().length === 0) return;
    if (this.stalledSteps >= MAX_STALLED_DRAIN_STEPS) return;
    this.scheduled = scheduleIdleOrTimeout(() => {
      this.scheduled = null;
      this.drainStep();
      this.schedule();
    });
  }

  /**
   * One idle unit of drain work. Exposed for tests, which drive it
   * synchronously instead of through idle callbacks.
   */
  drainStep(): void {
    if (this.destroyed) return;
    const pending = this.pendingRegions();
    if (pending.length === 0) return;

    const snapshotBefore = this.view.state.field(documentAnalysisField, false);
    const target = Math.min(pending[pending.length - 1].to, this.view.state.doc.length);
    if (!syntaxTreeAvailable(this.view.state, target)) {
      // The engine cannot consume past the frontier; move the parse forward
      // instead. Tree-progress ticks then reconcile without a budget.
      forceParsing(this.view, target, DRAIN_PARSE_BUDGET_MS);
    } else {
      this.view.dispatch({
        annotations: semanticPendingDrainAnnotation.of(true),
      });
    }

    const snapshotAfter = this.view.state.field(documentAnalysisField, false);
    if (snapshotAfter === snapshotBefore && !syntaxParserRunning(this.view)) {
      this.stalledSteps += 1;
    }
  }
}

export const pendingAnalysisDrainPlugin = ViewPlugin.fromClass(PendingAnalysisDrainer);
