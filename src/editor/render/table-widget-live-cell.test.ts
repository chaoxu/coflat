import { history, undo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createMarkdownLanguageExtensions } from "../base-editor-extensions";
import {
  createTestView,
  destroyAllTestViews,
} from "../test-utils";
import { tableRenderPlugin } from "./table-render";
import {
  createLiveCellWindowExtensions,
  getLiveCellRange,
  type LiveCellRange,
} from "./table-widget-live-cell";
import {
  type ActiveInlineEditor,
  destroyActiveInlineEditor,
  getActiveInlineEditor,
} from "./table-widget-session";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  destroyActiveInlineEditor();
  destroyAllTestViews();
});

const TABLE_DOC = [
  "Intro paragraph.",
  "",
  "| A | B |",
  "| --- | --- |",
  "| one | two |",
].join("\n");

function createRootView(doc = TABLE_DOC): EditorView {
  return createTestView(doc, {
    cursorPos: 0,
    focus: false,
    extensions: [
      ...createMarkdownLanguageExtensions(),
      history(),
      tableRenderPlugin,
    ],
  });
}

async function waitForBodyCell(view: EditorView): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const cell = view.dom.querySelector<HTMLElement>("tbody td");
    if (cell) return cell;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("table widget cells never rendered");
}

interface OpenLiveCell {
  readonly active: ActiveInlineEditor;
  readonly subview: EditorView;
  readonly cell: HTMLElement;
  readonly range: LiveCellRange;
}

async function openFirstBodyCell(view: EditorView): Promise<OpenLiveCell> {
  const cell = await waitForBodyCell(view);
  cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  const active = getActiveInlineEditor();
  if (!active) throw new Error("expected an active inline editor");
  const range = active.getCellRange?.() ?? null;
  if (!range) throw new Error("expected a live cell range");
  return { active, subview: active.view, cell, range };
}

function currentRange(active: ActiveInlineEditor): LiveCellRange {
  const range = active.getCellRange?.() ?? null;
  if (!range) throw new Error("expected a live cell range");
  return range;
}

