/**
 * Text-level table editing commands and keymap.
 *
 * Keyboard editing for GFM pipe tables in the plain text surface (source
 * mode / unrendered tables), ported from Zettlr's table-editor commands and
 * built on the parsed table model in `state/table-utils.ts`. Structural
 * mutations (swap / add row / add column) reformat the table with
 * `formatTable`, matching how the table widget's context-menu mutations
 * behave (`render/table-actions.ts`). `setColumnAlignment` rewrites only the
 * delimiter line, preserving column widths.
 *
 * Wiring (integrator):
 * - Append `tableEditingKeymap` to the editor extensions AFTER the rich
 *   render extensions so the widget-aware `tableKeybindings`
 *   (`render/table-navigation.ts`, also `Prec.high`) stays earlier in the
 *   keymap chain and keeps priority while tables render as widgets. Every
 *   command here returns false when the primary selection is not entirely
 *   inside a pipe table, so keys fall through to defaults outside tables.
 * - Optionally register `tableEditingCommands` through
 *   `commandRegistryExtension(tableEditingCommands)` for palette access.
 */

import { type EditorState, type Extension, Prec } from "@codemirror/state";
import { type EditorView, type KeyBinding, keymap } from "@codemirror/view";
import type { Command } from "./command-registry";
import {
  findCellBounds,
  findPipePositions,
  findTableAtCursor,
  findTablesInState,
  getCursorColIndex,
  skipSeparator,
  type TableRange,
} from "./render/table-discovery";
import {
  addColumn,
  addRow,
  type Alignment,
  alignmentToSeparator,
  formatTable,
  moveColumn,
  moveRow,
  type ParsedTable,
} from "./state/table-utils";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Find the table that contains the ENTIRE primary selection, or null.
 *
 * Requiring both selection endpoints inside the table keeps the keymap from
 * consuming keys when a selection spans out of the table.
 */
function findEditableTable(state: EditorState): TableRange | null {
  const range = state.selection.main;
  const table = findTableAtCursor(findTablesInState(state), range.head);
  if (!table) return null;
  if (range.from < table.from || range.to > table.to) return null;
  return table;
}

/** 0-based table line index (0 = header, 1 = separator, 2+ = data rows). */
function cursorLineIndex(view: EditorView, table: TableRange): number {
  const head = view.state.selection.main.head;
  return view.state.doc.lineAt(head).number - table.startLineNumber;
}

/** Move the cursor to the content start of a cell. Always consumes the key. */
function moveCursorToCell(
  view: EditorView,
  table: TableRange,
  lineIdx: number,
  colIdx: number,
): boolean {
  const line = view.state.doc.line(table.startLineNumber + lineIdx);
  const bounds = findCellBounds(line.text, line.from, colIdx);
  if (bounds) {
    view.dispatch({ selection: { anchor: bounds.from }, scrollIntoView: false });
  }
  return true;
}

/**
 * Replace a table's text with the pretty-printed serialization of `mutated`
 * and land the cursor at the content start of the given cell (indices in the
 * NEW table). Mirrors `applyTableMutation` in `render/table-actions.ts`,
 * which also reformats on every structural change, plus cursor placement.
 */
function replaceTable(
  view: EditorView,
  table: TableRange,
  mutated: ParsedTable,
  cursor: { readonly lineIdx: number; readonly colIdx: number },
): boolean {
  const newLines = formatTable(mutated);
  const lineIdx = Math.max(0, Math.min(cursor.lineIdx, newLines.length - 1));
  const colIdx = Math.max(
    0,
    Math.min(cursor.colIdx, mutated.header.cells.length - 1),
  );

  let lineFrom = table.from;
  for (let i = 0; i < lineIdx; i++) {
    lineFrom += newLines[i].length + 1;
  }
  const bounds = findCellBounds(newLines[lineIdx], lineFrom, colIdx);

  view.dispatch({
    changes: { from: table.from, to: table.to, insert: newLines.join("\n") },
    // Selection coordinates refer to the post-change document.
    selection: { anchor: bounds ? bounds.from : lineFrom },
  });
  return true;
}

/** Swap the header row with the first data row (jumping the delimiter). */
function swapHeaderWithFirstRow(parsed: ParsedTable): ParsedTable {
  const rows = [...parsed.rows];
  const newHeader = rows[0];
  rows[0] = parsed.header;
  return { ...parsed, header: newHeader, rows };
}

// ---------------------------------------------------------------------------
// Cell / row navigation (Tab, Shift-Tab, Enter, Shift-Enter)
// ---------------------------------------------------------------------------

