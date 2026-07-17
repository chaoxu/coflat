/**
 * CM6 list outliner extension.
 *
 * This module owns fold/keymap wiring. Editing behavior lives in
 * list-outliner-commands so command semantics stay testable without carrying
 * extension setup in the same file.
 */

import {
  deleteMarkupBackward,
  insertNewlineContinueMarkup,
} from "@codemirror/lang-markdown";
import {
  codeFolding,
  foldGutter,
  foldKeymap,
  foldService,
  syntaxTree,
} from "@codemirror/language";
import { type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import {
  indentListItem,
  moveListItemDown,
  moveListItemUp,
  outdentListItem,
} from "./list-outliner-commands";
import { withListRenumber } from "./list-renumber";

export {
  outdentListItem,
} from "./list-outliner-commands";

// The item commands dispatch without a user-event tag, so the post-hoc
// renumber filter cannot see them; wrap them so ordered lists stay 1., 2., …
// after indent/outdent/move (see list-renumber.ts).
const indentListItemRenumbered = withListRenumber(indentListItem);
const outdentListItemRenumbered = withListRenumber(outdentListItem);
const moveListItemUpRenumbered = withListRenumber(moveListItemUp);
const moveListItemDownRenumbered = withListRenumber(moveListItemDown);

function hasNestedList(node: SyntaxNode): boolean {
  let child = node.firstChild;
  while (child) {
    if (child.name === "BulletList" || child.name === "OrderedList") {
      return true;
    }
    child = child.nextSibling;
  }
  return false;
}

const emptyListMarkerLineRe = /^(\s*)(?:[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)$/;
const listMarkerPrefixRe = /^(\s*)(?:[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)$/;

function exitEmptyListItem(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;

  const line = view.state.doc.lineAt(selection.head);
  if (selection.head !== line.to) return false;
  if (!emptyListMarkerLineRe.test(line.text)) return false;

  const insert = line.to === view.state.doc.length ? "\n" : "";
  view.dispatch({
    changes: { from: line.from, to: line.to, insert },
    selection: { anchor: line.from + insert.length },
    scrollIntoView: true,
  });
  return true;
}

function deleteListMarkerBackward(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;

  const line = view.state.doc.lineAt(selection.head);
  const beforeCursor = view.state.sliceDoc(line.from, selection.head);
  if (!listMarkerPrefixRe.test(beforeCursor)) return false;
  if (selection.head <= line.from) return false;

  view.dispatch({
    changes: { from: line.from, to: selection.head, insert: "" },
    selection: { anchor: line.from },
    scrollIntoView: true,
  });
  return true;
}

const listFoldService = foldService.of((state, lineStart, _lineEnd) => {
  const tree = syntaxTree(state);
  let node = tree.resolveInner(lineStart, 1);

  while (node) {
    if (node.name === "ListItem") {
      break;
    }
    if (node.parent) {
      node = node.parent;
    } else {
      return null;
    }
  }

  if (node.name !== "ListItem") return null;

  const itemLine = state.doc.lineAt(node.from);
  if (itemLine.from !== lineStart) return null;
  if (!hasNestedList(node)) return null;

  const foldFrom = itemLine.to;
  const foldTo = node.to;
  if (foldTo <= foldFrom) return null;

  return { from: foldFrom, to: foldTo };
});

const listOutlinerKeymap = Prec.highest(keymap.of([
  {
    key: "Tab",
    run: indentListItemRenumbered,
  },
  {
    key: "Shift-Tab",
    run: outdentListItemRenumbered,
  },
  {
    key: "Mod-Shift-ArrowUp",
    run: moveListItemUpRenumbered,
  },
  {
    key: "Mod-Shift-ArrowDown",
    run: moveListItemDownRenumbered,
  },
  {
    key: "Enter",
    run: (view) => exitEmptyListItem(view) || insertNewlineContinueMarkup(view),
  },
  {
    key: "Backspace",
    run: (view) => deleteListMarkerBackward(view) || deleteMarkupBackward(view),
  },
  ...foldKeymap,
]));

const listOutlinerDomHandlers: Extension = EditorView.domEventHandlers({
  keydown(event, view) {
    let handled = false;
    if (event.key === "Tab" && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      handled = outdentListItemRenumbered(view);
    }

    if (!handled) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  },
});

export const listOutlinerExtension: Extension = [
  listFoldService,
  codeFolding(),
  foldGutter(),
  Prec.highest(listOutlinerDomHandlers),
  listOutlinerKeymap,
];
