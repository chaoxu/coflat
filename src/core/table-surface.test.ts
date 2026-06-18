import { describe, expect, it } from "vitest";
import { parseMarkdownSource } from "./parser";
import { tableRenderPlan } from "./block-render-plan";
import {
  applyTableCellSurface,
  createTablePlanElement,
  createTableCellElement,
  createTableRowSurfaceElement,
  createTableSurfaceElement,
  normalizeTableCellAlign,
  renderTablePlanHtml,
  renderTableCellHtml,
  renderTableRowHtml,
  renderTableSurfaceHtml,
  tableCellClassNames,
  tableCellSurfaceAttrs,
  tableRowSurfaceAttrs,
  tableSurfaceAttrs,
} from "./table-surface";

function firstTable(source: string) {
  const tree = parseMarkdownSource(source, "html-render");
  let table = tree.topNode.firstChild;
  while (table && table.name !== "Table") table = table.nextSibling;
  if (!table) throw new Error("missing table");
  return table;
}

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

  it("renders a table plan skeleton for HTML emitters", () => {
    const source = [
      "| A | B |",
      "| :- | -: |",
      "| 1 | 2 | 3 |",
      "| 4 |",
    ].join("\n");
    const plan = tableRenderPlan(source, firstTable(source));

    expect(renderTablePlanHtml(plan, {
      tableAttrs: ' data-source-from="0"',
      rowAttrs: (row) => ` data-row-from="${row.sourceRange.from}"`,
      renderCell: (cell) => source.slice(cell.sourceRange.from, cell.sourceRange.to),
    })).toBe(
      '<table class="cf-doc-table-block" data-source-from="0"><thead>'
      + '<tr class="cf-doc-table-row" data-row-from="0">'
      + '<th class="cf-doc-table-cell cf-doc-table-header" data-align="left" style="text-align:left">A</th>'
      + '<th class="cf-doc-table-cell cf-doc-table-header" data-align="right" style="text-align:right">B</th>'
      + '</tr></thead><tbody>'
      + '<tr class="cf-doc-table-row" data-row-from="22">'
      + '<td class="cf-doc-table-cell" data-align="left" style="text-align:left">1</td>'
      + '<td class="cf-doc-table-cell" data-align="right" style="text-align:right">2</td>'
      + '<td class="cf-doc-table-cell">3</td>'
      + '</tr>'
      + '<tr class="cf-doc-table-row" data-row-from="36">'
      + '<td class="cf-doc-table-cell" data-align="left" style="text-align:left">4</td>'
      + '</tr></tbody></table>',
    );
  });

  it("renders a table plan skeleton for DOM emitters", () => {
    const source = "| A |\n|---|";
    const plan = tableRenderPlan(source, firstTable(source));
    const table = createTablePlanElement(document, plan, (cell, cellPlan) => {
      cell.textContent = source.slice(cellPlan.sourceRange.from, cellPlan.sourceRange.to);
    }, {
      applyTableAttrs: (tableEl, tablePlan) => {
        tableEl.dataset.sourceFrom = String(tablePlan.sourceRange.from);
      },
      applyRowAttrs: (row, rowPlan) => {
        row.dataset.rowFrom = String(rowPlan.sourceRange.from);
      },
    });

    expect(table.outerHTML).toBe(
      '<table class="cf-doc-table-block" data-source-from="0"><thead><tr class="cf-doc-table-row" data-row-from="0">'
      + '<th class="cf-doc-table-cell cf-doc-table-header">A</th>'
      + "</tr></thead></table>",
    );
  });
});
