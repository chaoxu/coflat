/**
 * Phase 3.4 (#12) — AutocompleteSource controller tests.
 *
 * Covers the public surface: `mountEditor` + `AutocompleteSource` +
 * `RequestHandler.openAutocomplete`. Uses jsdom for the mount and fake
 * timers for debounce-driven assertions.
 */

import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  mountEditor,
  type AutocompleteEnv,
  type AutocompleteRequest,
  type AutocompleteResult,
  type AutocompleteSource,
  type MountedEditor,
  type RequestHandler,
  type Suggestion,
} from "../../editor";

/* ────────────────────────────────────────────────────────────────────────────
 * Harness
 * ──────────────────────────────────────────────────────────────────────────── */

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  // Drain any leaked default-picker overlays.
  for (const node of Array.from(
    document.querySelectorAll(".cf-default-autocomplete"),
  )) {
    node.remove();
  }
});

interface Harness {
  editor: MountedEditor;
  parent: HTMLElement;
}

function mount(
  opts: {
    doc?: string;
    sources?: readonly AutocompleteSource[];
    handler?: RequestHandler;
    from?: string;
  } = {},
): Harness {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const editor = mountEditor({
    parent,
    doc: opts.doc ?? "",
    autocompleteSources: opts.sources,
    requestHandler: opts.handler,
    from: opts.from,
  });
  const h = { editor, parent };
  cleanups.push(() => {
    editor.unmount();
    parent.remove();
  });
  return h;
}

function getView(h: Harness): EditorView {
  const dom = h.parent.querySelector(".cm-editor");
  if (!dom) throw new Error("editor DOM not mounted");
  const view = EditorView.findFromDOM(dom as HTMLElement);
  if (!view) throw new Error("could not find EditorView");
  return view;
}

/** Type one character at the caret, simulating user input. */
function typeChar(h: Harness, ch: string): void {
  const view = getView(h);
  const head = view.state.selection.main.head;
  view.dispatch({
    changes: { from: head, to: head, insert: ch },
    selection: { anchor: head + ch.length },
  });
}

function typeString(h: Harness, s: string): void {
  for (const ch of s) typeChar(h, ch);
}

