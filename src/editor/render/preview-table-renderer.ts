import type { SyntaxNode } from "@lezer/common";
import { parseTableDelimiterAlignments } from "../../core/parser/table";
import {
  createTableCellElement,
  createTableRowSurfaceElement,
  createTableSurfaceElement,
} from "../../core/table-surface";
import type { PreviewRenderContext } from "./preview-render-context";
import { renderInlineSyntaxNodeToDom } from "./inline-render";

export function renderPreviewTable(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const delimiterNode = node.getChild("TableDelimiter");
  if (!delimiterNode) return;

  const alignments = parseTableDelimiterAlignments(
    context.doc.slice(delimiterNode.from, delimiterNode.to),
  );
  const headerNode = node.getChild("TableHeader");
  const headerCells = headerNode?.getChildren("TableCell") ?? [];
  const table = createTableSurfaceElement(document);
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");

  thead.appendChild(renderTableRow(headerCells, "th", alignments, context));

  let child = node.firstChild;
  while (child) {
    if (child.name === "TableRow") {
      tbody.appendChild(renderTableRow(child.getChildren("TableCell"), "td", alignments, context));
    }
    child = child.nextSibling;
  }

  table.appendChild(thead);
  if (tbody.children.length > 0) {
    table.appendChild(tbody);
  }
  parent.appendChild(table);
}

function renderTableRow(
  cells: readonly SyntaxNode[],
  tag: "th" | "td",
  alignments: readonly (string | null)[],
  context: PreviewRenderContext,
): HTMLTableRowElement {
  const row = createTableRowSurfaceElement(document);
  for (let index = 0; index < cells.length; index += 1) {
    const cell = createTableCellElement(document, tag, alignments[index]);
    const cellNode = cells[index];
    renderInlineSyntaxNodeToDom(
      cell,
      cellNode,
      context.doc,
      context.macros,
      "document-body",
      context.referenceContext,
    );
    row.appendChild(cell);
  }
  return row;
}
