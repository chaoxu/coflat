import type {
  TableCellRenderPlan,
  TableRenderPlan,
  TableRowRenderPlan,
} from "./block-render-plan";
import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "./document-surface-classes";

export type TableCellAlign = "left" | "center" | "right";

export function normalizeTableCellAlign(
  align: string | null | undefined,
): TableCellAlign | null {
  return align === "left" || align === "center" || align === "right"
    ? align
    : null;
}

export function tableCellClassNames(isHeader: boolean): string {
  return documentSurfaceClassNames(
    DOCUMENT_SURFACE_CLASS.tableCell,
    isHeader && DOCUMENT_SURFACE_CLASS.tableHeader,
  );
}

export function tableCellSurfaceAttrs(
  isHeader: boolean,
  align: string | null | undefined,
): string {
  const normalizedAlign = normalizeTableCellAlign(align);
  const alignAttrs = normalizedAlign
    ? ` data-align="${normalizedAlign}" style="text-align:${normalizedAlign}"`
    : "";
  return ` class="${tableCellClassNames(isHeader)}"${alignAttrs}`;
}

export function applyTableCellSurface(
  cell: HTMLElement,
  isHeader: boolean,
  align: string | null | undefined,
): void {
  const normalizedAlign = normalizeTableCellAlign(align);
  cell.className = tableCellClassNames(isHeader);
  if (normalizedAlign) {
    cell.dataset.align = normalizedAlign;
    cell.style.textAlign = normalizedAlign;
  } else {
    delete cell.dataset.align;
    cell.style.textAlign = "";
  }
}

export function createTableCellElement(
  ownerDocument: Document,
  tag: "th" | "td",
  align: string | null | undefined,
): HTMLTableCellElement {
  const cell = ownerDocument.createElement(tag);
  applyTableCellSurface(cell, tag === "th", align);
  return cell;
}

export function createTableSurfaceElement(
  ownerDocument: Document = document,
): HTMLTableElement {
  const table = ownerDocument.createElement("table");
  table.className = DOCUMENT_SURFACE_CLASS.tableBlock;
  return table;
}

export function createTableRowSurfaceElement(
  ownerDocument: Document = document,
): HTMLTableRowElement {
  const row = ownerDocument.createElement("tr");
  row.className = DOCUMENT_SURFACE_CLASS.tableRow;
  return row;
}

export function tableRowSurfaceAttrs(attrs = ""): string {
  return ` class="${DOCUMENT_SURFACE_CLASS.tableRow}"${attrs}`;
}

export function tableSurfaceAttrs(attrs = ""): string {
  return ` class="${DOCUMENT_SURFACE_CLASS.tableBlock}"${attrs}`;
}

export function renderTableSurfaceHtml(innerHtml: string, attrs = ""): string {
  return `<table${tableSurfaceAttrs(attrs)}>${innerHtml}</table>`;
}

export function renderTableRowHtml(innerHtml: string, attrs = ""): string {
  return `<tr${tableRowSurfaceAttrs(attrs)}>${innerHtml}</tr>`;
}

export function renderTableCellHtml(
  tag: "th" | "td",
  innerHtml: string,
  align: string | null | undefined,
): string {
  return `<${tag}${tableCellSurfaceAttrs(tag === "th", align)}>${innerHtml}</${tag}>`;
}

export function createTablePlanElement(
  ownerDocument: Document,
  plan: TableRenderPlan,
  renderCellContent: (
    cell: HTMLTableCellElement,
    cellPlan: TableCellRenderPlan,
    rowPlan: TableRowRenderPlan,
  ) => void,
  options: {
    readonly applyTableAttrs?: (table: HTMLTableElement, plan: TableRenderPlan) => void;
    readonly applyRowAttrs?: (row: HTMLTableRowElement, rowPlan: TableRowRenderPlan) => void;
  } = {},
): HTMLTableElement {
  const table = createTableSurfaceElement(ownerDocument);
  options.applyTableAttrs?.(table, plan);
  const thead = ownerDocument.createElement("thead");
  const tbody = ownerDocument.createElement("tbody");

  if (plan.header) {
    thead.appendChild(createTablePlanRowElement(ownerDocument, plan.header, renderCellContent, options));
  }
  for (const row of plan.rows) {
    tbody.appendChild(createTablePlanRowElement(ownerDocument, row, renderCellContent, options));
  }

  if (thead.children.length > 0) table.appendChild(thead);
  if (tbody.children.length > 0) table.appendChild(tbody);
  return table;
}

function createTablePlanRowElement(
  ownerDocument: Document,
  rowPlan: TableRowRenderPlan,
  renderCellContent: (
    cell: HTMLTableCellElement,
    cellPlan: TableCellRenderPlan,
    rowPlan: TableRowRenderPlan,
  ) => void,
  options: {
    readonly applyRowAttrs?: (row: HTMLTableRowElement, rowPlan: TableRowRenderPlan) => void;
  },
): HTMLTableRowElement {
  const row = createTableRowSurfaceElement(ownerDocument);
  options.applyRowAttrs?.(row, rowPlan);
  const tag = rowPlan.header ? "th" : "td";
  for (const cellPlan of rowPlan.cells) {
    const cell = createTableCellElement(ownerDocument, tag, cellPlan.align);
    renderCellContent(cell, cellPlan, rowPlan);
    row.appendChild(cell);
  }
  return row;
}

export function renderTablePlanHtml(
  plan: TableRenderPlan,
  options: {
    readonly tableAttrs?: string;
    readonly rowAttrs?: (rowPlan: TableRowRenderPlan) => string;
    readonly renderCell: (
      cellPlan: TableCellRenderPlan,
      rowPlan: TableRowRenderPlan,
    ) => string;
  },
): string {
  const headerRowsHtml = plan.header
    ? [renderTablePlanRowHtml(plan.header, options)]
    : [];
  const bodyRowsHtml = plan.rows.map((row) => renderTablePlanRowHtml(row, options));
  let inner = "";
  if (headerRowsHtml.length) inner += `<thead>${headerRowsHtml.join("")}</thead>`;
  if (bodyRowsHtml.length) inner += `<tbody>${bodyRowsHtml.join("")}</tbody>`;
  return renderTableSurfaceHtml(inner, options.tableAttrs ?? "");
}

function renderTablePlanRowHtml(
  rowPlan: TableRowRenderPlan,
  options: {
    readonly rowAttrs?: (rowPlan: TableRowRenderPlan) => string;
    readonly renderCell: (
      cellPlan: TableCellRenderPlan,
      rowPlan: TableRowRenderPlan,
    ) => string;
  },
): string {
  const tag = rowPlan.header ? "th" : "td";
  const cells = rowPlan.cells.map((cell) =>
    renderTableCellHtml(tag, options.renderCell(cell, rowPlan), cell.align)
  );
  return renderTableRowHtml(cells.join(""), options.rowAttrs?.(rowPlan) ?? "");
}