describe("table widget live cell window", () => {
  it("mirrors the root document and forwards subview edits as granular root steps", async () => {
    const view = createRootView();
    const { active, subview, range } = await openFirstBodyCell(view);

    expect(active.rootView).toBe(view);
    expect(subview.state.doc.toString()).toBe(view.state.doc.toString());
    expect(view.state.sliceDoc(range.from, range.to)).toBe("one");

    subview.dispatch({
      changes: { from: range.to, insert: "X" },
      selection: { anchor: range.to + 1 },
      userEvent: "input.type",
    });

    expect(view.state.doc.toString()).toContain("| oneX | two |");
    expect(subview.state.doc.toString()).toBe(view.state.doc.toString());
    // The session survives its own live edits and the widget-update path
    // leaves the active cell's DOM alone.
    expect(getActiveInlineEditor()).toBe(active);
    expect(view.dom.querySelector("tbody td")).toBe(active.cell);
    expect(active.cell.contains(subview.dom)).toBe(true);
  });

  it("moves to the next cell on Tab, keeping the live edits in the document", async () => {
    const view = createRootView();
    const { active, subview, range } = await openFirstBodyCell(view);

    subview.dispatch({
      changes: { from: range.to, insert: "X" },
      selection: { anchor: range.to + 1 },
      userEvent: "input.type",
    });

    subview.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    }));

    const next = getActiveInlineEditor();
    expect(next).not.toBeNull();
    expect(next).not.toBe(active);
    // The new session is a live window over the second body cell.
    const nextRange = next?.getCellRange?.() ?? null;
    expect(nextRange).not.toBeNull();
    if (!next || !nextRange) throw new Error("expected next live session");
    expect(next.view.state.sliceDoc(nextRange.from, nextRange.to)).toBe("two");
    // The previous cell's edits stayed in the document and its preview reflects them.
    expect(view.state.doc.toString()).toContain("| oneX | two |");
    expect(active.cell.textContent).toContain("oneX");
  });

  it("reverts one root-history step on undo, not the whole session", async () => {
    const view = createRootView();
    const { active, subview, range } = await openFirstBodyCell(view);

    subview.dispatch({
      changes: { from: range.to, insert: "X" },
      selection: { anchor: range.to + 1 },
      userEvent: "input.type",
    });
    // Second, non-adjacent edit so root history keeps two separate steps.
    const afterFirst = currentRange(active);
    subview.dispatch({
      changes: { from: afterFirst.from, insert: "Z" },
      selection: { anchor: afterFirst.from + 1 },
      userEvent: "input.type",
    });

    expect(view.state.doc.toString()).toContain("| ZoneX | two |");

    expect(undo(view)).toBe(true);

    // Only the second step reverted; the first edit is still present.
    expect(view.state.doc.toString()).toContain("| oneX | two |");
    // The session survived and the subview mirror stayed in sync.
    expect(getActiveInlineEditor()).toBe(active);
    expect(active.cell.isConnected).toBe(true);
    expect(active.cell.classList.contains("cf-table-cell-editing")).toBe(true);
    expect(subview.state.doc.toString()).toBe(view.state.doc.toString());
  });

  it("routes Mod-z in the subview to root undo", async () => {
    const view = createRootView();
    const { subview, range } = await openFirstBodyCell(view);

    subview.dispatch({
      changes: { from: range.to, insert: "X" },
      selection: { anchor: range.to + 1 },
      userEvent: "input.type",
    });
    expect(view.state.doc.toString()).toContain("| oneX | two |");

    const event = new KeyboardEvent("keydown", {
      key: "z",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    subview.contentDOM.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toContain("| one | two |");
    expect(subview.state.doc.toString()).toBe(view.state.doc.toString());
  });

  it("flows external root edits into the open cell without ending the session", async () => {
    const view = createRootView();
    const { active, subview, range } = await openFirstBodyCell(view);

    view.dispatch({ changes: { from: 0, insert: "# " } });

    expect(getActiveInlineEditor()).toBe(active);
    expect(subview.state.doc.toString()).toBe(view.state.doc.toString());
    const shifted = currentRange(active);
    expect(shifted.from).toBe(range.from + 2);
    expect(shifted.to).toBe(range.to + 2);

    // Typing still lands inside the (moved) cell and syncs to the root.
    subview.dispatch({
      changes: { from: shifted.to, insert: "!" },
      selection: { anchor: shifted.to + 1 },
      userEvent: "input.type",
    });
    expect(view.state.doc.toString()).toContain("| one! | two |");
  });

  it("keeps typed leading and trailing whitespace inside the clamp bounds", async () => {
    const view = createRootView();
    const { active, subview, range } = await openFirstBodyCell(view);

    subview.dispatch({ changes: { from: range.from, insert: " " }, userEvent: "input.type" });
    let mapped = currentRange(active);
    expect(mapped.from).toBe(range.from);
    expect(mapped.to).toBe(range.to + 1);
    expect(subview.state.sliceDoc(mapped.from, mapped.to)).toBe(" one");

    // Typing after the leading space is still "inside the cell".
    subview.dispatch({ changes: { from: mapped.from, insert: "w" }, userEvent: "input.type" });
    mapped = currentRange(active);
    expect(subview.state.sliceDoc(mapped.from, mapped.to)).toBe("w one");

    // Trailing whitespace behaves the same at the other edge.
    subview.dispatch({ changes: { from: mapped.to, insert: " " }, userEvent: "input.type" });
    subview.dispatch({ changes: { from: currentRange(active).to, insert: "s" }, userEvent: "input.type" });
    mapped = currentRange(active);
    expect(subview.state.sliceDoc(mapped.from, mapped.to)).toBe("w one s");
    expect(view.state.sliceDoc(mapped.from, mapped.to)).toBe("w one s");
  });

  it("drops subview changes outside the cell and clamps selection to the cell", async () => {
    const view = createRootView();
    const { subview, range } = await openFirstBodyCell(view);
    const before = view.state.doc.toString();

    subview.dispatch({ changes: { from: 0, to: 5, insert: "zzz" } });
    expect(subview.state.doc.toString()).toBe(before);
    expect(view.state.doc.toString()).toBe(before);

    subview.dispatch({ selection: { anchor: 0 } });
    expect(subview.state.selection.main.head).toBe(range.from);

    subview.dispatch({ selection: { anchor: subview.state.doc.length } });
    expect(subview.state.selection.main.head).toBe(range.to);
  });

  it("flattens inserted newlines so the table row stays intact", async () => {
    const view = createRootView();
    const { subview, range } = await openFirstBodyCell(view);
    const lineCountBefore = view.state.doc.lines;

    subview.dispatch({
      changes: { from: range.to, insert: "\nnext" },
      userEvent: "input.paste",
    });

    expect(view.state.doc.lines).toBe(lineCountBefore);
    expect(view.state.doc.toString()).toContain("| one next | two |");
  });

  it("ends the session cleanly when the table is deleted from the root", async () => {
    const view = createRootView();
    await openFirstBodyCell(view);

    const tableFrom = view.state.doc.toString().indexOf("| A |");
    view.dispatch({
      changes: { from: tableFrom, to: view.state.doc.length, insert: "" },
    });

    expect(getActiveInlineEditor()).toBeNull();
  });

  it("leaves the cell without rewriting the document (commit boundary removed)", async () => {
    const view = createRootView();
    const { subview, range } = await openFirstBodyCell(view);

    subview.dispatch({
      changes: { from: range.to, insert: "X" },
      selection: { anchor: range.to + 1 },
      userEvent: "input.type",
    });
    const docAfterTyping = view.state.doc.toString();

    subview.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }));

    expect(getActiveInlineEditor()).toBeNull();
    // Leaving the cell no longer rewrites the table text.
    expect(view.state.doc.toString()).toBe(docAfterTyping);

    // The widget rebuilt with a fresh preview of the live content.
    const refreshedCell = view.dom.querySelector<HTMLElement>("tbody td");
    expect(refreshedCell?.textContent).toContain("oneX");
    expect(refreshedCell?.classList.contains("cf-table-cell-editing")).toBe(false);
  });
});

