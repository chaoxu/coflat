import { forceParsing } from "@codemirror/language";
import { type EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownLanguageExtensions } from "./base-editor-extensions";
import { findCellBounds } from "./render/table-discovery";
import { tableDiscoveryField } from "./state/table-discovery";
import {
  alignTables,
  setColumnAlignment,
  tableAlignColumnCenter,
  tableEditingKeymap,
} from "./table-commands";
import { createTestView } from "./test-utils";

const BASE_DOC = [
  "| A   | B   |",
  "| --- | --- |",
  "| 1   | 22  |",
  "| 333 | 4   |",
].join("\n");

const RAGGED_DOC = [
  "| A | B |",
  "| --- | --- |",
  "| 1 |",
  "| 22 | 333 |",
].join("\n");

const HEADER_ONLY_DOC = [
  "| H1  | H2  |",
  "| --- | --- |",
].join("\n");

const ALIGNED_COLS_DOC = [
  "| L    | R    |",
  "| :--- | ---: |",
  "| a    | bb   |",
].join("\n");

const SINGLE_COL_DOC = [
  "| Only |",
  "| ---- |",
  "| x    |",
].join("\n");

const PROSE_AND_TABLE_DOC = ["Some prose here.", "", BASE_DOC].join("\n");

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

function makeView(doc: string): EditorView {
  const nextView = createTestView(doc, {
    extensions: [
      ...createMarkdownLanguageExtensions(),
      tableDiscoveryField,
      tableEditingKeymap,
    ],
  });
  forceParsing(nextView, nextView.state.doc.length, 5000);
  return nextView;
}

function getCell(view: EditorView, lineNumber: number, colIndex: number): { from: number; to: number } {
  const line = view.state.doc.line(lineNumber);
  const bounds = findCellBounds(line.text, line.from, colIndex);
  expect(bounds).not.toBeNull();
  if (!bounds) {
    throw new Error(`expected table cell at line ${lineNumber}, column ${colIndex}`);
  }
  return bounds;
}

function setCursor(view: EditorView, anchor: number, head = anchor): void {
  view.dispatch({
    selection: { anchor, head },
    scrollIntoView: false,
  });
}

function pressKey(
  view: EditorView,
  key: string,
  eventInit: KeyboardEventInit = {},
): boolean {
  return runScopeHandlers(
    view,
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...eventInit,
    }),
    "editor",
  );
}

