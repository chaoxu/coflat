/**
 * List-shape rules shared by the reader and the editor preview renderer so
 * the two emission pipelines cannot drift (locked together by
 * preview-reader-parity.test.ts).
 */
import type { SyntaxNode } from "@lezer/common";
import { NODE } from "../constants/node-types";

/** A list is loose when a blank line separates any two sibling items. */
export function isLooseListNode(node: SyntaxNode, doc: string): boolean {
  let prevItem: SyntaxNode | null = null;
  let child = node.firstChild;
  while (child) {
    if (child.name === NODE.ListItem) {
      if (prevItem && /\n\s*\n/.test(doc.slice(prevItem.to, child.from))) return true;
      prevItem = child;
    }
    child = child.nextSibling;
  }
  return false;
}

/** Start number of an ordered list, read from the first item's marker. */
export function orderedListStartNumber(node: SyntaxNode, doc: string): number {
  const mark = node.getChild(NODE.ListItem)?.getChild(NODE.ListMark);
  if (!mark) return 1;
  const n = parseInt(doc.slice(mark.from, mark.to).match(/(\d+)/)?.[1] ?? "", 10);
  return Number.isNaN(n) ? 1 : n;
}
