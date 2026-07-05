import type { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  _widgetSearchHighlightTargetsForTest,
  registerWidgetSearchHighlightTarget,
} from "./source-widget";

// The sweep fires once every N registrations; keep this in sync with
// WIDGET_HIGHLIGHT_TARGET_SWEEP_THRESHOLD in source-widget.ts.
const SWEEP_THRESHOLD = 256;

function makeView(): EditorView {
  const dom = document.createElement("div");
  document.body.append(dom);
  return { dom } as unknown as EditorView;
}

const flushMicrotasks = () => Promise.resolve();

describe("registerWidgetSearchHighlightTarget sweep", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does not prune same-burst widgets that attach before the deferred sweep runs", async () => {
    // Reproduces the register-time-sweep regression: during a CM6 build every
    // new widget's toDOM has run but its element is still detached. If the sweep
    // ran inline it would delete these not-yet-attached siblings. Deferring it
    // to a microtask lets the burst attach them first, so all survive.
    const view = makeView();
    const els: HTMLElement[] = [];
    for (let i = 0; i < SWEEP_THRESHOLD; i += 1) {
      const el = document.createElement("span");
      els.push(el);
      // Register while still DETACHED — mid-build state.
      registerWidgetSearchHighlightTarget(view, el);
    }
    // The burst finishes: CM6 attaches every element to the view DOM.
    for (const el of els) view.dom.append(el);

    await flushMicrotasks();

    const targets = _widgetSearchHighlightTargetsForTest(view);
    expect(targets?.size).toBe(SWEEP_THRESHOLD);
    for (const el of els) expect(targets?.has(el)).toBe(true);
  });

  it("sweeps genuinely disconnected entries while keeping connected ones bounded", async () => {
    const view = makeView();
    const connected: HTMLElement[] = [];
    // Register a full threshold of connected widgets to trigger a sweep, plus
    // some that stay detached (a stale leak the sweep must reclaim).
    for (let i = 0; i < SWEEP_THRESHOLD; i += 1) {
      const el = document.createElement("span");
      view.dom.append(el);
      connected.push(el);
      registerWidgetSearchHighlightTarget(view, el);
    }
    const orphan = document.createElement("span"); // never attached
    registerWidgetSearchHighlightTarget(view, orphan);

    await flushMicrotasks();

    const targets = _widgetSearchHighlightTargetsForTest(view);
    // The orphan is gone; every connected widget is retained.
    expect(targets?.has(orphan)).toBe(false);
    for (const el of connected) expect(targets?.has(el)).toBe(true);
  });
});
