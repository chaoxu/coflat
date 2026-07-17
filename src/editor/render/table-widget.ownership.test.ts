import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { history } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMarkdownLanguageExtensions } from "../base-editor-extensions";
import type {
  InlineEditorController,
  InlineEditorOptions,
} from "../inline-editor";
import {
  createMockEditorView,
  createTestView,
  destroyAllTestViews,
} from "../test-utils";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const createInlineEditorControllerMock = vi.fn<
  (options: InlineEditorOptions) => InlineEditorController
>();

vi.mock("../inline-editor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../inline-editor")>();
  return {
    ...actual,
    createInlineEditorController: (options: InlineEditorOptions) =>
      createInlineEditorControllerMock(options),
  };
});

const actualInlineEditor =
  await vi.importActual<typeof import("../inline-editor")>("../inline-editor");
const { tableRenderPlugin } = await import("./table-render");
const { destroyActiveInlineEditor, getActiveInlineEditor } =
  await import("./table-widget-session");

function readRenderSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

const TWO_TABLE_DOC = [
  "| A |",
  "| --- |",
  "| one |",
  "",
  "Between tables.",
  "",
  "| B |",
  "| --- |",
  "| two |",
].join("\n");

function createRootView(doc: string): EditorView {
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

async function waitForBodyCells(
  view: EditorView,
  count: number,
): Promise<HTMLElement[]> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const cells = Array.from(view.dom.querySelectorAll<HTMLElement>("tbody td"));
    if (cells.length >= count) return cells;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("table widget cells never rendered");
}

function mousedown(): MouseEvent {
  return new MouseEvent("mousedown", { bubbles: true, cancelable: true });
}

describe("TableWidget cross-widget editor ownership", () => {
  beforeEach(() => {
    createInlineEditorControllerMock.mockReset();
    createInlineEditorControllerMock.mockImplementation(
      actualInlineEditor.createInlineEditorController,
    );
  });

  afterEach(() => {
    destroyActiveInlineEditor();
    destroyAllTestViews();
  });

  it("creates editors on demand and refreshes the owning widget when switching tables", async () => {
    const view = createRootView(TWO_TABLE_DOC);
    const [cellA, cellB] = await waitForBodyCells(view, 2);

    expect(createInlineEditorControllerMock).toHaveBeenCalledTimes(0);

    cellA.dispatchEvent(mousedown());
    const first = getActiveInlineEditor();
    expect(first).not.toBeNull();
    if (!first) throw new Error("expected a live session in table A");
    expect(first.cell).toBe(cellA);

    const range = first.getCellRange();
    if (!range) throw new Error("expected a live cell range");
    first.view.dispatch({
      changes: { from: range.to, insert: "X" },
      selection: { anchor: range.to + 1 },
      userEvent: "input.type",
    });

    cellB.dispatchEvent(mousedown());
    const second = getActiveInlineEditor();
    expect(second).not.toBeNull();
    if (!second) throw new Error("expected a live session in table B");
    expect(second).not.toBe(first);
    expect(second.cell.isConnected).toBe(true);
    const secondRange = second.getCellRange();
    if (!secondRange) throw new Error("expected a live cell range in table B");
    expect(second.view.state.sliceDoc(secondRange.from, secondRange.to)).toBe("two");

    expect(createInlineEditorControllerMock).toHaveBeenCalledTimes(2);

    // Table A's live edits stayed in the document and the owning widget
    // refreshed its rendered preview when the session moved away.
    expect(view.state.doc.toString()).toContain("| oneX |");
    const refreshedA = view.dom.querySelectorAll<HTMLElement>("tbody td")[0];
    expect(refreshedA?.textContent).toContain("oneX");
    expect(refreshedA?.classList.contains("cf-table-cell-editing")).toBe(false);
  });

  it("ends the active session when its widget is torn down, leaving other tables usable", async () => {
    const view = createRootView(TWO_TABLE_DOC);
    const [cellA] = await waitForBodyCells(view, 2);

    cellA.dispatchEvent(mousedown());
    expect(getActiveInlineEditor()).not.toBeNull();

    // Delete table A from the root; its widget (and the session it owns)
    // must be destroyed with it.
    const tableAEnd = view.state.doc.toString().indexOf("\n\nBetween");
    view.dispatch({ changes: { from: 0, to: tableAEnd, insert: "" } });

    expect(getActiveInlineEditor()).toBeNull();

    // Table B is unaffected and can still host a live session.
    const remainingCells = await waitForBodyCells(view, 1);
    const cellB = remainingCells[remainingCells.length - 1];
    cellB.dispatchEvent(mousedown());
    const second = getActiveInlineEditor();
    expect(second).not.toBeNull();
    const secondRange = second?.getCellRange() ?? null;
    if (!second || !secondRange) throw new Error("expected a live session in table B");
    expect(second.view.state.sliceDoc(secondRange.from, secondRange.to)).toBe("two");
  });

  it("ends the session when an external root edit rebuilds the widget", async () => {
    const view = createRootView("| A | B |\n| --- | --- |\n| one | two |");
    const [cellA] = await waitForBodyCells(view, 2);

    cellA.dispatchEvent(mousedown());
    expect(getActiveInlineEditor()).not.toBeNull();

    // An unannotated root edit inside the table but outside the open cell
    // rebuilds the widget, which tears the active session down.
    const editFrom = view.state.doc.toString().indexOf("two");
    view.dispatch({ changes: { from: editFrom, to: editFrom + 3, insert: "TWO" } });

    expect(getActiveInlineEditor()).toBeNull();
    expect(view.dom.textContent).toContain("TWO");
  });

  it("places rendered-token cell selections before focusing the inline editor", async () => {
    const body: InlineEditorController = {
      view: createMockEditorView({
        state: { field: () => undefined },
      }),
      setCallbacks: vi.fn(),
      destroy: vi.fn(),
    };
    createInlineEditorControllerMock.mockReturnValueOnce(body);

    const view = createRootView("| A |\n| --- |\n| **old** and $x$ |");
    await waitForBodyCells(view, 1);
    const renderedToken = view.dom.querySelector<HTMLElement>("tbody td strong");
    expect(renderedToken).not.toBeNull();
    if (!renderedToken) throw new Error("expected rendered bold token to exist");

    renderedToken.dispatchEvent(mousedown());

    expect(body.view.dispatch).toHaveBeenCalledTimes(1);
    expect(body.view.focus).toHaveBeenCalled();
    expect(
      vi.mocked(body.view.dispatch).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(body.view.focus).mock.invocationCallOrder[0],
    );
  });
});

describe("TableWidget module ownership", () => {
  it("keeps DOM construction and mutation flows out of the shell widget", () => {
    const source = readRenderSource("src/editor/render/table-widget.ts");

    expect(source.split(/\r?\n/).length).toBeLessThan(600);
    expect(source).toContain("buildTableWidgetDOM");
    expect(source).not.toContain("createInlineEditorController");
    expect(source).not.toContain("applyTableMutation");
    expect(source).not.toContain("showWidgetContextMenu");
    expect(source).not.toContain('document.createElement("table")');
    expect(source).not.toContain('addEventListener("contextmenu"');
  });
});
