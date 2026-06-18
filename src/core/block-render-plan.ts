import type { SyntaxNode } from "@lezer/common";
import { NODE } from "./constants/node-types";
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

export interface HorizontalRuleRenderPlan {
  readonly kind: "horizontal-rule";
  readonly sourceRange: {
    readonly from: number;
    readonly to: number;
  };
}

export interface BlockquoteRenderPlan {
  readonly kind: "blockquote";
  readonly sourceRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly children: readonly SyntaxNode[];
}

export interface HeadingAttributePlan {
  readonly contentTo: number;
  readonly unnumbered: boolean;
  readonly id?: string;
}

export interface HeadingRenderPlan {
  readonly kind: "heading";
  readonly level: number;
  readonly sourceRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly contentRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly rawContentRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly attributes: HeadingAttributePlan | null;
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

export function horizontalRuleRenderPlan(
  node: SyntaxNode,
): HorizontalRuleRenderPlan {
  return {
    kind: "horizontal-rule",
    sourceRange: { from: node.from, to: node.to },
  };
}

export function blockquoteRenderPlan(
  node: SyntaxNode,
): BlockquoteRenderPlan {
  const children: SyntaxNode[] = [];
  let child = node.firstChild;
  while (child) {
    if (child.name !== "QuoteMark") children.push(child);
    child = child.nextSibling;
  }
  return {
    kind: "blockquote",
    sourceRange: { from: node.from, to: node.to },
    children,
  };
}

export function headingRenderPlan(
  source: string,
  node: SyntaxNode,
  options: BlockRenderPlanOptions = {},
): HeadingRenderPlan {
  const level = headingLevelFor(node.name);
  if (!level) {
    throw new Error(`expected heading node, got ${node.name}`);
  }
  const rawContentRange = headingContentRange(source, node);
  const attributes = parsePandocHeadingAttributes(
    source,
    rawContentRange.from,
    rawContentRange.to,
  );
  const contentRange = {
    from: rawContentRange.from,
    to: attributes?.contentTo ?? rawContentRange.to,
  };
  const fragments = buildInlineFragments(
    node,
    source,
    contentRange.from,
    contentRange.to,
    { sourceRanges: options.sourceRanges },
  );
  return {
    kind: "heading",
    level,
    sourceRange: { from: node.from, to: node.to },
    rawContentRange,
    contentRange,
    attributes,
    fragments,
    text: inlineFragmentsPlainText(fragments),
    hasMath: fragmentsContainMath(fragments),
  };
}

export function headingLevelFor(name: string): number {
  switch (name) {
    case NODE.ATXHeading1: case NODE.SetextHeading1: return 1;
    case NODE.ATXHeading2: case NODE.SetextHeading2: return 2;
    case NODE.ATXHeading3: return 3;
    case NODE.ATXHeading4: return 4;
    case NODE.ATXHeading5: return 5;
    case NODE.ATXHeading6: return 6;
  }
  return 0;
}

export function headingContentRange(
  source: string,
  node: SyntaxNode,
): { from: number; to: number } {
  let contentFrom = node.from;
  let contentTo = node.to;
  const headerMark = node.getChild("HeaderMark");
  if (headerMark && headerMark.from === node.from) {
    contentFrom = headerMark.to;
    while (contentFrom < contentTo && source[contentFrom] === " ") contentFrom++;
    while (contentTo > contentFrom && source[contentTo - 1] === " ") contentTo--;
    const trailing = node.lastChild;
    if (trailing && trailing.name === "HeaderMark" && trailing.from !== headerMark.from) {
      contentTo = trailing.from;
      while (contentTo > contentFrom && source[contentTo - 1] === " ") contentTo--;
    }
  } else if (headerMark && headerMark.from > node.from) {
    contentTo = headerMark.from;
    while (contentTo > contentFrom && /\s/.test(source[contentTo - 1] ?? "")) contentTo--;
  }
  return { from: contentFrom, to: contentTo };
}

export function parsePandocHeadingAttributes(
  source: string,
  contentFrom: number,
  contentTo: number,
): HeadingAttributePlan | null {
  let end = contentTo;
  while (end > contentFrom && /\s/.test(source[end - 1] ?? "")) end--;
  if (source[end - 1] !== "}") return null;

  const open = source.lastIndexOf("{", end - 1);
  if (open < contentFrom) return null;
  const beforeOpen = source[open - 1] ?? "";
  if (open > contentFrom && !/\s/.test(beforeOpen)) return null;

  const raw = source.slice(open + 1, end - 1).trim();
  if (!raw) return null;
  const tokens = raw.split(/\s+/);
  if (!tokens.every(isPandocHeadingAttributeToken)) return null;
  let strippedTo = open;
  while (strippedTo > contentFrom && /\s/.test(source[strippedTo - 1] ?? "")) strippedTo--;
  const idToken = tokens.find((token) => token.startsWith("#"));
  return {
    contentTo: strippedTo,
    unnumbered: tokens.includes("-") || tokens.includes(".unnumbered"),
    id: idToken?.slice(1),
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

function isPandocHeadingAttributeToken(token: string): boolean {
  return (
    token === "-" ||
    /^[#.][^\s{}]+$/.test(token) ||
    /^[A-Za-z_:][\w:.-]*=(?:"[^"]*"|'[^']*'|[^\s{}]+)$/.test(token)
  );
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
