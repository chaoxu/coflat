import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

export function selectionIntersectsRange(
  state: EditorState,
  from: number,
  to: number,
  focused: boolean,
): boolean {
  if (!focused) return false;
  return state.selection.ranges.some((range) => (
    range.empty
      ? from <= range.from && range.from <= to
      : range.from < to && from < range.to
  ));
}

export function isTopLevelBlockquote(node: SyntaxNode): boolean {
  return node.name === "Blockquote" && node.parent?.name === "Document";
}

export function shouldRenderBlockquoteAsFlow(
  state: EditorState,
  node: SyntaxNode,
  focused: boolean,
): boolean {
  return isTopLevelBlockquote(node) && !selectionIntersectsRange(state, node.from, node.to, focused);
}

export function enclosingFlowBlockquote(
  state: EditorState,
  from: number,
  to: number,
): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, -1);
  while (node) {
    if (isTopLevelBlockquote(node) && to <= node.to) return node;
    node = node.parent;
  }
  return null;
}

export function activeFlowBlockquoteRange(
  state: EditorState,
  focused: boolean,
): { readonly from: number; readonly to: number } | null {
  if (!focused) return null;
  const range = state.selection.main;
  const blockquote = enclosingFlowBlockquote(state, range.from, range.to);
  return blockquote ? { from: blockquote.from, to: blockquote.to } : null;
}

export function flowBlockquoteRangesEqual(
  a: { readonly from: number; readonly to: number } | null,
  b: { readonly from: number; readonly to: number } | null,
): boolean {
  return a?.from === b?.from && a?.to === b?.to;
}
