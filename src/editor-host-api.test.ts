/**
 * Phase 3.1 (#13) — intent surface tests.
 *
 * Covers:
 *  1. Host `RequestHandler.openLinkPicker` receives the request when supplied.
 *  2. Falls through to library default chrome when no host handler is set.
 *  3. AbortSignal cancellation propagates (resolves with `null`).
 *  4. `StatusEvents` callbacks fire when emitted via the helper.
 *  5. Default chrome renders a `.cf-default-picker` overlay.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emitStatusEvent,
  resolveOpenLinkPicker,
  requestHandlerFacet,
  statusEventsFacet,
  type LinkPickerRequest,
  type RequestHandler,
  type StatusEvents,
} from "./editor-host-api";

function makeView(opts: { handler?: RequestHandler; events?: StatusEvents } = {}): {
  view: EditorView;
  cleanup: () => void;
} {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const extensions = [
    ...(opts.handler ? [requestHandlerFacet.of(opts.handler)] : []),
    ...(opts.events ? [statusEventsFacet.of(opts.events)] : []),
  ];
  const view = new EditorView({
    state: EditorState.create({ doc: "hello", extensions }),
    parent,
  });
  return {
    view,
    cleanup: () => {
      view.destroy();
      parent.remove();
    },
  };
}

function makeRequest(signal: AbortSignal): LinkPickerRequest {
  return {
    trigger: "[](",
    prefix: "",
    cursorPos: 0,
    signal,
    sources: [],
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  // Drain any leaked default-picker overlays so tests don't interfere.
  for (const node of Array.from(document.querySelectorAll(".cf-default-picker"))) {
    node.remove();
  }
});

describe("RequestHandler facet", () => {
  it("invokes host openLinkPicker when supplied", async () => {
    const openLinkPicker = vi
      .fn()
      .mockResolvedValue({ insert: "https://example.com" });
    const { view, cleanup } = makeView({ handler: { openLinkPicker } });
    cleanups.push(cleanup);

    const controller = new AbortController();
    const result = await resolveOpenLinkPicker(view, makeRequest(controller.signal));

    expect(openLinkPicker).toHaveBeenCalledTimes(1);
    expect(openLinkPicker.mock.calls[0][0]).toMatchObject({
      trigger: "[](",
      prefix: "",
      cursorPos: 0,
      sources: [],
    });
    expect(result).toEqual({ insert: "https://example.com" });
  });

  it("falls through to default chrome when no host handler is set", async () => {
    const { view, cleanup } = makeView();
    cleanups.push(cleanup);

    const controller = new AbortController();
    const pending = resolveOpenLinkPicker(view, makeRequest(controller.signal));

    // Default chrome is loaded via dynamic import; flush microtasks.
    await flushMicrotasks();
    const overlay = document.querySelector(".cf-default-picker");
    expect(overlay).toBeTruthy();
    const input = overlay!.querySelector("input.cf-default-picker__input") as
      | HTMLInputElement
      | null;
    expect(input).toBeTruthy();

    // Type and press Enter to resolve.
    input!.value = "https://typed.example/";
    input!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    const result = await pending;
    expect(result).toEqual({ insert: "https://typed.example/" });
    expect(document.querySelector(".cf-default-picker")).toBeNull();
  });

  it("propagates AbortSignal cancellation through the default chrome", async () => {
    const { view, cleanup } = makeView();
    cleanups.push(cleanup);

    const controller = new AbortController();
    const pending = resolveOpenLinkPicker(view, makeRequest(controller.signal));
    await flushMicrotasks();
    expect(document.querySelector(".cf-default-picker")).toBeTruthy();

    controller.abort();
    const result = await pending;
    expect(result).toBeNull();
    expect(document.querySelector(".cf-default-picker")).toBeNull();
  });

  it("default chrome resolves null when the signal is already aborted", async () => {
    const { view, cleanup } = makeView();
    cleanups.push(cleanup);

    const controller = new AbortController();
    controller.abort();
    const result = await resolveOpenLinkPicker(
      view,
      makeRequest(controller.signal),
    );
    expect(result).toBeNull();
  });
});

describe("StatusEvents facet", () => {
  it("fans out events through emitStatusEvent", () => {
    const onSaveStart = vi.fn();
    const onSaveSucceeded = vi.fn();
    const onDirtyChange = vi.fn();
    const { view, cleanup } = makeView({
      events: { onSaveStart, onSaveSucceeded, onDirtyChange },
    });
    cleanups.push(cleanup);

    emitStatusEvent(view, "onSaveStart");
    emitStatusEvent(view, "onSaveSucceeded");
    emitStatusEvent(view, "onDirtyChange", true);

    expect(onSaveStart).toHaveBeenCalledTimes(1);
    expect(onSaveSucceeded).toHaveBeenCalledTimes(1);
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  it("is a no-op when the host did not supply a callback", () => {
    const { view, cleanup } = makeView({ events: {} });
    cleanups.push(cleanup);
    // Should not throw.
    expect(() => emitStatusEvent(view, "onSaveStart")).not.toThrow();
  });
});
