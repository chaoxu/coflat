/**
 * Live-window plumbing for the table widget's active cell.
 *
 * The active cell hosts a subview whose state mirrors the root document
 * instead of a detached mini-document: everything outside the cell is hidden
 * with replace decorations, and a transaction filter clamps edits and
 * selection to the moving cell bounds. Subview transactions forward to the
 * root view (annotated as live cell edits) and root transactions forward back
 * into the subview, loop-guarded by {@link liveCellSyncAnnotation}. The
 * approach — including the mapping assocs and TrackBefore/TrackAfter deletion
 * detection — follows Zettlr's table-editor subview, but the clamp bounds are
 * seeded from coflat's authoritative pipe geometry ({@link findCellBounds})
 * rather than parser content bounds, so whitespace typed at either edge stays
 * inside the cell.
 */

import {
  Annotation,
  type ChangeSpec,
  EditorSelection,
  EditorState,
  type Extension,
  MapMode,
  type Range,
  StateField,
  Transaction,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { findCellBounds, type TableRange } from "./table-discovery";
import { cellEditAnnotation } from "./table-widget-controller";
import type { TableCellAddress } from "./table-widget-navigation";
import { getActiveInlineEditor } from "./table-widget-session";

/**
 * Loop guard for transactions synchronized between the root view and the
 * active cell's subview: tagged transactions are applied verbatim and never
 * re-forwarded.
 */
export const liveCellSyncAnnotation = Annotation.define<boolean>();

export interface LiveCellRange {
  readonly from: number;
  readonly to: number;
}

interface LiveCellWindowState {
  readonly decorations: DecorationSet;
  readonly cellRange: readonly [number, number];
}

/**
 * Hides the stretches of the mirrored document before and after the cell and
 * tracks the cell range as a moving target through document changes.
 */
const liveCellWindowField = StateField.define<LiveCellWindowState>({
  create(state) {
    // Callers must override via `init`; this default hides nothing.
    return {
      decorations: Decoration.none,
      cellRange: [0, state.doc.length],
    };
  },
  update(value, tr) {
    if (!tr.docChanged) return value;
    return {
      decorations: value.decorations.map(tr.changes),
      cellRange: [
        // The assocs make these true outer bounds: text inserted exactly at
        // an edge (including into an empty cell where from === to) stays
        // inside the mapped cell range instead of escaping past it.
        tr.changes.mapPos(value.cellRange[0], -1),
        tr.changes.mapPos(value.cellRange[1], 1),
      ],
    };
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
});

/**
 * Build the replace decorations that hide everything outside the cell:
 * a block before the cell's line, the line parts around the cell, and a
 * block after the cell's line. Zero-length ranges are skipped because CM6
 * disallows collapsed replace decorations.
 */
function createLiveCellHideDecorations(
  state: EditorState,
  cellRange: LiveCellRange,
): DecorationSet {
  const { from, to } = state.doc.lineAt(cellRange.from);
  const decorations: Range<Decoration>[] = [];

  if (from - 1 > 0) {
    decorations.push(
      Decoration.replace({ block: true, inclusive: true }).range(0, from - 1),
    );
  }
  if (cellRange.from > from) {
    decorations.push(
      Decoration.replace({ block: false, inclusive: false })
        .range(from, cellRange.from),
    );
  }
  if (to > cellRange.to) {
    decorations.push(
      Decoration.replace({ block: false, inclusive: false })
        .range(cellRange.to, to),
    );
  }
  if (state.doc.length > to + 1) {
    decorations.push(
      Decoration.replace({ block: true, inclusive: true })
        .range(to + 1, state.doc.length),
    );
  }

  return Decoration.set(decorations);
}

/**
 * Sanitize every non-synchronizing subview transaction so it never escapes
 * the cell: reject transactions that delete a cell boundary, clamp all
 * selection ranges (not just the main one) to the mapped bounds, drop changes
 * outside the cell, and flatten inserted newlines to spaces.
 */
const liveCellBoundariesFilter = EditorState.transactionFilter.of((tr) => {
  if (tr.annotation(liveCellSyncAnnotation) === true) {
    return tr; // Never interfere with synchronizing transactions.
  }

  // Map only the tracked bounds through the ChangeSet instead of recomputing
  // state. The field's range is seeded from pipe geometry and mapped with
  // outer assocs, so whitespace typed at an edge remains part of the cell.
  const [cellFrom, cellTo] = tr.startState.field(liveCellWindowField).cellRange;
  const mappedFrom = tr.changes.mapPos(cellFrom, -1, MapMode.TrackBefore);
  const mappedTo = tr.changes.mapPos(cellTo, 1, MapMode.TrackAfter);

  if (mappedFrom === null || mappedTo === null) {
    return []; // The change deletes a cell boundary; disallow it.
  }

  let newSelection = tr.selection;
  if (tr.selection !== undefined) {
    const anyOutOfBounds = tr.selection.ranges.some(
      (range) => range.from < mappedFrom || range.to > mappedTo,
    );
    if (anyOutOfBounds) {
      const clampedRanges = tr.selection.ranges.map((range) => {
        const clampedAnchor = Math.max(mappedFrom, Math.min(mappedTo, range.anchor));
        const clampedHead = Math.max(mappedFrom, Math.min(mappedTo, range.head));
        return EditorSelection.range(clampedAnchor, clampedHead);
      });
      newSelection = EditorSelection.create(clampedRanges, tr.selection.mainIndex);
    }
  }

  if (!tr.docChanged) {
    if (newSelection !== tr.selection) {
      return { ...tr, selection: newSelection };
    }
    return tr;
  }

  const safeChanges: ChangeSpec[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    // Only pass through changes within the cell boundaries. Table cells are
    // single-line, so inserted newlines are flattened to spaces.
    if (fromA >= cellFrom && toA <= cellTo) {
      safeChanges.push({
        from: fromA,
        to: toA,
        insert: inserted.toString().replace(/\n+/g, " "),
      });
    }
  });

  return { ...tr, changes: safeChanges, selection: newSelection };
});

/**
 * Extensions that turn a full-document mirror into a clamped window onto one
 * table cell.
 */
export function createLiveCellWindowExtensions(cellRange: LiveCellRange): Extension {
  return [
    liveCellWindowField.init((state) => ({
      decorations: createLiveCellHideDecorations(state, cellRange),
      cellRange: [cellRange.from, cellRange.to],
    })),
    liveCellBoundariesFilter,
  ];
}

/** Current (mapped) cell range of a live-window subview, if it hosts one. */
export function getLiveCellRange(view: EditorView): LiveCellRange | null {
  const window = view.state.field(liveCellWindowField, false);
  if (!window) return null;
  return { from: window.cellRange[0], to: window.cellRange[1] };
}

/**
 * Authoritative clamp bounds for a cell: derived from the document line's
 * pipe geometry (trimmed of padding spaces), not from parser content nodes.
 */
export function resolveLiveCellBounds(
  state: EditorState,
  table: TableRange,
  address: TableCellAddress,
): LiveCellRange | null {
  const lineIndex = address.section === "header" ? 0 : 2 + address.row;
  if (lineIndex >= table.lines.length) return null;
  const lineNumber = table.startLineNumber + lineIndex;
  if (lineNumber < 1 || lineNumber > state.doc.lines) return null;
  const line = state.doc.line(lineNumber);
  return findCellBounds(line.text, line.from, address.col);
}

function syncAnnotations(
  tr: Transaction,
  cellEdit?: "edit",
): Annotation<unknown>[] {
  const annotations: Annotation<unknown>[] = [liveCellSyncAnnotation.of(true)];
  if (cellEdit) {
    annotations.push(cellEditAnnotation.of(cellEdit));
  }
  const userEvent = tr.annotation(Transaction.userEvent);
  if (userEvent !== undefined) {
    annotations.push(Transaction.userEvent.of(userEvent));
  }
  return annotations;
}

/**
 * Dispatch routing for the subview: apply the transaction locally, then
 * forward document changes to the root view as annotated live cell edits so
 * they land in root history as granular steps without rebuilding the widget.
 */
export function createLiveCellSubviewDispatch(
  rootView: EditorView,
): (tr: Transaction, subview: EditorView) => void {
  return (tr, subview) => {
    subview.update([tr]);
    if (tr.annotation(liveCellSyncAnnotation) !== undefined || !tr.docChanged) {
      return;
    }
    rootView.dispatch({
      changes: tr.changes,
      annotations: syncAnnotations(tr, "edit"),
    });
  };
}

/**
 * Forward root-view document changes (undo/redo, other plugins' dispatches,
 * collaborative edits) into the active cell's subview so its mirror never
 * diverges. Registered as part of the table render extension on the root.
 */
export const liveCellMainSyncPlugin = EditorView.updateListener.of((update) => {
  const active = getActiveInlineEditor();
  if (!active?.rootView || active.rootView !== update.view) return;
  for (const tr of update.transactions) {
    if (tr.annotation(liveCellSyncAnnotation) !== undefined || !tr.docChanged) {
      continue;
    }
    active.view.dispatch({
      changes: tr.changes,
      annotations: syncAnnotations(tr),
    });
  }
});

/**
 * True when an unannotated root transaction is confined to the open live
 * cell's interior (undo/redo of in-cell edits, another plugin writing into
 * the cell). The table decoration field maps instead of rebuilding for such
 * transactions so the active session's DOM survives.
 */
export function isLiveCellInteriorChange(tr: Transaction): boolean {
  if (!tr.docChanged) return false;
  const active = getActiveInlineEditor();
  // The subview has not yet been synced when root state fields run, so its
  // tracked cell range is still in tr.startState coordinates.
  if (!active?.rootView || active.rootView.state !== tr.startState) return false;
  const range = active.getCellRange?.();
  if (!range) return false;
  let interior = true;
  tr.changes.iterChanges((fromA, toA) => {
    if (fromA < range.from || toA > range.to) interior = false;
  });
  return interior;
}
