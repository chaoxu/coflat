import type { SyntaxNode } from "@lezer/common";
import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "../../core/document-surface-classes";
import { parseTableDelimiterAlignments } from "../../core/parser/table";
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
  const table = document.createElement("table");
  table.className = DOCUMENT_SURFACE_CLASS.tableBlock;
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
  table.appendChild(tbody);
  parent.appendChild(table);
}

function renderTableRow(
  cells: readonly SyntaxNode[],
  tag: "th" | "td",
  alignments: readonly (string | null)[],
  context: PreviewRenderContext,
): HTMLTableRowElement {
  const row = document.createElement("tr");
  row.className = DOCUMENT_SURFACE_CLASS.tableRow;
  for (let index = 0; index < alignments.length; index += 1) {
    const cell = document.createElement(tag);
    cell.className = documentSurfaceClassNames(
      DOCUMENT_SURFACE_CLASS.tableCell,
      tag === "th" && DOCUMENT_SURFACE_CLASS.tableHeader,
    );
    const align = alignments[index];
    if (align) {
      cell.dataset.align = align;
      cell.style.textAlign = align;
    }
    const cellNode = cells[index];
    if (cellNode) {
      renderInlineSyntaxNodeToDom(
        cell,
        cellNode,
        context.doc,
        context.macros,
        "document-body",
        context.referenceContext,
      );
    }
    row.appendChild(cell);
  }
  return row;
}