async function flushMicro(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/* ────────────────────────────────────────────────────────────────────────────
 * Tests
 * ──────────────────────────────────────────────────────────────────────────── */

describe("autocompleteSource trigger detection + debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes suggest() with the prefix after the debounce window", async () => {
    const suggest = vi.fn<
      (prefix: string, env: AutocompleteEnv) => Promise<readonly Suggestion[]>
    >(async () => []);
    const source: AutocompleteSource = { trigger: "[@", suggest };
    const h = mount({ sources: [source] });

    typeString(h, "[@kn");
    expect(suggest).not.toHaveBeenCalled();
    vi.advanceTimersByTime(80);
    await flushMicro();
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest.mock.calls[0][0]).toBe("kn");
    const env = suggest.mock.calls[0][1];
    expect(typeof env.cursorPos).toBe("number");
    expect(env.signal).toBeInstanceOf(AbortSignal);
    expect(env.signal.aborted).toBe(false);
  });

  it("honours per-source debounceMs override", async () => {
    const suggest = vi.fn<
      (prefix: string, env: AutocompleteEnv) => Promise<readonly Suggestion[]>
    >(async () => []);
    const source: AutocompleteSource = {
      trigger: "[@",
      debounceMs: 200,
      suggest,
    };
    const h = mount({ sources: [source] });
    typeString(h, "[@a");
    vi.advanceTimersByTime(80);
    expect(suggest).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    await flushMicro();
    expect(suggest).toHaveBeenCalledTimes(1);
  });

  it("debounces rapid typing — only the last suggest fires", async () => {
    const suggest = vi.fn<
      (prefix: string, env: AutocompleteEnv) => Promise<readonly Suggestion[]>
    >(async () => []);
    const source: AutocompleteSource = { trigger: "[@", suggest };
    const h = mount({ sources: [source] });

    typeString(h, "[@k");
    vi.advanceTimersByTime(40);
    typeString(h, "n");
    vi.advanceTimersByTime(40);
    typeString(h, "u");
    vi.advanceTimersByTime(80);
    await flushMicro();

    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest.mock.calls[0][0]).toBe("knu");
  });

  it("aborts previous in-flight suggest when prefix changes", async () => {
    const signals: AbortSignal[] = [];
    const source: AutocompleteSource = {
      trigger: "[@",
      suggest: async (_prefix, env) => {
        signals.push(env.signal);
        return [];
      },
    };
    const h = mount({ sources: [source] });

    typeString(h, "[@kn");
    vi.advanceTimersByTime(80);
    await flushMicro();
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);

    typeString(h, "u");
    // The new keystroke aborts the prior session synchronously
    // (before scheduling the next debounce).
    expect(signals[0].aborted).toBe(true);
    vi.advanceTimersByTime(80);
    await flushMicro();
    expect(signals).toHaveLength(2);
    expect(signals[1].aborted).toBe(false);
  });

  it("whitespace after the trigger cancels the picker", async () => {
    const openAutocomplete = vi.fn<
      (req: AutocompleteRequest) => Promise<AutocompleteResult | null>
    >(async () => null);
    const source: AutocompleteSource = {
      trigger: "[@",
      suggest: async () => [{ id: "x", display: "X", insert: "X" }],
    };
    const h = mount({ sources: [source], handler: { openAutocomplete } });

    typeString(h, "[@kn");
    vi.advanceTimersByTime(80);
    await flushMicro();
    expect(openAutocomplete).toHaveBeenCalledTimes(1);
    const firstSignal = openAutocomplete.mock.calls[0][0].signal;
    expect(firstSignal.aborted).toBe(false);

    typeString(h, " ");
    expect(firstSignal.aborted).toBe(true);
  });

  it("Escape cancels (signal aborts when host-supplied openAutocomplete declines)", async () => {
    const openAutocomplete = vi.fn<
      (req: AutocompleteRequest) => Promise<AutocompleteResult | null>
    >(async () => null);
    const source: AutocompleteSource = {
      trigger: "[@",
      suggest: async () => [{ id: "x", display: "X", insert: "X" }],
    };
    const h = mount({ sources: [source], handler: { openAutocomplete } });

    typeString(h, "[@k");
    vi.advanceTimersByTime(80);
    await flushMicro();
    await flushMicro();
    expect(openAutocomplete).toHaveBeenCalledTimes(1);
    // Host returning null is treated as Escape — no commit, doc unchanged.
    expect(h.editor.getDoc()).toBe("[@k");
  });

  it("selecting a suggestion replaces trigger+prefix with insert", async () => {
    const openAutocomplete = vi.fn<
      (req: AutocompleteRequest) => Promise<AutocompleteResult | null>
    >(async (req) => {
      // Pretend the user picked the first suggestion.
      return { insert: req.suggestions[0].insert };
    });
    const source: AutocompleteSource = {
      trigger: "[@",
      suggest: async () => [
        { id: "knuth", display: "Knuth, D.", insert: "knuth]" },
      ],
    };
    const h = mount({ sources: [source], handler: { openAutocomplete } });

    typeString(h, "[@kn");
    vi.advanceTimersByTime(80);
    await flushMicro();
    await flushMicro();

    expect(h.editor.getDoc()).toBe("knuth]");
  });

  it("host openAutocomplete receives trigger, prefix, sources, suggestions", async () => {
    const openAutocomplete = vi.fn<
      (req: AutocompleteRequest) => Promise<AutocompleteResult | null>
    >(async () => null);
    const source: AutocompleteSource = {
      trigger: "[@",
      suggest: async () => [
        { id: "a", display: "A", insert: "A" },
        { id: "b", display: "B", insert: "B" },
      ],
    };
    const h = mount({ sources: [source], handler: { openAutocomplete } });

    typeString(h, "[@p");
    vi.advanceTimersByTime(80);
    await flushMicro();

    expect(openAutocomplete).toHaveBeenCalledTimes(1);
    const req = openAutocomplete.mock.calls[0][0];
    expect(req.trigger).toBe("[@");
    expect(req.prefix).toBe("p");
    expect(req.sources).toContain(source);
    expect(req.suggestions.map((s) => s.id)).toEqual(["a", "b"]);
    expect(req.signal).toBeInstanceOf(AbortSignal);
  });

  it("merges suggestions from multiple sources sharing the trigger", async () => {
    const openAutocomplete = vi.fn<
      (req: AutocompleteRequest) => Promise<AutocompleteResult | null>
    >(async () => null);
    const a: AutocompleteSource = {
      trigger: "[@",
      suggest: async () => [{ id: "a1", display: "A1", insert: "A1" }],
    };
    const b: AutocompleteSource = {
      trigger: "[@",
      suggest: async () => [{ id: "b1", display: "B1", insert: "B1" }],
    };
    const h = mount({ sources: [a, b], handler: { openAutocomplete } });

    typeString(h, "[@");
    vi.advanceTimersByTime(80);
    await flushMicro();

    const req = openAutocomplete.mock.calls[0][0];
    expect(req.suggestions.map((s) => s.id).sort()).toEqual(["a1", "b1"]);
  });

  it("accepts unknown triggers as open strings (no registration-time rejection)", () => {
    expect(() =>
      mount({
        sources: [
          { trigger: "::weirdo::", suggest: async () => [] },
        ],
      }),
    ).not.toThrow();
  });

  it("env.from is propagated from mountEditor options", async () => {
    const suggest = vi.fn<
      (prefix: string, env: AutocompleteEnv) => Promise<readonly Suggestion[]>
    >(async () => []);
    const source: AutocompleteSource = { trigger: "[@", suggest };
    const h = mount({ sources: [source], from: "notes/x.md" });
    typeString(h, "[@a");
    vi.advanceTimersByTime(80);
    await flushMicro();
    expect(suggest.mock.calls[0][1].from).toBe("notes/x.md");
  });
});

describe("autocompleteSource default chrome", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a vanilla DOM picker when no host openAutocomplete is supplied", async () => {
    const source: AutocompleteSource = {
      trigger: "[@",
      suggest: async () => [
        { id: "x", display: "Xerxes", insert: "xerxes" },
        { id: "y", display: "Ypsilanti", insert: "ypsilanti" },
      ],
    };
    const h = mount({ sources: [source] });

    typeString(h, "[@x");
    vi.advanceTimersByTime(80);
    await flushMicro();
    await flushMicro();

    const overlay = document.querySelector(".cf-default-autocomplete");
    expect(overlay).toBeTruthy();
    const items = overlay!.querySelectorAll(".cf-default-autocomplete__item");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain("Xerxes");
    expect(
      items[0].classList.contains("cf-default-autocomplete__item--selected"),
    ).toBe(true);

    // Switch to real timers so the click event resolves the promise.
    vi.useRealTimers();
    (items[1] as HTMLElement).dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true }),
    );
    await flushMicro();
    await flushMicro();
    expect(h.editor.getDoc()).toBe("ypsilanti");
    expect(document.querySelector(".cf-default-autocomplete")).toBeNull();
  });
});
