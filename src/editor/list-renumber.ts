/**
 * Ordered-list renumbering after structural list commands.
 *
 * Port of Zettlr's post-hoc list sanitation (commands/lists.ts): structural
 * commands (move line, indent, dedent) stay list-unaware; afterwards the
 * touched top-level lists are re-read from the syntax tree and fix-up changes
 * renumber ordered items (1., 2., ...) per nesting level and normalize
 * markers across marker-split sibling lists on the same level (CommonMark
 * starts a new list when the delimiter or bullet symbol changes mid-list, so
 * unifying the markers re-merges those fragments on the next parse).
 *
 * Wiring (integrator): append `listRenumberExtension` to the editor extension
 * list. It merges fix-ups into the same dispatch for transactions tagged with
 * the standard CM6 structural user events ("move.line", "input.indent",
 * "delete.dedent") emitted by `moveLineUp`/`moveLineDown`/`indentMore`/
 * `indentLess`. Commands that dispatch without a user-event tag are covered
 * by wrapping them with `withListRenumber` (list-outliner does this for its
 * Tab / Shift-Tab / move-item keybindings) or by registering
 * `renumberListsCommand` as an explicit command.
 */

import { syntaxTree } from "@codemirror/language";
import {
  type ChangeSpec,
  EditorState,
  type Extension,
  Transaction,
} from "@codemirror/state";
import type { Command } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/** User event tagged onto renumber fix-up dispatches from the command paths. */
export const listRenumberUserEvent = "input.format.renumber";

/**
 * Standard CM6 user events emitted by structural commands after which lists
 * may need renumbering.
 */
const structuralUserEvents = ["move.line", "input.indent", "delete.dedent"];

/** A document range that may contain lists needing fix-ups. */
export interface RenumberRange {
  readonly from: number;
  readonly to: number;
}

const orderedMarkRe = /^\d+([.)])$/;

function directListItems(list: SyntaxNode): SyntaxNode[] {
  const items: SyntaxNode[] = [];
  for (let child = list.firstChild; child; child = child.nextSibling) {
    if (child.name === "ListItem") items.push(child);
  }
  return items;
}

function listMarkOf(item: SyntaxNode): SyntaxNode | null {
  return item.getChild("ListMark");
}

/**
 * Renumber a run of same-level sibling OrderedList fragments. A run is
 * usually a single list; it has multiple entries when a delimiter change
 * split one visual level into sibling nodes ("1." followed by "1)"). The
 * first item determines the delimiter for the whole level, and numbering
 * continues across fragments so they merge back into one list.
 *
 * NOTE: Like Zettlr, this deliberately restarts numbering at 1 regardless of
 * the previous start number, because a swap command may leave a 2 above a 1.
 */
function renumberOrderedRun(
  state: EditorState,
  run: readonly SyntaxNode[],
  changes: ChangeSpec[],
): void {
  let delimiter: string | null = null;
  let idx = 1;
  for (const list of run) {
    for (const item of directListItems(list)) {
      const mark = listMarkOf(item);
      if (mark) {
        const text = state.sliceDoc(mark.from, mark.to);
        const match = orderedMarkRe.exec(text);
        if (match) {
          delimiter ??= match[1];
          const desired = `${idx}${delimiter}`;
          if (text !== desired) {
            changes.push({ from: mark.from, to: mark.to, insert: desired });
          }
        }
      }
      idx++;
      fixNestedLists(state, item, changes);
    }
  }
}

/**
 * Normalize a run of same-level sibling BulletList fragments to the first
 * fragment's bullet symbol. Within a single fragment all markers already
 * share one symbol (a symbol change is what splits fragments), so this only
 * emits changes for the later fragments of a split level.
 */
function normalizeBulletRun(
  state: EditorState,
  run: readonly SyntaxNode[],
  changes: ChangeSpec[],
): void {
  let symbol: string | null = null;
  for (const list of run) {
    for (const item of directListItems(list)) {
      const mark = listMarkOf(item);
      if (mark) {
        const text = state.sliceDoc(mark.from, mark.to);
        symbol ??= text;
        if (text !== symbol) {
          changes.push({ from: mark.from, to: mark.to, insert: symbol });
        }
      }
      fixNestedLists(state, item, changes);
    }
  }
}

