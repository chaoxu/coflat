import type { Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

import { CSS } from "../../core/constants/css-classes";

const sourceDelimiterDecoration = Decoration.mark({ class: CSS.sourceDelimiter });
const inlineSourceDecoration = Decoration.mark({ class: CSS.inlineSource });
const inlineMediaSourceDecoration = Decoration.mark({ class: CSS.inlineMediaSource });

const SOURCE_DELIMITER_MARKS = new Set([
  "EmphasisMark",
  "StrikethroughMark",
  "HighlightMark",
  "LinkMark",
]);
const INLINE_SOURCE_MARKS = new Set(["URL"]);

export function addInlineRevealSourceMetricsInSubtree(
  node: SyntaxNode,
  items: Range<Decoration>[],
): void {
  let child = node.firstChild;
  while (child) {
    if (SOURCE_DELIMITER_MARKS.has(child.name)) {
      items.push(sourceDelimiterDecoration.range(child.from, child.to));
    }
    if (INLINE_SOURCE_MARKS.has(child.name)) {
      items.push(inlineSourceDecoration.range(child.from, child.to));
    }
    addInlineRevealSourceMetricsInSubtree(child, items);
    child = child.nextSibling;
  }
}

export function addInlineMediaSourceMetricsRange(
  from: number,
  to: number,
  items: Range<Decoration>[],
): void {
  if (from >= to) return;
  items.push(inlineMediaSourceDecoration.range(from, to));
}
