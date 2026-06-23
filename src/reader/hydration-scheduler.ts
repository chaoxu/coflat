interface BrowserScheduler {
  postTask?: (callback: () => void, options?: { priority?: "user-visible" | "background" }) => Promise<void>;
}

function browserScheduler(): BrowserScheduler | undefined {
  return (globalThis as typeof globalThis & { scheduler?: BrowserScheduler }).scheduler;
}

export function scheduleHydrationYield(): Promise<void> {
  const scheduler = browserScheduler();
  if (scheduler?.postTask) {
    return scheduler.postTask(() => {}, { priority: "user-visible" });
  }

  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve(), { timeout: 50 });
      return;
    }
    setTimeout(resolve, 0);
  });
}

function isElementVisibleInViewport(el: HTMLElement): boolean {
  if (!el.isConnected || typeof el.getBoundingClientRect !== "function") {
    return false;
  }
  const rect = el.getBoundingClientRect();
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 0;
  return viewportHeight > 0 && rect.bottom >= 0 && rect.top <= viewportHeight;
}

export function orderElementsVisibleFirst(
  elements: readonly HTMLElement[],
): HTMLElement[] {
  const visible: HTMLElement[] = [];
  const deferred: HTMLElement[] = [];
  for (const element of elements) {
    (isElementVisibleInViewport(element) ? visible : deferred).push(element);
  }
  return [...visible, ...deferred];
}
