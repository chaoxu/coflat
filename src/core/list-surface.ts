import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "./document-surface-classes";
import { CSS } from "./constants/css-classes";

export interface ListSurfaceOptions {
  readonly ordered: boolean;
  readonly task: boolean;
  readonly loose: boolean;
}

export interface ListItemSurfaceOptions {
  readonly ordered: boolean;
  readonly task: boolean;
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
