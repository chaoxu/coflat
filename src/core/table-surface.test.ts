import { describe, expect, it } from "vitest";
import {
  applyTableCellSurface,
  createTableCellElement,
  createTableRowSurfaceElement,
  createTableSurfaceElement,
  normalizeTableCellAlign,
  renderTableCellHtml,
  renderTableRowHtml,
  renderTableSurfaceHtml,
  tableCellClassNames,
  tableCellSurfaceAttrs,
  tableRowSurfaceAttrs,
  tableSurfaceAttrs,
} from "./table-surface";

describe("table surface", () => {
  it("normalizes supported alignment values", () => {
    expect(normalizeTableCellAlign("left")).toBe("left");
    expect(normalizeTableCellAlign("center")).toBe("center");
    expect(normalizeTableCellAlign("right")).toBe("right");
    expect(normalizeTableCellAlign("none")).toBeNull();
    expect(normalizeTableCellAlign(null)).toBeNull();
  });

  it("builds shared table, row, and cell class attrs for HTML renderers", () => {
    expect(tableSurfaceAttrs(' data-source-from="1"'))
      .toBe(' class="cf-doc-table-block" data-source-from="1"');
    expect(tableRowSurfaceAttrs(' data-source-to="8"'))
      .toBe(' class="cf-doc-table-row" data-source-to="8"');
    expect(tableCellClassNames(true))
      .toBe("cf-doc-table-cell cf-doc-table-header");
    expect(tableCellClassNames(false))
      .toBe("cf-doc-table-cell");
    expect(tableCellSurfaceAttrs(true, "right"))
      .toBe(' class="cf-doc-table-cell cf-doc-table-header" data-align="right" style="text-align:right"');
    expect(renderTableCellHtml("td", "x", "none"))
      .toBe('<td class="cf-doc-table-cell">x</td>');
    expect(renderTableRowHtml("<td>x</td>", ' data-source-to="8"'))
      .toBe('<tr class="cf-doc-table-row" data-source-to="8"><td>x</td></tr>');
    expect(renderTableSurfaceHtml("<tbody></tbody>", ' data-source-from="1"'))
      .toBe('<table class="cf-doc-table-block" data-source-from="1"><tbody></tbody></table>');
  });

  it("applies the same surface contract to DOM table cells", () => {
    const table = createTableSurfaceElement(document);
    const row = createTableRowSurfaceElement(document);
    const cell = createTableCellElement(document, "th", "center");
    row.appendChild(cell);
    table.appendChild(row);

    expect(table.className).toBe("cf-doc-table-block");
    expect(row.className).toBe("cf-doc-table-row");
    expect(cell.className).toBe("cf-doc-table-cell cf-doc-table-header");
    expect(cell.dataset.align).toBe("center");
    expect(cell.style.textAlign).toBe("center");

    applyTableCellSurface(cell, false, null);
    expect(cell.className).toBe("cf-doc-table-cell");
    expect(cell.dataset.align).toBeUndefined();
    expect(cell.style.textAlign).toBe("");
  });
});
