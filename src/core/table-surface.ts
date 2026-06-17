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

export function createTableSurfaceElement(): HTMLTableElement {
  const table = document.createElement("table");
  table.className = DOCUMENT_SURFACE_CLASS.tableBlock;
  return table;
}

export function createTableRowSurfaceElement(): HTMLTableRowElement {
  const row = document.createElement("tr");
  row.className = DOCUMENT_SURFACE_CLASS.tableRow;
  return row;
}

export function tableRowSurfaceAttrs(attrs = ""): string {
  return ` class="${DOCUMENT_SURFACE_CLASS.tableRow}"${attrs}`;
}

export function tableSurfaceAttrs(attrs = ""): string {
  return ` class="${DOCUMENT_SURFACE_CLASS.tableBlock}"${attrs}`;
}

export function renderTableCellHtml(
  tag: "th" | "td",
  innerHtml: string,
  align: string | null | undefined,
): string {
  return `<${tag}${tableCellSurfaceAttrs(tag === "th", align)}>${innerHtml}</${tag}>`;
}
