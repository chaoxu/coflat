/**
 * Cancelable idle-or-timeout scheduling primitive shared by the low-priority
 * background drivers (`render/syntax-parse-scheduler.ts` parse nudger,
 * `state/pending-analysis-drain.ts` analysis drainer). Prefers
 * `requestIdleCallback` with a bounded timeout so work runs during idle
 * periods but never starves; falls back to a short timeout where idle
 * callbacks are unavailable (jsdom, Safari).
 */

type IdleTaskHandle = number;

type WindowWithIdleTask = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { readonly timeout?: number },
  ) => IdleTaskHandle;
  cancelIdleCallback?: (handle: IdleTaskHandle) => void;
};

export interface ScheduledHandle {
  readonly kind: "idle" | "timeout";
  readonly id: number;
}

/** Upper bound before an idle-scheduled task is forced to run. */
export const IDLE_TASK_TIMEOUT_MS = 250;
/** Fallback delay when `requestIdleCallback` is unavailable. */
export const IDLE_TASK_RETRY_DELAY_MS = 32;

export function scheduleIdleOrTimeout(task: () => void): ScheduledHandle {
  const idleWindow = window as WindowWithIdleTask;
  if (idleWindow.requestIdleCallback) {
    return {
      kind: "idle",
      id: idleWindow.requestIdleCallback(task, { timeout: IDLE_TASK_TIMEOUT_MS }),
    };
  }
  return {
    kind: "timeout",
    id: window.setTimeout(task, IDLE_TASK_RETRY_DELAY_MS),
  };
}

export function cancelScheduledHandle(handle: ScheduledHandle): void {
  if (handle.kind === "idle") {
    (window as WindowWithIdleTask).cancelIdleCallback?.(handle.id);
    return;
  }
  window.clearTimeout(handle.id);
}