/** Collect the direct child lists of a list item and fix each level's run. */
function fixNestedLists(
  state: EditorState,
  item: SyntaxNode,
  changes: ChangeSpec[],
): void {
  const ordered: SyntaxNode[] = [];
  const bullets: SyntaxNode[] = [];
  for (let child = item.firstChild; child; child = child.nextSibling) {
    if (child.name === "OrderedList") ordered.push(child);
    else if (child.name === "BulletList") bullets.push(child);
  }
  if (ordered.length > 0) renumberOrderedRun(state, ordered, changes);
  if (bullets.length > 0) normalizeBulletRun(state, bullets, changes);
}

/**
 * Find every topmost list node touched by the given ranges. Nested lists are
 * handled recursively by the per-level walk, so iteration stops at the first
 * list node on each path while still descending through containers such as
 * blockquotes and fenced divs.
 */
function fetchTopLists(
  state: EditorState,
  ranges: readonly RenumberRange[],
): SyntaxNode[] {
  const tree = syntaxTree(state);
  const seen = new Set<number>();
  const lists: SyntaxNode[] = [];
  for (const range of ranges) {
    tree.iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name === "OrderedList" || node.name === "BulletList") {
          if (!seen.has(node.from)) {
            seen.add(node.from);
            lists.push(node.node);
          }
          return false;
        }
        return undefined;
      },
    });
  }
  return lists;
}

/**
 * Pure helper: compute the fix-up changes needed to renumber and normalize
 * every list touched by `ranges`. Returns an empty array when the touched
 * lists are already consistent (making the operation idempotent) or when the
 * ranges contain no lists.
 */
export function renumberListsInRanges(
  state: EditorState,
  ranges: readonly RenumberRange[],
): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  for (const list of fetchTopLists(state, ranges)) {
    if (list.name === "OrderedList") {
      renumberOrderedRun(state, [list], changes);
    } else {
      normalizeBulletRun(state, [list], changes);
    }
  }
  return changes;
}

/**
 * Command: renumber the lists touched by the current selection. Returns
 * false when no fix-ups are needed so keymap fallthrough keeps working.
 */
export const renumberListsCommand: Command = (view) => {
  const changes = renumberListsInRanges(view.state, view.state.selection.ranges);
  if (changes.length === 0) return false;
  view.dispatch({ changes, userEvent: listRenumberUserEvent });
  return true;
};

/**
 * Wrap a structural command so that, after it handles the key, any list
 * touched by the resulting selection is renumbered in a follow-up dispatch.
 * This is the hook for commands that dispatch without a user-event tag
 * (list-outliner's item commands); tagged commands are covered by
 * `listRenumberExtension` instead.
 */
export function withListRenumber(command: Command): Command {
  return (view) => {
    if (!command(view)) return false;
    const changes = renumberListsInRanges(view.state, view.state.selection.ranges);
    if (changes.length > 0) {
      view.dispatch({ changes, userEvent: listRenumberUserEvent });
    }
    return true;
  };
}

/**
 * Transaction filter that appends list fix-ups, in the same dispatch, to any
 * document-changing transaction tagged with a structural user event. The
 * fix-ups are computed against the post-change document and merged
 * sequentially, so the triggering command needs no list awareness and undo
 * reverts command and renumbering together.
 */
export const listRenumberExtension: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  const userEvent = tr.annotation(Transaction.userEvent);
  const isStructural = userEvent !== undefined && structuralUserEvents.some(
    (event) => userEvent === event || userEvent.startsWith(`${event}.`),
  );
  if (!isStructural) return tr;

  const ranges: RenumberRange[] = [];
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    ranges.push({ from: fromB, to: toB });
  });
  for (const range of tr.newSelection.ranges) {
    ranges.push({ from: range.from, to: range.to });
  }

  const changes = renumberListsInRanges(tr.state, ranges);
  if (changes.length === 0) return tr;

  return [tr, { changes, sequential: true }];
});