/** Tab: move to the next cell; append a blank row after the last cell. */
export function tableNextCell(view: EditorView): boolean {
  const table = findEditableTable(view.state);
  if (!table) return false;
  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  const colCount = table.parsed.header.cells.length;
  const lineIdx = cursorLineIndex(view, table);

  let nextLineIdx = skipSeparator(lineIdx, 1);
  let nextColIdx = colIdx + 1;
  if (nextColIdx >= colCount) {
    nextColIdx = 0;
    nextLineIdx = skipSeparator(nextLineIdx + 1, 1);
  }

  if (nextLineIdx >= table.lines.length) {
    return replaceTable(view, table, addRow(table.parsed), {
      lineIdx: table.lines.length,
      colIdx: 0,
    });
  }
  return moveCursorToCell(view, table, nextLineIdx, nextColIdx);
}

/** Shift-Tab: move to the previous cell; stay put at the first cell. */
export function tablePrevCell(view: EditorView): boolean {
  const table = findEditableTable(view.state);
  if (!table) return false;
  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  const lineIdx = cursorLineIndex(view, table);

  let prevLineIdx = lineIdx;
  let prevColIdx = colIdx - 1;
  if (prevColIdx < 0) {
    prevColIdx = table.parsed.header.cells.length - 1;
    prevLineIdx = skipSeparator(prevLineIdx - 1, -1);
  }

  if (prevLineIdx < 0) return true;
  return moveCursorToCell(view, table, prevLineIdx, prevColIdx);
}

/**
 * Enter: move to the same column in the next row, skipping the separator;
 * append a blank row from the last row. Never inserts a newline in a table.
 */
export function tableNextRow(view: EditorView): boolean {
  const table = findEditableTable(view.state);
  if (!table) return false;
  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  const lineIdx = cursorLineIndex(view, table);
  const targetColIdx = lineIdx === 1 ? 0 : colIdx;
  const nextLineIdx = skipSeparator(lineIdx + 1, 1);

  if (nextLineIdx >= table.lines.length) {
    return replaceTable(view, table, addRow(table.parsed), {
      lineIdx: table.lines.length,
      colIdx: targetColIdx,
    });
  }
  return moveCursorToCell(view, table, nextLineIdx, targetColIdx);
}

/**
 * Shift-Enter: move to the same column in the previous row, skipping the
 * separator; consumed without effect at the header row.
 */
export function tablePrevRow(view: EditorView): boolean {
  const table = findEditableTable(view.state);
  if (!table) return false;
  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  const lineIdx = cursorLineIndex(view, table);
  const targetColIdx = lineIdx === 1 ? 0 : colIdx;
  const prevLineIdx = skipSeparator(lineIdx - 1, -1);

  if (prevLineIdx < 0) return true;
  return moveCursorToCell(view, table, prevLineIdx, targetColIdx);
}

// ---------------------------------------------------------------------------
// Row swaps (Alt-ArrowUp / Alt-ArrowDown) — header-aware: swaps jump over
// the delimiter line, so the header exchanges with the first data row.
// These always consume the key inside a table (even when nothing can move)
// because the default Alt-arrow binding is moveLine, which would tear a row
// out of the table.
// ---------------------------------------------------------------------------

/** Alt-ArrowUp: swap the current row with the one above. */
export function tableSwapRowUp(view: EditorView): boolean {
  const table = findEditableTable(view.state);
  if (!table) return false;
  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  const lineIdx = cursorLineIndex(view, table);
  // Header can't move further up; the separator row never moves.
  if (lineIdx <= 1) return true;

  const dataIdx = lineIdx - 2;
  if (dataIdx === 0) {
    return replaceTable(view, table, swapHeaderWithFirstRow(table.parsed), {
      lineIdx: 0,
      colIdx,
    });
  }
  return replaceTable(view, table, moveRow(table.parsed, dataIdx, dataIdx - 1), {
    lineIdx: lineIdx - 1,
    colIdx,
  });
}

/** Alt-ArrowDown: swap the current row with the one below. */
export function tableSwapRowDown(view: EditorView): boolean {
  const table = findEditableTable(view.state);
  if (!table) return false;
  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  const lineIdx = cursorLineIndex(view, table);
  // The separator row never moves.
  if (lineIdx === 1) return true;

  if (lineIdx === 0) {
    if (table.parsed.rows.length === 0) return true;
    return replaceTable(view, table, swapHeaderWithFirstRow(table.parsed), {
      lineIdx: 2,
      colIdx,
    });
  }

  const dataIdx = lineIdx - 2;
  if (dataIdx >= table.parsed.rows.length - 1) return true;
  return replaceTable(view, table, moveRow(table.parsed, dataIdx, dataIdx + 1), {
    lineIdx: lineIdx + 1,
    colIdx,
  });
}

