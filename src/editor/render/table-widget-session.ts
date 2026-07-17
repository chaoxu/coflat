import type { EditorView } from "@codemirror/view";
import { CSS } from "../../core/constants/css-classes";
import type { InlineEditorController } from "../inline-editor";
import type { TableRange } from "./table-discovery";
import type { TableBoundaryHandoffDirection } from "./table-widget-navigation";

export interface TableWidgetSessionOwner {
  applyLocalCellEdit(cell: HTMLElement, content: string): void;
  commitRenderedCell(cell: HTMLElement, content: string): void;
  /** Live-window session end: the document already holds the edits, so only
   *  the rendered preview needs restoring plus a widget rebuild dispatch. */
  refreshRenderedCell(cell: HTMLElement, content: string): void;
  focusRootOutsideTable(direction: TableBoundaryHandoffDirection): boolean;
  focusRootOutsideTableWithRange(
    rootView: EditorView,
    tableRange: TableRange,
    direction: TableBoundaryHandoffDirection,
  ): boolean;
}

export interface ActiveInlineEditor {
  readonly controller: InlineEditorController;
  readonly view: EditorView;
  readonly cell: HTMLElement;
  readonly owner: TableWidgetSessionOwner;
  /** Root view mirrored by a live-window session; null/absent when the
   *  editor holds a detached mini-document. */
  readonly rootView?: EditorView | null;
  /** Current (mapped) cell range inside the mirrored document. */
  readonly getCellRange?: () => { from: number; to: number } | null;
}

export interface DestroyedInlineEditor {
  readonly text: string;
  readonly cell: HTMLElement;
  readonly owner: TableWidgetSessionOwner;
  readonly controller: InlineEditorController;
  /** True when the session was a live window (text is already in the doc). */
  readonly live: boolean;
}

interface ActivePreviewCell {
  readonly cell: HTMLElement;
  readonly owner: TableWidgetSessionOwner;
}

let activeInlineEditor: ActiveInlineEditor | null = null;
let activePreviewCell: ActivePreviewCell | null = null;

function focusWithoutScrolling(element: HTMLElement): void {
  try {
    element.focus({ preventScroll: true });
  } catch (_error) {
    element.focus();
  }
}

export function getActiveInlineEditor(): ActiveInlineEditor | null {
  return activeInlineEditor;
}

export function setActiveInlineEditor(editor: ActiveInlineEditor): void {
  activeInlineEditor = editor;
}

export function isActiveInlineCell(cell: HTMLElement): boolean {
  return activeInlineEditor?.cell === cell;
}

export function destroyActiveInlineEditor(): DestroyedInlineEditor | null {
  if (!activeInlineEditor) return null;
  const { controller, view: inlineView, cell, owner } = activeInlineEditor;
  const live = activeInlineEditor.rootView != null;
  const cellRange = activeInlineEditor.getCellRange?.() ?? null;
  const text = cellRange
    ? inlineView.state.sliceDoc(cellRange.from, cellRange.to)
    : live
      ? ""
      : inlineView.state.doc.toString();
  cell.classList.remove(CSS.tableCellEditing);
  cell.style.removeProperty("width");
  cell.style.removeProperty("min-width");
  cell.style.removeProperty("max-width");
  cell.style.removeProperty("min-height");
  controller.destroy();
  cell.innerHTML = "";
  activeInlineEditor = null;
  return { text, cell, owner, controller, live };
}

export function commitDestroyedInlineEditor(destroyed: DestroyedInlineEditor): void {
  if (destroyed.live) {
    destroyed.owner.refreshRenderedCell(destroyed.cell, destroyed.text);
    return;
  }
  destroyed.owner.commitRenderedCell(destroyed.cell, destroyed.text);
}

export function restoreDestroyedInlineEditorLocally(
  destroyed: DestroyedInlineEditor,
  fallbackOwner: TableWidgetSessionOwner,
): void {
  if (destroyed.owner === fallbackOwner) {
    destroyed.owner.applyLocalCellEdit(destroyed.cell, destroyed.text);
    return;
  }
  commitDestroyedInlineEditor(destroyed);
}

export function clearActivePreviewCell(): void {
  if (!activePreviewCell) return;
  activePreviewCell.cell.classList.remove(CSS.tableCellActive);
  activePreviewCell.cell.removeAttribute("tabindex");
  activePreviewCell = null;
}

export function setActivePreviewCell(
  cell: HTMLElement,
  owner: TableWidgetSessionOwner,
): void {
  if (activePreviewCell?.cell === cell && activePreviewCell.owner === owner) {
    focusWithoutScrolling(cell);
    return;
  }
  clearActivePreviewCell();
  cell.classList.add(CSS.tableCellActive);
  cell.tabIndex = -1;
  focusWithoutScrolling(cell);
  activePreviewCell = { cell, owner };
}

export function isActivePreviewCell(
  cell: HTMLElement,
  owner: TableWidgetSessionOwner,
): boolean {
  return activePreviewCell?.cell === cell && activePreviewCell.owner === owner;
}

export function shouldCommitBlurredInlineEditor(
  snapshot: ActiveInlineEditor | null,
  current: ActiveInlineEditor | null,
  cell: HTMLElement,
): snapshot is ActiveInlineEditor {
  return snapshot !== null && current === snapshot && snapshot.cell === cell;
}

export function transferTableWidgetSessionOwner(
  from: TableWidgetSessionOwner,
  to: TableWidgetSessionOwner,
): void {
  if (activeInlineEditor?.owner === from) {
    activeInlineEditor = {
      ...activeInlineEditor,
      owner: to,
    };
  }
  if (activePreviewCell?.owner === from) {
    activePreviewCell = {
      ...activePreviewCell,
      owner: to,
    };
  }
}

export function destroyInlineEditorForOwner(owner: TableWidgetSessionOwner): void {
  if (activeInlineEditor?.owner === owner) {
    destroyActiveInlineEditor();
  }
}

export function clearPreviewCellForOwner(owner: TableWidgetSessionOwner): void {
  if (activePreviewCell?.owner === owner) {
    clearActivePreviewCell();
  }
}