describe("tableNextCell / tablePrevCell (Tab / Shift-Tab)", () => {
  it("tabs across cells, skips the separator, and appends a row at the end", () => {
    view = makeView(BASE_DOC);

    setCursor(view, getCell(view, 1, 0).from + 1);
    expect(pressKey(view, "Tab")).toBe(true);
    expect(view.state.doc.toString()).toBe(BASE_DOC);
    expect(view.state.selection.main.head).toBe(getCell(view, 1, 1).from);

    setCursor(view, getCell(view, 1, 1).from + 1);
    expect(pressKey(view, "Tab")).toBe(true);
    expect(view.state.doc.toString()).toBe(BASE_DOC);
    expect(view.state.selection.main.head).toBe(getCell(view, 3, 0).from);

    setCursor(view, getCell(view, 4, 1).from + 1);
    expect(pressKey(view, "Tab")).toBe(true);
    expect(view.state.doc.toString()).toBe(BASE_DOC + "\n|     |     |");
    expect(view.state.selection.main.head).toBe(getCell(view, 5, 0).from);
  });

  it("reformats a ragged table when appending a row from its last cell", () => {
    view = makeView(RAGGED_DOC);

    setCursor(view, getCell(view, 4, 1).from + 1);
    expect(pressKey(view, "Tab")).toBe(true);
    expect(view.state.doc.toString()).toBe([
      "| A   | B   |",
      "| --- | --- |",
      "| 1   |     |",
      "| 22  | 333 |",
      "|     |     |",
    ].join("\n"));
    expect(view.state.selection.main.head).toBe(getCell(view, 5, 0).from);
  });

  it("shift-tabs backward and consumes the key at the first header cell", () => {
    view = makeView(BASE_DOC);

    setCursor(view, getCell(view, 3, 0).from);
    expect(pressKey(view, "Tab", { shiftKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe(BASE_DOC);
    expect(view.state.selection.main.head).toBe(getCell(view, 1, 1).from);

    const firstHeaderCell = getCell(view, 1, 0);
    setCursor(view, firstHeaderCell.from);
    expect(pressKey(view, "Tab", { shiftKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe(BASE_DOC);
    expect(view.state.selection.main.head).toBe(firstHeaderCell.from);
  });
});

describe("tableNextRow / tablePrevRow (Enter / Shift-Enter)", () => {
  it("enters to the same column in the next row without inserting a newline", () => {
    view = makeView(BASE_DOC);

    setCursor(view, getCell(view, 1, 1).from + 1);
    expect(pressKey(view, "Enter")).toBe(true);
    expect(view.state.doc.toString()).toBe(BASE_DOC);
    expect(view.state.selection.main.head).toBe(getCell(view, 3, 1).from);
  });

  it("appends a row from the last row, keeping the column", () => {
    view = makeView(BASE_DOC);

    setCursor(view, getCell(view, 4, 1).from);
    expect(pressKey(view, "Enter")).toBe(true);
    expect(view.state.doc.toString()).toBe(BASE_DOC + "\n|     |     |");
    expect(view.state.selection.main.head).toBe(getCell(view, 5, 1).from);
  });

  it("appends the first data row on Enter in a header-only table", () => {
    view = makeView(HEADER_ONLY_DOC);

    setCursor(view, getCell(view, 1, 1).from);
    expect(pressKey(view, "Enter")).toBe(true);
    expect(view.state.doc.toString()).toBe(HEADER_ONLY_DOC + "\n|     |     |");
    expect(view.state.selection.main.head).toBe(getCell(view, 3, 1).from);
  });

  it("shift-enters to the previous row and consumes the key at the header", () => {
    view = makeView(BASE_DOC);

    setCursor(view, getCell(view, 4, 0).from);
    expect(pressKey(view, "Enter", { shiftKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe(BASE_DOC);
    expect(view.state.selection.main.head).toBe(getCell(view, 3, 0).from);

    setCursor(view, getCell(view, 3, 0).from);
    expect(pressKey(view, "Enter", { shiftKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe(BASE_DOC);
    expect(view.state.selection.main.head).toBe(getCell(view, 1, 0).from);

    const headerCell = getCell(view, 1, 0);
    setCursor(view, headerCell.from);
    expect(pressKey(view, "Enter", { shiftKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe(BASE_DOC);
    expect(view.state.selection.main.head).toBe(headerCell.from);
  });
});

describe("tableSwapRowUp / tableSwapRowDown (Alt-ArrowUp / Alt-ArrowDown)", () => {
  const HEADER_SWAPPED_DOC = [
    "| 1   | 22  |",
    "| --- | --- |",
    "| A   | B   |",
    "| 333 | 4   |",
  ].join("\n");

  it("swaps adjacent data rows and keeps the cursor in the same column", () => {
    view = makeView(BASE_DOC);

    setCursor(view, getCell(view, 3, 1).from);
    expect(pressKey(view, "ArrowDown", { altKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe([
      "| A   | B   |",
      "| --- | --- |",
      "| 333 | 4   |",
      "| 1   | 22  |",
    ].join("\n"));
    expect(view.state.selection.main.head).toBe(getCell(view, 4, 1).from);

    forceParsing(view, view.state.doc.length, 5000);
    expect(pressKey(view, "ArrowUp", { altKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe(BASE_DOC);
    expect(view.state.selection.main.head).toBe(getCell(view, 3, 1).from);
  });

  it("swaps the header with the first data row, jumping over the delimiter", () => {
    view = makeView(BASE_DOC);

    setCursor(view, getCell(view, 1, 0).from);
    expect(pressKey(view, "ArrowDown", { altKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe(HEADER_SWAPPED_DOC);
    expect(view.state.selection.main.head).toBe(getCell(view, 3, 0).from);

    forceParsing(view, view.state.doc.length, 5000);
    expect(pressKey(view, "ArrowUp", { altKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe(BASE_DOC);
    expect(view.state.selection.main.head).toBe(getCell(view, 1, 0).from);
  });

  it("consumes the key without changes at the edges and on the separator", () => {
    view = makeView(BASE_DOC);

    setCursor(view, getCell(view, 1, 0).from);
    expect(pressKey(view, "ArrowUp", { altKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe(BASE_DOC);

    setCursor(view, getCell(view, 4, 0).from);
    expect(pressKey(view, "ArrowDown", { altKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe(BASE_DOC);

    const separatorLine = view.state.doc.line(2);
    setCursor(view, separatorLine.from + 2);
    expect(pressKey(view, "ArrowUp", { altKey: true })).toBe(true);
    expect(pressKey(view, "ArrowDown", { altKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe(BASE_DOC);
  });

  it("consumes Alt-ArrowDown on the header of a table without data rows", () => {
    view = makeView(HEADER_ONLY_DOC);

    setCursor(view, getCell(view, 1, 0).from);
    expect(pressKey(view, "ArrowDown", { altKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe(HEADER_ONLY_DOC);
  });
});

describe("tableSwapColLeft / tableSwapColRight (Alt-ArrowLeft / Alt-ArrowRight)", () => {
  it("swaps columns with their alignments and follows the moved column", () => {
    view = makeView(ALIGNED_COLS_DOC);

    setCursor(view, getCell(view, 3, 0).from);
    expect(pressKey(view, "ArrowRight", { altKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe([
      "|   R | L   |",
      "| --: | :-- |",
      "|  bb | a   |",
    ].join("\n"));
    expect(view.state.selection.main.head).toBe(getCell(view, 3, 1).from);

    forceParsing(view, view.state.doc.length, 5000);
    expect(pressKey(view, "ArrowLeft", { altKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe([
      "| L   |   R |",
      "| :-- | --: |",
      "| a   |  bb |",
    ].join("\n"));
    expect(view.state.selection.main.head).toBe(getCell(view, 3, 0).from);
  });

  it("returns false at column boundaries without changing the table", () => {
    view = makeView(BASE_DOC);

    setCursor(view, getCell(view, 3, 0).from);
    expect(pressKey(view, "ArrowLeft", { altKey: true })).toBe(false);
    expect(view.state.doc.toString()).toBe(BASE_DOC);

    setCursor(view, getCell(view, 3, 1).from);
    expect(pressKey(view, "ArrowRight", { altKey: true })).toBe(false);
    expect(view.state.doc.toString()).toBe(BASE_DOC);
  });

  it("returns false in a single-column table", () => {
    view = makeView(SINGLE_COL_DOC);

    setCursor(view, getCell(view, 3, 0).from);
    expect(pressKey(view, "ArrowLeft", { altKey: true })).toBe(false);
    expect(pressKey(view, "ArrowRight", { altKey: true })).toBe(false);
    expect(view.state.doc.toString()).toBe(SINGLE_COL_DOC);
  });
});

describe("tableAddRowBelow (Shift-Alt-ArrowDown)", () => {
  it("inserts a blank row below the current data row", () => {
    view = makeView(BASE_DOC);

    setCursor(view, getCell(view, 3, 1).from);
    expect(pressKey(view, "ArrowDown", { altKey: true, shiftKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe([
      "| A   | B   |",
      "| --- | --- |",
      "| 1   | 22  |",
      "|     |     |",
      "| 333 | 4   |",
    ].join("\n"));
    expect(view.state.selection.main.head).toBe(getCell(view, 4, 1).from);
  });

  it("inserts the new row as the first data row when on the header", () => {
    view = makeView(BASE_DOC);

    setCursor(view, getCell(view, 1, 0).from);
    expect(pressKey(view, "ArrowDown", { altKey: true, shiftKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe([
      "| A   | B   |",
      "| --- | --- |",
      "|     |     |",
      "| 1   | 22  |",
      "| 333 | 4   |",
    ].join("\n"));
    expect(view.state.selection.main.head).toBe(getCell(view, 3, 0).from);
  });
});

describe("tableAddColRight (Shift-Alt-ArrowRight)", () => {
  it("inserts a blank column right of the current one, cursor in the new cell", () => {
    view = makeView(BASE_DOC);

    setCursor(view, getCell(view, 3, 0).from);
    expect(pressKey(view, "ArrowRight", { altKey: true, shiftKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe([
      "| A   |     | B   |",
      "| --- | --- | --- |",
      "| 1   |     | 22  |",
      "| 333 |     | 4   |",
    ].join("\n"));
    expect(view.state.selection.main.head).toBe(getCell(view, 3, 1).from);
  });
});

describe("setColumnAlignment", () => {
  it("rewrites only the delimiter line, preserving widths and padding", () => {
    view = makeView(BASE_DOC);

    setCursor(view, getCell(view, 3, 1).from);
    expect(setColumnAlignment("center")(view)).toBe(true);
    expect(view.state.doc.toString()).toBe([
      "| A   | B   |",
      "| --- | :-: |",
      "| 1   | 22  |",
      "| 333 | 4   |",
    ].join("\n"));

    forceParsing(view, view.state.doc.length, 5000);
    expect(setColumnAlignment("right")(view)).toBe(true);
    expect(view.state.doc.line(2).text).toBe("| --- | --: |");

    forceParsing(view, view.state.doc.length, 5000);
    expect(setColumnAlignment("left")(view)).toBe(true);
    expect(view.state.doc.line(2).text).toBe("| --- | :-- |");

    forceParsing(view, view.state.doc.length, 5000);
    expect(setColumnAlignment("none")(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(BASE_DOC);
  });

  it("is a no-op (but handled) when the alignment is already set", () => {
    view = makeView(BASE_DOC);

    setCursor(view, getCell(view, 3, 0).from);
    expect(setColumnAlignment("none")(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(BASE_DOC);
  });

  it("preserves ragged delimiter cell widths", () => {
    view = makeView(RAGGED_DOC);

    setCursor(view, getCell(view, 1, 0).from);
    expect(tableAlignColumnCenter(view)).toBe(true);
    expect(view.state.doc.line(2).text).toBe("| :-: | --- |");
    expect(view.state.doc.line(1).text).toBe("| A | B |");
  });

  it("returns false outside a table", () => {
    view = makeView(PROSE_AND_TABLE_DOC);

    setCursor(view, 0);
    expect(setColumnAlignment("center")(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(PROSE_AND_TABLE_DOC);
  });
});

describe("alignTables (Mod-Shift-a)", () => {
  const MESSY_DOC = [
    "intro",
    "",
    "| A | Longer |",
    "| - | - |",
    "| aaaa | b |",
    "",
    "middle",
    "",
    "| X | Y |",
    "|---|---|",
    "| 1 | 2 |",
  ].join("\n");

  const FORMATTED_DOC = [
    "intro",
    "",
    "| A    | Longer |",
    "| ---- | ------ |",
    "| aaaa | b      |",
    "",
    "middle",
    "",
    "| X   | Y   |",
    "| --- | --- |",
    "| 1   | 2   |",
  ].join("\n");

  it("pretty-prints every table in the document, even with the cursor outside", () => {
    view = makeView(MESSY_DOC);

    setCursor(view, 0);
    expect(pressKey(view, "a", { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(view.state.doc.toString()).toBe(FORMATTED_DOC);
  });

  it("is idempotent", () => {
    view = makeView(MESSY_DOC);

    expect(alignTables(view)).toBe(true);
    forceParsing(view, view.state.doc.length, 5000);
    expect(alignTables(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(FORMATTED_DOC);
  });

  it("returns false when the document has no tables", () => {
    view = makeView("just some prose\n\nwith paragraphs");

    expect(pressKey(view, "a", { ctrlKey: true, shiftKey: true })).toBe(false);
  });
});

describe("keymap guards", () => {
  it("does not consume any table key outside a table", () => {
    view = makeView(PROSE_AND_TABLE_DOC);

    setCursor(view, 4);
    expect(pressKey(view, "Tab")).toBe(false);
    expect(pressKey(view, "Tab", { shiftKey: true })).toBe(false);
    expect(pressKey(view, "Enter")).toBe(false);
    expect(pressKey(view, "Enter", { shiftKey: true })).toBe(false);
    expect(pressKey(view, "ArrowUp", { altKey: true })).toBe(false);
    expect(pressKey(view, "ArrowDown", { altKey: true })).toBe(false);
    expect(pressKey(view, "ArrowLeft", { altKey: true })).toBe(false);
    expect(pressKey(view, "ArrowRight", { altKey: true })).toBe(false);
    expect(pressKey(view, "ArrowDown", { altKey: true, shiftKey: true })).toBe(false);
    expect(pressKey(view, "ArrowRight", { altKey: true, shiftKey: true })).toBe(false);
    expect(view.state.doc.toString()).toBe(PROSE_AND_TABLE_DOC);
  });

  it("does not consume keys when the selection spans out of the table", () => {
    view = makeView(PROSE_AND_TABLE_DOC);

    const tableCell = getCell(view, 3, 0);
    setCursor(view, 0, tableCell.from + 1);
    expect(pressKey(view, "Enter")).toBe(false);
    expect(pressKey(view, "Tab")).toBe(false);
    expect(view.state.doc.toString()).toBe(PROSE_AND_TABLE_DOC);
  });
});