describe("live cell boundaries filter (state level)", () => {
  const DOC = "| A |\n| --- |\n| one |";
  const cellFrom = DOC.indexOf("one");
  const cellTo = cellFrom + "one".length;

  function createWindowState(): EditorState {
    return EditorState.create({
      doc: DOC,
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        createLiveCellWindowExtensions({ from: cellFrom, to: cellTo }),
      ],
    });
  }

  it("clamps every selection range to the cell, not just the main one", () => {
    const state = createWindowState();
    const next = state.update({
      selection: EditorSelection.create([
        EditorSelection.range(0, 2),
        EditorSelection.range(cellFrom + 1, DOC.length),
      ], 1),
    }).state;

    const [first, second] = next.selection.ranges;
    expect(first.from).toBe(cellFrom);
    expect(first.to).toBe(cellFrom);
    expect(second.from).toBe(cellFrom + 1);
    expect(second.to).toBe(cellTo);
    expect(next.selection.mainIndex).toBe(1);
  });

  it("rejects transactions that delete a cell boundary", () => {
    const state = createWindowState();
    const next = state.update({
      changes: { from: cellFrom - 2, to: cellTo + 2, insert: "" },
    }).state;

    expect(next.doc.toString()).toBe(DOC);
  });

  it("tracks the mapped cell range through in-cell edits", () => {
    const state = createWindowState();
    const view = { state } as { state: EditorState };
    expect(getLiveCellRange(view as never)).toEqual({ from: cellFrom, to: cellTo });

    const next = state.update({
      changes: { from: cellFrom, insert: "  " },
    }).state;
    expect(getLiveCellRange({ state: next } as never)).toEqual({
      from: cellFrom,
      to: cellTo + 2,
    });
  });
});