// ---------------------------------------------------------------------------
// Column swaps (Alt-ArrowLeft / Alt-ArrowRight) — alignments travel with
// their column. At a boundary these return false: the default binding is a
// harmless cursor motion, unlike the destructive moveLine for rows.
// ---------------------------------------------------------------------------

/** Alt-ArrowLeft: swap the current column with the one to its left. */
export function tableSwapColLeft(view: EditorView): boolean {
  const table = findEditableTable(view.state);
  if (!table) return false;
  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null || colIdx === 0) return false;

  return replaceTable(view, table, moveColumn(table.parsed, colIdx, colIdx - 1), {
    lineIdx: cursorLineIndex(view, table),
    colIdx: colIdx - 1,
  });
}

/** Alt-ArrowRight: swap the current column with the one to its right. */
export function tableSwapColRight(view: EditorView): boolean {
  const table = findEditableTable(view.state);
  if (!table) return false;
  const colIdx = getCursorColIndex(view, table);
  const colCount = table.parsed.header.cells.length;
  if (colIdx === null || colIdx >= colCount - 1) return false;

  return replaceTable(view, table, moveColumn(table.parsed, colIdx, colIdx + 1), {
    lineIdx: cursorLineIndex(view, table),
    colIdx: colIdx + 1,
  });
}

// ---------------------------------------------------------------------------
// Add row / column (Shift-Alt-ArrowDown / Shift-Alt-ArrowRight)
// ---------------------------------------------------------------------------

/**
 * Shift-Alt-ArrowDown: insert a blank row below the current one. From the
 * header or separator line the new row becomes the first data row. The
 * cursor lands in the same column of the new row.
 */
export function tableAddRowBelow(view: EditorView): boolean {
  const table = findEditableTable(view.state);
  if (!table) return false;
  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  const lineIdx = cursorLineIndex(view, table);
  const insertAt = lineIdx <= 1 ? 0 : lineIdx - 1;
  return replaceTable(view, table, addRow(table.parsed, insertAt), {
    lineIdx: insertAt + 2,
    colIdx,
  });
}

/**
 * Shift-Alt-ArrowRight: insert a blank column to the right of the current
 * one. The cursor lands in the new column on the same line.
 */
export function tableAddColRight(view: EditorView): boolean {
  const table = findEditableTable(view.state);
  if (!table) return false;
  const colIdx = getCursorColIndex(view, table);
  if (colIdx === null) return false;

  return replaceTable(view, table, addColumn(table.parsed, colIdx + 1), {
    lineIdx: cursorLineIndex(view, table),
    colIdx: colIdx + 1,
  });
}

// ---------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------

/**
 * Command factory: set the alignment of the column under the cursor by
 * rewriting ONLY the delimiter line, preserving column widths so the rest
 * of the table stays untouched.
 */
export function setColumnAlignment(
  alignment: Alignment,
): (view: EditorView) => boolean {
  return (view) => {
    const table = findEditableTable(view.state);
    if (!table) return false;
    const colIdx = getCursorColIndex(view, table);
    if (colIdx === null) return false;

    const sepLine = view.state.doc.line(table.startLineNumber + 1);
    const pipes = findPipePositions(sepLine.text);
    if (pipes.length < 2 || colIdx >= pipes.length - 1) return false;

    const regionFrom = pipes[colIdx] + 1;
    const regionTo = pipes[colIdx + 1];
    const raw = sepLine.text.slice(regionFrom, regionTo);
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    const next =
      " ".repeat(lead) + alignmentToSeparator(alignment, raw.trim().length) + " ".repeat(trail);

    if (next !== raw) {
      view.dispatch({
        changes: {
          from: sepLine.from + regionFrom,
          to: sepLine.from + regionTo,
          insert: next,
        },
      });
    }
    return true;
  };
}

export const tableAlignColumnLeft = setColumnAlignment("left");
export const tableAlignColumnCenter = setColumnAlignment("center");
export const tableAlignColumnRight = setColumnAlignment("right");
export const tableAlignColumnNone = setColumnAlignment("none");

