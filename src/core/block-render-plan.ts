import type { SyntaxNode } from "@lezer/common";
import {
  buildInlineFragments,
  inlineFragmentsPlainText,
  type InlineFragment,
} from "./inline-fragments";

export interface ParagraphRenderPlan {
  readonly kind: "paragraph";
  readonly sourceRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly contentRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly fragments: readonly InlineFragment[];
  readonly text: string;
  readonly hasMath: boolean;
}

export interface BlockRenderPlanOptions {
  readonly sourceRanges?: boolean;
}

export function paragraphRenderPlan(
  source: string,
  node: SyntaxNode,
  options: BlockRenderPlanOptions = {},
): ParagraphRenderPlan {
  const contentRange = trimmedNodeRange(source, node.from, node.to);
  const fragments = buildInlineFragments(
    node,
    source,
    contentRange.from,
    contentRange.to,
    { sourceRanges: options.sourceRanges },
  );
  return {
    kind: "paragraph",
    sourceRange: { from: node.from, to: node.to },
    contentRange,
    fragments,
    text: inlineFragmentsPlainText(fragments),
    hasMath: fragmentsContainMath(fragments),
  };
}

function trimmedNodeRange(
  source: string,
  from: number,
  to: number,
): { from: number; to: number } {
  let contentFrom = from;
  let contentTo = to;
  while (contentFrom < contentTo && /\s/.test(source[contentFrom] ?? "")) contentFrom++;
  while (contentTo > contentFrom && /\s/.test(source[contentTo - 1] ?? "")) contentTo--;
  return { from: contentFrom, to: contentTo };
}

function fragmentsContainMath(fragments: readonly InlineFragment[]): boolean {
  for (const fragment of fragments) {
    switch (fragment.kind) {
      case "math":
        return true;
      case "emphasis":
      case "strong":
      case "strikethrough":
      case "highlight":
      case "link":
      case "image":
        if (fragmentsContainMath(fragment.kind === "image" ? fragment.alt : fragment.children)) {
          return true;
        }
        break;
      default:
        break;
    }
  }
  return false;
}
