import { Annotation } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  findClosestTable,
  findTablesInState,
  type TableRange,
} from "./table-discovery";
import type { ParsedTable } from "./table-utils";
import type { TableCellAddress } from "./table-widget-navigation";

/**
 * Annotation attached to transactions dispatched by cell-edit sync.
 *
 * - `"edit"`: live keystroke forwarded from the open cell's subview — the
 *   StateField maps existing decorations through the change so the
 *   widget (and its nested editor) is not destroyed mid-edit.
 * - `"commit"`: the inline session ended — the document already holds the
 *   live-window edits, so the (usually change-less) dispatch just makes the
 *   StateField rebuild the widget with a fresh ParsedTable (#404).
 */
export const cellEditAnnotation = Annotation.define<"edit" | "commit">();

export class TableWidgetController {
  constructor(
    private table: ParsedTable,
    private trackedTableFrom: number,
    private readonly getRootView: () => EditorView | null,
  ) {}

  get currentTable(): ParsedTable {
    return this.table;
  }

  get tableFrom(): number {
    return this.trackedTableFrom;
  }

  getRawCellText(address: TableCellAddress): string {
    if (address.section === "header") {
      return address.col < this.table.header.cells.length
        ? this.table.header.cells[address.col].content
        : "";
    }
    if (
      address.row < this.table.rows.length &&
      address.col < this.table.rows[address.row].cells.length
    ) {
      return this.table.rows[address.row].cells[address.col].content;
    }
    return "";
  }

  replaceLocalCell(address: TableCellAddress, newContent: string): void {
    this.table = this.buildUpdatedTable(address, newContent);
  }

  currentTableRange(): TableRange | null {
    const rootView = this.getRootView();
    if (!rootView) return null;
    return findClosestTable(findTablesInState(rootView.state), this.trackedTableFrom) ?? null;
  }

  private buildUpdatedTable(
    address: TableCellAddress,
    newContent: string,
  ): ParsedTable {
    if (address.section === "header") {
      const cells = this.table.header.cells.map((cell, index) =>
        index === address.col ? { content: newContent } : cell,
      );
      return { ...this.table, header: { cells } };
    }
    const rows = this.table.rows.map((tableRow, rowIndex) => {
      if (rowIndex !== address.row) return tableRow;
      const cells = tableRow.cells.map((cell, colIndex) =>
        colIndex === address.col ? { content: newContent } : cell,
      );
      return { cells };
    });
    return { ...this.table, rows };
  }
}
