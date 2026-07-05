import type { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type BlockWidgetHeightBinding,
  cacheBlockWidgetHeight,
  estimatedBlockWidgetHeight,
  observeBlockWidgetHeight,
} from "./block-widget-height";

describe("cacheBlockWidgetHeight", () => {
  it("bounds the height cache with oldest-first eviction", () => {
    // Height keys embed widget content (+ equation number), so an editing
    // session mints a fresh key per edit/renumber. Without a cap the cache
    // grows unbounded; the cap evicts the oldest entry once it is full.
    const cache = new Map<string, number>();
    for (let i = 0; i < 256; i += 1) {
      cacheBlockWidgetHeight(cache, `k${i}`, i + 1);
    }
    expect(cache.size).toBe(256);

    // Writing a 257th distinct key evicts the oldest (k0), not the newest.
    cacheBlockWidgetHeight(cache, "k256", 999);
    expect(cache.size).toBe(256);
    expect(estimatedBlockWidgetHeight(cache, "k0")).toBe(-1);
    expect(estimatedBlockWidgetHeight(cache, "k255")).toBe(256);
    expect(estimatedBlockWidgetHeight(cache, "k256")).toBe(999);
  });

  it("updates an existing key in place without evicting", () => {
    const cache = new Map<string, number>();
    for (let i = 0; i < 256; i += 1) {
      cacheBlockWidgetHeight(cache, `k${i}`, i + 1);
    }
    // Re-measuring an existing key must not push the cache over the cap or drop
    // another entry — the key already occupies a slot.
    cacheBlockWidgetHeight(cache, "k0", 500);
    expect(cache.size).toBe(256);
    expect(estimatedBlockWidgetHeight(cache, "k0")).toBe(500);
    expect(estimatedBlockWidgetHeight(cache, "k255")).toBe(256);
  });
});

describe("observeBlockWidgetHeight", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stops retrying detached containers after a bounded number of frames", () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("ResizeObserver", undefined);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const binding: BlockWidgetHeightBinding = {
      resizeObserver: null,
      resizeMeasureFrame: null,
      reconnectObserver: null,
      detachedMeasureWarned: false,
    };
    const container = document.createElement("div");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    observeBlockWidgetHeight(
      binding,
      container,
      {} as EditorView,
      new Map(),
      "detached",
    );

    for (let index = 0; index < 16; index += 1) {
      const callback = callbacks.shift();
      if (!callback) break;
      callback(performance.now());
    }

    expect(callbacks).toHaveLength(0);
    expect(binding.resizeMeasureFrame).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(binding.detachedMeasureWarned).toBe(true);
  });

  it("re-arms measurement without warning when a detached container already has cached height", async () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("ResizeObserver", undefined);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const binding: BlockWidgetHeightBinding = {
      resizeObserver: null,
      resizeMeasureFrame: null,
      reconnectObserver: null,
      detachedMeasureWarned: false,
    };
    const container = document.createElement("div");
    const view = {
      dom: document.createElement("div"),
    } as unknown as EditorView;
    const cache = new Map<string, number>([["detached", 24]]);

    observeBlockWidgetHeight(binding, container, view, cache, "detached");

    for (let index = 0; index < 16; index += 1) {
      const callback = callbacks.shift();
      if (!callback) break;
      callback(performance.now());
    }

    expect(warn).not.toHaveBeenCalled();
    expect(binding.reconnectObserver).not.toBeNull();

    document.body.append(container);
    document.documentElement.append(document.createElement("span"));
    await Promise.resolve();

    expect(callbacks).toHaveLength(1);
    callbacks.shift()?.(performance.now());
    expect(binding.reconnectObserver).toBeNull();
  });
});
