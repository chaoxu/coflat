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
