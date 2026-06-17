import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "./document-surface-classes";
import { CSS } from "./constants/css-classes";

export interface ListSurfaceOptions {
  readonly ordered: boolean;
  readonly task: boolean;
  readonly loose: boolean;
  readonly start?: number;
}

export interface ListItemSurfaceOptions {
  readonly ordered: boolean;
  readonly task: boolean;
  readonly checked?: boolean;
}

export function listSurfaceClassNames(options: ListSurfaceOptions): string {
  return documentSurfaceClassNames(
    DOCUMENT_SURFACE_CLASS.list,
    options.ordered
      ? DOCUMENT_SURFACE_CLASS.listOrdered
      : DOCUMENT_SURFACE_CLASS.listUnordered,
    options.task && DOCUMENT_SURFACE_CLASS.listCheck,
    options.loose
      ? DOCUMENT_SURFACE_CLASS.listLoose
      : DOCUMENT_SURFACE_CLASS.listTight,
  );
}

export function listItemSurfaceClassNames(options: ListItemSurfaceOptions): string {
  return documentSurfaceClassNames(
    DOCUMENT_SURFACE_CLASS.listItem,
    options.task && DOCUMENT_SURFACE_CLASS.listItemCheck,
  );
}

export function editorListItemLineClassNames(options: ListItemSurfaceOptions): string {
  return documentSurfaceClassNames(
    listSurfaceClassNames({
      ordered: options.ordered,
      task: options.task,
      loose: false,
    }),
    listItemSurfaceClassNames(options),
  );
}

export function listMarkerClassName(ordered: boolean): string {
  return ordered ? CSS.listNumber : CSS.listBullet;
}

export function listMarkerText(ordered: boolean, number: number): string {
  return ordered ? `${number}.` : "•";
}

export function listTagName(ordered: boolean): "ol" | "ul" {
  return ordered ? "ol" : "ul";
}

export function renderListSurfaceHtml(
  options: ListSurfaceOptions,
  innerHtml: string,
  attrs = "",
): string {
  const tag = listTagName(options.ordered);
  const startAttr = options.ordered && options.start !== undefined && options.start !== 1
    ? ` start="${options.start}"`
    : "";
  return (
    `<${tag} class="${listSurfaceClassNames(options)}"${startAttr}${attrs}>` +
    innerHtml +
    `</${tag}>`
  );
}

export function createListSurfaceElement(
  ownerDocument: Document,
  options: ListSurfaceOptions,
): HTMLOListElement | HTMLUListElement {
  const list = ownerDocument.createElement(listTagName(options.ordered));
  list.className = listSurfaceClassNames(options);
  if (options.ordered && options.start !== undefined && options.start !== 1) {
    list.setAttribute("start", String(options.start));
  }
  return list;
}

export function renderListMarkerHtml(ordered: boolean, number: number): string {
  return `<span class="${listMarkerClassName(ordered)}">${listMarkerText(ordered, number)}</span> `;
}

export function appendListMarker(
  parent: HTMLElement,
  ordered: boolean,
  number: number,
): void {
  const marker = parent.ownerDocument.createElement("span");
  marker.className = listMarkerClassName(ordered);
  marker.textContent = listMarkerText(ordered, number);
  parent.appendChild(marker);
  parent.appendChild(parent.ownerDocument.createTextNode(" "));
}

export function renderListItemSurfaceHtml(
  options: ListItemSurfaceOptions,
  markerNumber: number,
  innerHtml: string,
  attrs = "",
): string {
  const checkedAttr = options.checked === undefined
    ? ""
    : ` data-checked="${options.checked}"`;
  return (
    `<li class="${listItemSurfaceClassNames(options)}"${checkedAttr}${attrs}>` +
    renderListMarkerHtml(options.ordered, markerNumber) +
    innerHtml +
    `</li>`
  );
}

export function createListItemSurfaceElement(
  ownerDocument: Document,
  options: ListItemSurfaceOptions,
): HTMLLIElement {
  const item = ownerDocument.createElement("li");
  item.className = listItemSurfaceClassNames(options);
  if (options.checked !== undefined) {
    item.dataset.checked = String(options.checked);
  }
  return item;
}

export function taskMarkerChecked(markerText: string): boolean {
  return /\[[xX]\]/.test(markerText);
}

export function renderReadOnlyTaskCheckboxHtml(checked: boolean): string {
  return `<input type="checkbox" tabindex="-1" aria-disabled="true"${checked ? " checked" : ""}>`;
}

export function createReadOnlyTaskCheckboxElement(
  ownerDocument: Document,
  checked: boolean,
): HTMLInputElement {
  const input = ownerDocument.createElement("input");
  input.type = "checkbox";
  input.tabIndex = -1;
  input.setAttribute("aria-disabled", "true");
  input.checked = checked;
  return input;
}

export function appendReadOnlyTaskCheckbox(
  parent: HTMLElement,
  checked: boolean,
): void {
  parent.appendChild(createReadOnlyTaskCheckboxElement(parent.ownerDocument, checked));
  parent.appendChild(parent.ownerDocument.createTextNode(" "));
}
