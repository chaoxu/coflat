import { EditorState, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  _getFormattingTooltipsForTest as getFormattingTooltips,
  formattingToolbarCommands,
  formattingToolbarExtension,
} from "./formatting-toolbar";
import { createTestView, destroyAllTestViews } from "./test-utils";

afterEach(() => {
  destroyAllTestViews();
});

/** Create a view with the toolbar extension and the given selection. */
function makeView(
  doc: string,
  anchor: number,
  head?: number,
  extraExtensions: Extension = [],
): EditorView {
  const view = createTestView(doc, {
    extensions: [formattingToolbarExtension, extraExtensions],
  });
  view.dispatch({ selection: { anchor, head } });
  return view;
}

function queryToolbar(view: EditorView): HTMLElement | null {
  return view.dom.querySelector<HTMLElement>(".cf-formatting-toolbar");
}

function queryButton(view: EditorView, command: string): HTMLButtonElement {
  const btn = view.dom.querySelector<HTMLButtonElement>(
    `.cf-formatting-toolbar-button[data-command="${command}"]`,
  );
  if (!btn) throw new Error(`toolbar button "${command}" not found`);
  return btn;
}

function pressButton(view: EditorView, command: string): MouseEvent {
  const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  queryButton(view, command).dispatchEvent(event);
  return event;
}

describe("formatting toolbar visibility", () => {
  it("shows the toolbar when the main selection is non-empty", () => {
    const view = makeView("hello world", 0, 5);
    const toolbar = queryToolbar(view);
    expect(toolbar).not.toBeNull();
    expect(toolbar?.getAttribute("role")).toBe("toolbar");
  });

  it("renders all six buttons with aria-labels", () => {
    const view = makeView("hello world", 0, 5);
    const labels = [...view.dom.querySelectorAll(".cf-formatting-toolbar-button")]
      .map((btn) => btn.getAttribute("aria-label"));
    expect(labels).toEqual([
      "Bold",
      "Italic",
      "Inline code",
      "Strikethrough",
      "Highlight",
      "Link",
    ]);
  });

  it("does not show the toolbar for an empty selection", () => {
    const view = makeView("hello world", 5);
    expect(queryToolbar(view)).toBeNull();
  });

  it("disappears when the selection collapses", () => {
    const view = makeView("hello world", 0, 5);
    expect(queryToolbar(view)).not.toBeNull();
    view.dispatch({ selection: { anchor: 3 } });
    expect(queryToolbar(view)).toBeNull();
  });

  it("stays hidden when the editor is read-only", () => {
    const view = makeView("hello world", 0, 5, EditorState.readOnly.of(true));
    expect(queryToolbar(view)).toBeNull();
  });
});

describe("tooltip geometry (pure)", () => {
  function tooltipsFor(anchor: number, head: number) {
    const state = EditorState.create({
      doc: "hello world",
      selection: { anchor, head },
    });
    return getFormattingTooltips(state);
  }

  it("anchors at the selection head, below, when selecting downward", () => {
    const tooltips = tooltipsFor(0, 5);
    expect(tooltips).toHaveLength(1);
    expect(tooltips[0].pos).toBe(5);
    expect(tooltips[0].above).toBe(false);
  });

  it("anchors at the selection head, above, when selecting upward", () => {
    const tooltips = tooltipsFor(5, 0);
    expect(tooltips).toHaveLength(1);
    expect(tooltips[0].pos).toBe(0);
    expect(tooltips[0].above).toBe(true);
  });

  it("returns no tooltip for an empty selection", () => {
    expect(tooltipsFor(5, 5)).toHaveLength(0);
  });

  it("returns no tooltip when read-only", () => {
    const state = EditorState.create({
      doc: "hello world",
      selection: { anchor: 0, head: 5 },
      extensions: EditorState.readOnly.of(true),
    });
    expect(getFormattingTooltips(state)).toHaveLength(0);
  });
});

describe("button dispatch (mousedown)", () => {
  it("bold button wraps the selection and prevents default", () => {
    const view = makeView("hello world", 0, 5);
    const event = pressButton(view, "bold");
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("**hello** world");
    // The wrapped text stays selected so the toolbar remains usable.
    expect(view.state.selection.main.from).toBe(2);
    expect(view.state.selection.main.to).toBe(7);
    expect(queryToolbar(view)).not.toBeNull();
  });

  it.each([
    ["italic", "*hello* world"],
    ["code", "`hello` world"],
    ["strikethrough", "~~hello~~ world"],
    ["highlight", "==hello== world"],
  ])("%s button applies its marker", (command, expected) => {
    const view = makeView("hello world", 0, 5);
    pressButton(view, command);
    expect(view.state.doc.toString()).toBe(expected);
  });

  it("link button wraps the selection as a markdown link", () => {
    const view = makeView("hello world", 0, 5);
    pressButton(view, "link");
    expect(view.state.doc.toString()).toBe("[hello](url) world");
  });

  it("toggles formatting off on a second press", () => {
    const view = makeView("hello world", 0, 5);
    pressButton(view, "bold");
    expect(view.state.doc.toString()).toBe("**hello** world");
    pressButton(view, "bold");
    expect(view.state.doc.toString()).toBe("hello world");
  });
});

describe("registry commands", () => {
  it("exposes one command per button with format-* ids", () => {
    const ids = formattingToolbarCommands.map((command) => command.id);
    expect(ids).toEqual([
      "format-bold",
      "format-italic",
      "format-inline-code",
      "format-strikethrough",
      "format-highlight",
      "format-link",
    ]);
  });

  it("commands run the same formatting actions", () => {
    const view = makeView("hello world", 0, 5);
    const bold = formattingToolbarCommands.find((c) => c.id === "format-bold");
    expect(bold?.run({ view, surface: "api" })).toBe(true);
    expect(view.state.doc.toString()).toBe("**hello** world");
  });
});