/**
 * Mod-Shift-a: pretty-print every table in the document — pad all cells to
 * uniform column widths (via `formatTable`). Idempotent. Works regardless of
 * where the selection is; returns false only when the document has no tables.
 */
export function alignTables(view: EditorView): boolean {
  const tables = findTablesInState(view.state);
  if (tables.length === 0) return false;

  const changes: { from: number; to: number; insert: string }[] = [];
  for (const table of tables) {
    const formatted = formatTable(table.parsed).join("\n");
    if (view.state.sliceDoc(table.from, table.to) !== formatted) {
      changes.push({ from: table.from, to: table.to, insert: formatted });
    }
  }
  if (changes.length > 0) {
    view.dispatch({ changes });
  }
  return true;
}

// ---------------------------------------------------------------------------
// Keymap + command registry entries
// ---------------------------------------------------------------------------

const tableEditingKeyBindings: readonly KeyBinding[] = [
  { key: "Tab", run: tableNextCell, shift: tablePrevCell },
  { key: "Enter", run: tableNextRow, shift: tablePrevRow },
  { key: "Alt-ArrowUp", run: tableSwapRowUp },
  { key: "Alt-ArrowDown", run: tableSwapRowDown, shift: tableAddRowBelow },
  { key: "Alt-ArrowLeft", run: tableSwapColLeft },
  { key: "Alt-ArrowRight", run: tableSwapColRight, shift: tableAddColRight },
  { key: "Mod-Shift-a", run: alignTables },
];

/**
 * Main extension: text-level table editing keymap.
 *
 * `Prec.high` so the bindings beat the defaults (indentWithTab, insert
 * newline, moveLine) inside tables; append AFTER the rich render extensions
 * so the widget keymap in `render/table-navigation.ts` (same precedence,
 * registered earlier) keeps priority.
 */
export const tableEditingKeymap: Extension = Prec.high(
  keymap.of([...tableEditingKeyBindings]),
);

function inTable({ view }: { view: EditorView }): boolean {
  return findEditableTable(view.state) !== null;
}

/** Palette-facing command registry entries for the table editing commands. */
export const tableEditingCommands: readonly Command[] = [
  {
    id: "table-align-column-left",
    label: "Table: Align Column Left",
    keywords: ["table", "alignment"],
    isEnabled: inTable,
    run: ({ view }) => tableAlignColumnLeft(view),
  },
  {
    id: "table-align-column-center",
    label: "Table: Align Column Center",
    keywords: ["table", "alignment"],
    isEnabled: inTable,
    run: ({ view }) => tableAlignColumnCenter(view),
  },
  {
    id: "table-align-column-right",
    label: "Table: Align Column Right",
    keywords: ["table", "alignment"],
    isEnabled: inTable,
    run: ({ view }) => tableAlignColumnRight(view),
  },
  {
    id: "table-align-column-none",
    label: "Table: Clear Column Alignment",
    keywords: ["table", "alignment"],
    isEnabled: inTable,
    run: ({ view }) => tableAlignColumnNone(view),
  },
  {
    id: "table-add-row-below",
    label: "Table: Add Row Below",
    keywords: ["table", "row"],
    isEnabled: inTable,
    run: ({ view }) => tableAddRowBelow(view),
  },
  {
    id: "table-add-column-right",
    label: "Table: Add Column Right",
    keywords: ["table", "column"],
    isEnabled: inTable,
    run: ({ view }) => tableAddColRight(view),
  },
  {
    id: "table-swap-row-up",
    label: "Table: Move Row Up",
    keywords: ["table", "row"],
    isEnabled: inTable,
    run: ({ view }) => tableSwapRowUp(view),
  },
  {
    id: "table-swap-row-down",
    label: "Table: Move Row Down",
    keywords: ["table", "row"],
    isEnabled: inTable,
    run: ({ view }) => tableSwapRowDown(view),
  },
  {
    id: "table-swap-column-left",
    label: "Table: Move Column Left",
    keywords: ["table", "column"],
    isEnabled: inTable,
    run: ({ view }) => tableSwapColLeft(view),
  },
  {
    id: "table-swap-column-right",
    label: "Table: Move Column Right",
    keywords: ["table", "column"],
    isEnabled: inTable,
    run: ({ view }) => tableSwapColRight(view),
  },
  {
    id: "table-align-tables",
    label: "Format All Tables",
    keywords: ["table", "format", "align"],
    isEnabled: ({ view }) => findTablesInState(view.state).length > 0,
    run: ({ view }) => alignTables(view),
  },
];
