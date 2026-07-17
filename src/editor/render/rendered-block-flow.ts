import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range, Transaction } from "@codemirror/state";
import type { Decoration, DecorationSet } from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";

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

export interface FlowSelectionPatchValue<
  Candidate extends { readonly from: number; readonly to: number },
> {
  readonly decorations: DecorationSet;
  // Every candidate block range, rendered or not. A revealed block has no
  // decoration to test against, so selection diffing needs this list.
  readonly candidates: readonly Candidate[];
  // Tree the candidates were collected from; selection-only patches bail when
  // the tree advanced in between.
  readonly tree: Tree;
}

/**
 * Selection-only decoration patch shared by the flow render fields: diff the
 * old and new selection against the candidate ranges via `revealed`; when
 * nothing flipped, return the previous decorations untouched (zero tree work).
 * Otherwise remove + re-collect only the flipped ranges (local equivalent of
 * decoration-lifecycle's removeDecorationsInRanges — block replaces span
 * exactly a candidate range, so exact-range matching suffices). Returns null
 * when the tree advanced since the candidates were collected; the caller must
 * rebuild from scratch.
 */
export function applyFlowSelectionPatch<
  Candidate extends { readonly from: number; readonly to: number },
>(
  value: FlowSelectionPatchValue<Candidate>,
  tr: Transaction,
  revealed: (state: EditorState, candidate: Candidate) => boolean,
  collectItems: (
    state: EditorState,
    changed: readonly Candidate[],
  ) => readonly Range<Decoration>[],
): DecorationSet | null {
  if (syntaxTree(tr.state) !== value.tree) return null;
  const changed: Candidate[] = [];
  for (const candidate of value.candidates) {
    const before = revealed(tr.startState, candidate);
    const after = revealed(tr.state, candidate);
    if (before !== after) changed.push(candidate);
  }
  if (changed.length === 0) return value.decorations;
  let filterFrom = Infinity;
  let filterTo = -Infinity;
  for (const range of changed) {
    if (range.from < filterFrom) filterFrom = range.from;
    if (range.to > filterTo) filterTo = range.to;
  }
  let decorations = value.decorations.update({
    filterFrom,
    filterTo,
    filter: (from, to) => !changed.some((range) => range.from === from && range.to === to),
  });
  const items = collectItems(tr.state, changed);
  if (items.length > 0) {
    decorations = decorations.update({ add: items, sort: true });
  }
  return decorations;
}
