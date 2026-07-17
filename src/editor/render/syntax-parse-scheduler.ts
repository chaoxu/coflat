import {
  forceParsing,
  syntaxParserRunning,
  syntaxTreeAvailable,
} from "@codemirror/language";
import type { EditorView } from "@codemirror/view";

import {
  cancelScheduledHandle,
  type ScheduledHandle,
  scheduleIdleOrTimeout,
} from "../lib/idle-scheduler";

export interface SyntaxParseScheduleRequest {
  readonly targetTo: number;
  readonly budgetMs?: number;
  readonly isStillNeeded: () => boolean;
}

const DEFAULT_PARSE_BUDGET_MS = 25;

/**
 * Coalesces low-priority CM6 parse nudges for render plugins.
 *
 * Renderers should request the smallest target that covers their dirty region.
 * The scheduler yields to normal browser work and retries only while CM6 still
 * reports an active parser.
 */
export class SyntaxParseScheduler {
  private scheduled: ScheduledHandle | null = null;
  private destroyed = false;
  private targetTo = 0;
  private budgetMs = DEFAULT_PARSE_BUDGET_MS;
  private isStillNeeded: (() => boolean) | null = null;

  constructor(private readonly view: EditorView) {}

  schedule(request: SyntaxParseScheduleRequest): void {
    if (this.destroyed) return;
    this.targetTo = request.targetTo;
    this.budgetMs = request.budgetMs ?? DEFAULT_PARSE_BUDGET_MS;
    this.isStillNeeded = request.isStillNeeded;
    if (!this.shouldParse()) return;
    if (this.scheduled !== null) return;
    this.scheduled = scheduleIdleOrTimeout(() => this.run());
  }

  destroy(): void {
    this.destroyed = true;
    const scheduled = this.scheduled;
    this.scheduled = null;
    if (scheduled !== null) {
      cancelScheduledHandle(scheduled);
    }
  }

  private shouldParse(): boolean {
    if (this.destroyed) return false;
    if (!this.isStillNeeded?.()) return false;
    return !syntaxTreeAvailable(this.view.state, this.targetTo);
  }

  private run(): void {
    this.scheduled = null;
    if (!this.shouldParse()) return;

    forceParsing(this.view, this.targetTo, this.budgetMs);
    if (this.shouldParse() && syntaxParserRunning(this.view)) {
      this.scheduled = scheduleIdleOrTimeout(() => this.run());
    }
  }
}
