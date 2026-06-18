import type { SyntaxNode } from "@lezer/common";
import { tableRenderPlan, type TableRowRenderPlan } from "../../core/block-render-plan";
import {
  createTableCellElement,
  createTableRowSurfaceElement,
  createTableSurfaceElement,
} from "../../core/table-surface";
import type { PreviewRenderContext } from "./preview-render-context";
import { renderInlineFragmentsToDom } from "./inline-render";

export function renderPreviewTable(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const plan = tableRenderPlan(context.doc, node);
  const table = createTableSurfaceElement(document);
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");

  if (plan.header) {
    thead.appendChild(renderTableRow(plan.header, context));
  }

  for (const row of plan.rows) {
    tbody.appendChild(renderTableRow(row, context));
  }

  if (thead.children.length > 0) {
    table.appendChild(thead);
  }
  if (tbody.children.length > 0) {
    table.appendChild(tbody);
  }
  parent.appendChild(table);
}

function renderTableRow(
  rowPlan: TableRowRenderPlan,
  context: PreviewRenderContext,
): HTMLTableRowElement {
  const row = createTableRowSurfaceElement(document);
  const tag = rowPlan.header ? "th" : "td";
  for (const cellPlan of rowPlan.cells) {
    const cell = createTableCellElement(document, tag, cellPlan.align);
    renderInlineFragmentsToDom(
      cell,
      cellPlan.fragments,
      context.macros,
      context.surfacePolicy.bodyInlineSurface,
      {
        ...context.referenceContext,
        imageUrlOverrides: context.imageUrlOverrides,
        footnoteNumbers: context.footnoteNumbers,
      },
    );
    row.appendChild(cell);
  }
  return row;
}
