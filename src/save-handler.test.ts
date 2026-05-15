/**
 * Phase 3.2 (#10) — SaveHandler integration tests.
 *
 * Exercises the public surface (`mountEditor` + `SaveHandler` +
 * `StatusEvents`) — these are the seams hosts depend on, so we test
 * through the same door cosheaf will use.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mountEditor, type MountedEditor } from "../editor";
import type { SaveHandler, StatusEvents } from "./editor-host-api";

interface Harness {
  editor: MountedEditor;
  events: Required<{
    onSaveStart: ReturnType<typeof vi.fn>;
    onSaveSucceeded: ReturnType<typeof vi.fn>;
    onSaveFailed: ReturnType<typeof vi.fn>;
    onDirtyChange: ReturnType<typeof vi.fn>;
  }>;
  saveHandler: ReturnType<typeof vi.fn>;
  isBusy: ReturnType<typeof vi.fn>;
  parent: HTMLElement;
  callOrder: string[];
}

function typeAt(editor: MountedEditor, text: string): void {
  // mountEditor doesn't expose dispatch; setDoc replaces the doc which
  // is enough to drive update listeners. setDoc uses a programmatic
  // annotation so the host onChange wouldn't fire, but our save
  // extension watches `docChanged` directly — that's what we want.
  editor.setDoc(text);
}

function makeHarness(opts: { autosaveDebounceMs?: number } = {}): Harness {
  const parent = document.createElement("div");
  document.body.appendChild(parent);

  const callOrder: string[] = [];
  const events = {
    onSaveStart: vi.fn(() => {
      callOrder.push("start");
    }),
    onSaveSucceeded: vi.fn(() => {
      callOrder.push("succeeded");
    }),
    onSaveFailed: vi.fn(() => {
      callOrder.push("failed");
    }),
    onDirtyChange: vi.fn((dirty: boolean) => {
      callOrder.push(`dirty:${dirty}`);
    }),
  };
  const saveHandler = vi.fn(
    async (_payload: {
      source: string;
      reason: "manual" | "command" | "autosave";
    }) => ({ ok: true as const }),
  );
  const isBusy = vi.fn(() => false);

  const handler: SaveHandler = {
    save: saveHandler,
    autosaveDebounceMs: opts.autosaveDebounceMs,
    isBusy,
  };

  const editor = mountEditor({
    parent,
    doc: "hello",
    saveHandler: handler,
    statusEvents: events as StatusEvents,
  });

  return { editor, events, saveHandler, isBusy, parent, callOrder };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

describe("SaveHandler dirty tracking", () => {
  it("fires onDirtyChange(true) exactly once across multiple changes", () => {
    const h = makeHarness();
    cleanups.push(() => {
      h.editor.unmount();
      h.parent.remove();
    });

    typeAt(h.editor, "hello world");
    typeAt(h.editor, "hello world!");
    typeAt(h.editor, "hello world!!");

    const dirtyTrue = h.events.onDirtyChange.mock.calls.filter(
      (c) => c[0] === true,
    );
    expect(dirtyTrue.length).toBe(1);
    expect(h.editor.isSaved()).toBe(false);
  });

  it("reverting to last-saved source flips dirty back to false", () => {
    const h = makeHarness();
    cleanups.push(() => {
      h.editor.unmount();
      h.parent.remove();
    });

    typeAt(h.editor, "hello world");
    expect(h.events.onDirtyChange).toHaveBeenLastCalledWith(true);
    typeAt(h.editor, "hello"); // back to original
    expect(h.events.onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(h.editor.isSaved()).toBe(true);
  });
});

describe("SaveHandler triggerSave", () => {
  it("dispatches manual save and emits start/succeeded + dirty=false in order", async () => {
    const h = makeHarness();
    cleanups.push(() => {
      h.editor.unmount();
      h.parent.remove();
    });

    typeAt(h.editor, "hello world");
    expect(h.editor.isSaved()).toBe(false);

    await h.editor.triggerSave("manual");

    expect(h.saveHandler).toHaveBeenCalledTimes(1);
    expect(h.saveHandler).toHaveBeenCalledWith({
      source: "hello world",
      reason: "manual",
    });
    expect(h.events.onSaveStart).toHaveBeenCalledTimes(1);
    expect(h.events.onSaveSucceeded).toHaveBeenCalledTimes(1);
    expect(h.editor.isSaved()).toBe(true);
    // Order matches spec: dirty:true (from typing) → start → dirty:false
    // (snapshot + setDirty) → succeeded.
    expect(h.callOrder).toEqual([
      "dirty:true",
      "start",
      "dirty:false",
      "succeeded",
    ]);
  });

  it("save returning { ok:false } fires onSaveFailed and leaves dirty", async () => {
    const h = makeHarness();
    cleanups.push(() => {
      h.editor.unmount();
      h.parent.remove();
    });
    h.saveHandler.mockResolvedValueOnce({ ok: false, error: "boom" });

    typeAt(h.editor, "hello world");
    await h.editor.triggerSave("manual");

    expect(h.events.onSaveFailed).toHaveBeenCalledWith({ error: "boom" });
    expect(h.events.onSaveSucceeded).not.toHaveBeenCalled();
    expect(h.editor.isSaved()).toBe(false);
  });

  it("save throwing fires onSaveFailed with the error message", async () => {
    const h = makeHarness();
    cleanups.push(() => {
      h.editor.unmount();
      h.parent.remove();
    });
    h.saveHandler.mockRejectedValueOnce(new Error("network down"));

    typeAt(h.editor, "hello world");
    await h.editor.triggerSave("manual");

    expect(h.events.onSaveFailed).toHaveBeenCalledTimes(1);
    const arg = h.events.onSaveFailed.mock.calls[0][0];
    expect(arg.error).toContain("network down");
    expect(h.editor.isSaved()).toBe(false);
  });
});

describe("SaveHandler autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires save({ reason: 'autosave' }) after the debounce window", async () => {
    const h = makeHarness({ autosaveDebounceMs: 1000 });
    cleanups.push(() => {
      h.editor.unmount();
      h.parent.remove();
    });

    typeAt(h.editor, "hello world");
    expect(h.saveHandler).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    // The save itself is async; let pending microtasks settle.
    await vi.runAllTimersAsync();

    expect(h.saveHandler).toHaveBeenCalledTimes(1);
    expect(h.saveHandler.mock.calls[0][0]).toEqual({
      source: "hello world",
      reason: "autosave",
    });
  });

  it("suppresses autosave when isBusy() returns true", async () => {
    const h = makeHarness({ autosaveDebounceMs: 500 });
    cleanups.push(() => {
      h.editor.unmount();
      h.parent.remove();
    });
    h.isBusy.mockReturnValue(true);

    typeAt(h.editor, "hello world");
    await vi.advanceTimersByTimeAsync(500);
    await vi.runAllTimersAsync();

    expect(h.saveHandler).not.toHaveBeenCalled();
    // isBusy is consulted at fire time, not polled — exactly one call.
    expect(h.isBusy).toHaveBeenCalledTimes(1);
  });

  it("multiple rapid changes coalesce into a single autosave", async () => {
    const h = makeHarness({ autosaveDebounceMs: 800 });
    cleanups.push(() => {
      h.editor.unmount();
      h.parent.remove();
    });

    typeAt(h.editor, "hello a");
    await vi.advanceTimersByTimeAsync(200);
    typeAt(h.editor, "hello ab");
    await vi.advanceTimersByTimeAsync(200);
    typeAt(h.editor, "hello abc");
    await vi.advanceTimersByTimeAsync(800);
    await vi.runAllTimersAsync();

    expect(h.saveHandler).toHaveBeenCalledTimes(1);
    expect(h.saveHandler.mock.calls[0][0]).toEqual({
      source: "hello abc",
      reason: "autosave",
    });
  });
});

describe("SaveHandler Ctrl-S keybinding", () => {
  it("Mod-s dispatches a manual save", async () => {
    const h = makeHarness();
    cleanups.push(() => {
      h.editor.unmount();
      h.parent.remove();
    });

    typeAt(h.editor, "hello world");

    // The keymap is registered on the editor's content DOM.
    const content = h.parent.querySelector(".cm-content") as HTMLElement;
    expect(content).toBeTruthy();
    content.focus();
    content.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Save is async; wait for the microtask chain to settle.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(h.saveHandler).toHaveBeenCalledTimes(1);
    expect(h.saveHandler.mock.calls[0][0].reason).toBe("manual");
  });
});
