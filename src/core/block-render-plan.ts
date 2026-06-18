import type { SyntaxNode } from "@lezer/common";
import {
  BLOCK_MANIFEST_ENTRIES,
  type BlockManifestEntry,
} from "./constants/block-manifest";
import { NODE } from "./constants/node-types";
import {
  blockPresentationPlan,
  type BlockPresentationPlan,
} from "./block-presentation";
import {
  buildInlineFragments,
  inlineFragmentsPlainText,
  parseInlineFragments,
  type InlineFragment,
} from "./inline-fragments";
import {
  isLooseListNode,
  orderedListStartNumber,
} from "./parser/list-shape";
import {
  blankLineRangesBetweenBlocks,
  trailingBlankLineRangesAfterLastBlock,
} from "./parser/blank-lines";
import { extractDivClass } from "./parser/fenced-div-attrs";
import { extractRawFrontmatter } from "./parser/frontmatter";
import { taskMarkerChecked } from "./list-surface";
import { displayMathLatex } from "./math-source";
import { readBracedLabelId } from "./parser/label-utils";
import { parseTableDelimiterAlignments } from "./parser/table";

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

export interface DisplayMathRenderPlan {
  readonly kind: "display-math";
  readonly sourceRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly latex: string;
  readonly equationId: string | null;
}

export interface CodeBlockRenderPlan {
  readonly kind: "code-block";
  readonly sourceRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly contentRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly language: string;
  readonly code: string;
}

export interface BlockquoteRenderPlan {
  readonly kind: "blockquote";
  readonly sourceRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly children: readonly SyntaxNode[];
}

export interface ListTaskRenderPlan {
  readonly checked: boolean;
  readonly markerRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly contentRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly trimmedContentRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly contentMarkdown: string;
}

export interface ListItemRenderPlan {
  readonly kind: "list-item";
  readonly sourceRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly markerNumber: number;
  readonly inlineOnly: boolean;
  readonly task: ListTaskRenderPlan | null;
  readonly children: readonly SyntaxNode[];
}

export interface ListRenderPlan {
  readonly kind: "list";
  readonly sourceRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly ordered: boolean;
  readonly loose: boolean;
  readonly start: number;
  readonly task: boolean;
  readonly items: readonly ListItemRenderPlan[];
}

export interface TableCellRenderPlan {
  readonly node: SyntaxNode;
  readonly align: string | null;
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

export interface TableRowRenderPlan {
  readonly kind: "table-row";
  readonly sourceRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly header: boolean;
  readonly cells: readonly TableCellRenderPlan[];
}

export interface TableRenderPlan {
  readonly kind: "table";
  readonly sourceRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly alignments: readonly (string | null)[];
  readonly header: TableRowRenderPlan | null;
  readonly rows: readonly TableRowRenderPlan[];
}

export interface FootnoteDefinitionRenderPlan {
  readonly kind: "footnote-definition";
  readonly sourceRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly labelRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly bodyRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly id: string;
  readonly fragments: readonly InlineFragment[];
  readonly text: string;
  readonly hasMath: boolean;
}

export interface FencedDivRenderChildPlan {
  readonly node: SyntaxNode;
  readonly blankBeforeRanges: readonly {
    readonly from: number;
    readonly to: number;
  }[];
}

export interface FencedDivRenderPlanOptions {
  readonly displayTitleForBlockType?: (blockType: string) => string;
  readonly numberForBlockType?: (blockType: string) => number | undefined;
}

export interface FencedDivRenderPlan {
  readonly kind: "fenced-div";
  readonly sourceRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly classes: readonly string[];
  readonly id: string | undefined;
  readonly keyValues: Readonly<Record<string, string>>;
  readonly title: string | undefined;
  readonly titleFragments: readonly InlineFragment[];
  readonly titleText: string;
  readonly titleHasMath: boolean;
  readonly isSelfClosing: boolean;
  readonly bodyRange: {
    readonly from: number;
    readonly to: number;
  } | null;
  readonly children: readonly FencedDivRenderChildPlan[];
  readonly primaryManifestEntry: BlockManifestEntry | undefined;
  readonly primaryClassName: string | undefined;
  readonly displayTitle: string | undefined;
  readonly number: number | undefined;
  readonly presentation: BlockPresentationPlan | undefined;
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

export type BlockNodeRenderKind =
  | "document"
  | "paragraph"
  | "heading"
  | "horizontal-rule"
  | "display-math"
  | "code-block"
  | "blockquote"
  | "list"
  | "table"
  | "fenced-div"
  | "footnote-definition"
  | "ignored"
  | "fallback";

export interface BlockNodeRenderHandlers<T> {
  readonly document: (node: SyntaxNode) => T;
  readonly paragraph: (node: SyntaxNode) => T;
  readonly heading: (node: SyntaxNode) => T;
  readonly horizontalRule: (node: SyntaxNode) => T;
  readonly displayMath: (node: SyntaxNode) => T;
  readonly codeBlock: (node: SyntaxNode) => T;
  readonly blockquote: (node: SyntaxNode) => T;
  readonly list: (node: SyntaxNode) => T;
  readonly table: (node: SyntaxNode) => T;
  readonly fencedDiv: (node: SyntaxNode) => T;
  readonly footnoteDefinition: (node: SyntaxNode) => T;
  readonly ignored: (node: SyntaxNode) => T;
  readonly fallback: (node: SyntaxNode) => T;
}

export interface DocumentRenderChildPlan {
  readonly node: SyntaxNode;
  readonly blankBeforeRanges: readonly {
    readonly from: number;
    readonly to: number;
  }[];
}

export interface DocumentRenderPlan {
  readonly kind: "document";
  readonly frontmatterEnd: number;
  readonly children: readonly DocumentRenderChildPlan[];
  readonly trailingBlankRanges: readonly {
    readonly from: number;
    readonly to: number;
  }[];
  readonly topLevelRenderableCount: number;
}

export function blockNodeRenderKind(name: string): BlockNodeRenderKind {
  if (headingLevelFor(name)) return "heading";
  switch (name) {
    case NODE.Document:
      return "document";
    case NODE.Paragraph:
      return "paragraph";
    case NODE.HorizontalRule:
      return "horizontal-rule";
    case NODE.DisplayMath:
      return "display-math";
    case NODE.FencedCode:
    case NODE.CodeBlock:
      return "code-block";
    case NODE.Blockquote:
      return "blockquote";
    case NODE.BulletList:
    case NODE.OrderedList:
      return "list";
    case NODE.Table:
      return "table";
    case NODE.FencedDiv:
      return "fenced-div";
    case NODE.FootnoteDef:
      return "footnote-definition";
    case NODE.HTMLBlock:
    case NODE.CommentBlock:
    case NODE.Frontmatter:
      return "ignored";
    default:
      return "fallback";
  }
}

export function dispatchBlockNodeRender<T>(
  node: SyntaxNode,
  handlers: BlockNodeRenderHandlers<T>,
): T {
  switch (blockNodeRenderKind(node.name)) {
    case "document":
      return handlers.document(node);
    case "paragraph":
      return handlers.paragraph(node);
    case "heading":
      return handlers.heading(node);
    case "horizontal-rule":
      return handlers.horizontalRule(node);
    case "display-math":
      return handlers.displayMath(node);
    case "code-block":
      return handlers.codeBlock(node);
    case "blockquote":
      return handlers.blockquote(node);
    case "list":
      return handlers.list(node);
    case "table":
      return handlers.table(node);
    case "fenced-div":
      return handlers.fencedDiv(node);
    case "footnote-definition":
      return handlers.footnoteDefinition(node);
    case "ignored":
      return handlers.ignored(node);
    case "fallback":
      return handlers.fallback(node);
  }
}

// Shared line-cost model for block-boundary truncation. The reader currently
// applies the truncation marker, but the syntax interpretation belongs with the
// block render plan so future reader/editor preview surfaces do not drift.
export function blockLineCost(source: string, node: SyntaxNode): number {
  switch (blockNodeRenderKind(node.name)) {
    case "heading":
    case "paragraph":
    case "horizontal-rule":
    case "display-math":
      return 1;
    case "list":
      return listRenderPlan(source, node).items.length;
    case "code-block": {
      const code = codeBlockRenderPlan(source, node).code;
      if (code.length === 0) return 0;
      return code.split("\n").length;
    }
    case "table": {
      const plan = tableRenderPlan(source, node);
      return (plan.header ? 1 : 0) + plan.rows.length;
    }
    case "fenced-div": {
      const plan = fencedDivRenderPlan(source, node);
      return 1 + plan.children.reduce((total, child) => total + blockLineCost(source, child.node), 0);
    }
    case "blockquote":
      return blockquoteRenderPlan(node).children.reduce((total, child) => total + blockLineCost(source, child), 0);
    case "document":
    case "footnote-definition":
    case "ignored":
    case "fallback":
      return 0;
  }
}

export function documentRenderPlan(
  source: string,
  documentNode: SyntaxNode,
  options: { readonly leadingBlockCount?: number } = {},
): DocumentRenderPlan {
  if (documentNode.name !== "Document") {
    throw new Error(`expected document node, got ${documentNode.name}`);
  }

  const frontmatterEnd = extractRawFrontmatter(source)?.end ?? -1;
  const children: DocumentRenderChildPlan[] = [];
  let child = documentNode.firstChild;
  let previousRenderable: SyntaxNode | null = null;

  if (frontmatterEnd >= 0) {
    while (child && child.to <= frontmatterEnd) {
      child = child.nextSibling;
    }
    if (child && child.from < frontmatterEnd) {
      child = child.nextSibling;
    }
  }

  while (child) {
    children.push({
      node: child,
      blankBeforeRanges: previousRenderable && child.from > previousRenderable.to
        ? blankLineRangesBetweenBlocks(source, previousRenderable.to, child.from).map(([from, to]) => ({ from, to }))
        : [],
    });
    previousRenderable = child;
    child = child.nextSibling;
  }

  const topLevelRenderableCount = (options.leadingBlockCount ?? 0) + children.length;
  return {
    kind: "document",
    frontmatterEnd,
    children,
    trailingBlankRanges: previousRenderable && topLevelRenderableCount > 1
      ? trailingBlankLineRangesAfterLastBlock(source, previousRenderable.to).map(([from, to]) => ({ from, to }))
      : [],
    topLevelRenderableCount,
  };
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

export function displayMathRenderPlan(
  source: string,
  node: SyntaxNode,
): DisplayMathRenderPlan {
  const equationLabel = node.getChild(NODE.EquationLabel);
  return {
    kind: "display-math",
    sourceRange: { from: node.from, to: node.to },
    latex: displayMathLatex(source, node),
    equationId: equationLabel
      ? readBracedLabelId(source, equationLabel.from, equationLabel.to, "eq:")
      : null,
  };
}

export function codeBlockRenderPlan(
  source: string,
  node: SyntaxNode,
): CodeBlockRenderPlan {
  switch (node.name) {
    case NODE.FencedCode:
      return fencedCodeBlockRenderPlan(source, node);
    case NODE.CodeBlock:
      return indentedCodeBlockRenderPlan(source, node);
    default:
      throw new Error(`expected code block node, got ${node.name}`);
  }
}

function fencedCodeBlockRenderPlan(
  source: string,
  node: SyntaxNode,
): CodeBlockRenderPlan {
  const info = node.getChild(NODE.CodeInfo);
  const codeText = node.getChild(NODE.CodeText);
  let contentFrom = codeText?.from ?? node.from;
  let contentTo = codeText?.to ?? node.to;

  if (!codeText) {
    const marks = node.getChildren(NODE.CodeMark);
    if (marks.length >= 1) contentFrom = info ? info.to : marks[0].to;
    if (marks.length >= 2) contentTo = marks[marks.length - 1].from;
    while (contentFrom < contentTo && source[contentFrom] === "\n") contentFrom++;
    while (contentTo > contentFrom && source[contentTo - 1] === "\n") contentTo--;
  }

  return {
    kind: "code-block",
    sourceRange: { from: node.from, to: node.to },
    contentRange: { from: contentFrom, to: contentTo },
    language: info ? source.slice(info.from, info.to).trim() : "",
    code: source.slice(contentFrom, contentTo),
  };
}

function indentedCodeBlockRenderPlan(
  source: string,
  node: SyntaxNode,
): CodeBlockRenderPlan {
  return {
    kind: "code-block",
    sourceRange: { from: node.from, to: node.to },
    contentRange: { from: node.from, to: node.to },
    language: "",
    code: source.slice(node.from, node.to).replace(/^( {4}|\t)/gm, ""),
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

export function listRenderPlan(
  source: string,
  node: SyntaxNode,
): ListRenderPlan {
  const ordered = node.name === NODE.OrderedList;
  if (!ordered && node.name !== NODE.BulletList) {
    throw new Error(`expected list node, got ${node.name}`);
  }
  const start = ordered ? orderedListStartNumber(node, source) : 1;
  const items: ListItemRenderPlan[] = [];
  let child = node.firstChild;
  let itemIndex = 0;
  while (child) {
    if (child.name === NODE.ListItem) {
      items.push(listItemRenderPlan(source, child, start + itemIndex));
      itemIndex += 1;
    }
    child = child.nextSibling;
  }
  return {
    kind: "list",
    sourceRange: { from: node.from, to: node.to },
    ordered,
    loose: isLooseListNode(node, source),
    start,
    task: items.some((item) => item.task !== null),
    items,
  };
}

export function listItemRenderPlan(
  source: string,
  node: SyntaxNode,
  markerNumber: number,
): ListItemRenderPlan {
  const children: SyntaxNode[] = [];
  let task: ListTaskRenderPlan | null = null;
  let blockCount = 0;
  let onlyInlineBlock = true;

  let child = node.firstChild;
  while (child) {
    if (child.name === NODE.ListMark) {
      child = child.nextSibling;
      continue;
    }

    children.push(child);
    blockCount += 1;
    if (child.name !== NODE.Paragraph && child.name !== NODE.Task) {
      onlyInlineBlock = false;
    }

    if (child.name === NODE.Task && task === null) {
      const taskMarker = child.getChild(NODE.TaskMarker);
      if (taskMarker) {
        const contentFrom = Math.min(taskMarker.to + 1, child.to);
        const trimmedContentRange = trimmedNodeRange(source, contentFrom, child.to);
        task = {
          checked: taskMarkerChecked(source.slice(taskMarker.from, taskMarker.to)),
          markerRange: { from: taskMarker.from, to: taskMarker.to },
          contentRange: { from: contentFrom, to: child.to },
          trimmedContentRange,
          contentMarkdown: source.slice(trimmedContentRange.from, trimmedContentRange.to),
        };
      }
    }

    child = child.nextSibling;
  }

  return {
    kind: "list-item",
    sourceRange: { from: node.from, to: node.to },
    markerNumber,
    inlineOnly: blockCount === 1 && onlyInlineBlock,
    task,
    children,
  };
}

export function tableRenderPlan(
  source: string,
  node: SyntaxNode,
  options: BlockRenderPlanOptions = {},
): TableRenderPlan {
  if (node.name !== NODE.Table) {
    throw new Error(`expected table node, got ${node.name}`);
  }
  const alignments = tableAlignments(source, node);
  const headerNode = node.getChild(NODE.TableHeader);
  const rows: TableRowRenderPlan[] = [];
  let child = node.firstChild;
  while (child) {
    if (child.name === NODE.TableRow) {
      rows.push(tableRowRenderPlan(source, child, false, alignments, options));
    }
    child = child.nextSibling;
  }
  return {
    kind: "table",
    sourceRange: { from: node.from, to: node.to },
    alignments,
    header: headerNode ? tableRowRenderPlan(source, headerNode, true, alignments, options) : null,
    rows,
  };
}

function tableRowRenderPlan(
  source: string,
  node: SyntaxNode,
  header: boolean,
  alignments: readonly (string | null)[],
  options: BlockRenderPlanOptions,
): TableRowRenderPlan {
  return {
    kind: "table-row",
    sourceRange: { from: node.from, to: node.to },
    header,
    cells: node.getChildren(NODE.TableCell).map((cell, index) =>
      tableCellRenderPlan(source, cell, alignments[index] ?? null, options)
    ),
  };
}

function tableCellRenderPlan(
  source: string,
  node: SyntaxNode,
  align: string | null,
  options: BlockRenderPlanOptions,
): TableCellRenderPlan {
  const contentRange = { from: node.from, to: node.to };
  const fragments = buildInlineFragments(node, source, contentRange.from, contentRange.to, {
    sourceRanges: options.sourceRanges,
  });
  return {
    node,
    align,
    sourceRange: { from: node.from, to: node.to },
    contentRange,
    fragments,
    text: inlineFragmentsPlainText(fragments),
    hasMath: fragmentsContainMath(fragments),
  };
}

function tableAlignments(
  source: string,
  node: SyntaxNode,
): readonly (string | null)[] {
  for (const delimiter of node.getChildren(NODE.TableDelimiter)) {
    const raw = source.slice(delimiter.from, delimiter.to);
    if (raw.includes("-")) {
      return parseTableDelimiterAlignments(raw);
    }
  }
  return [];
}

export function footnoteDefinitionRenderPlan(
  source: string,
  node: SyntaxNode,
  options: BlockRenderPlanOptions = {},
): FootnoteDefinitionRenderPlan | null {
  if (node.name !== NODE.FootnoteDef) {
    throw new Error(`expected footnote definition node, got ${node.name}`);
  }

  const labelNode = node.getChild(NODE.FootnoteDefLabel);
  if (!labelNode) return null;

  const id = source.slice(labelNode.from + 2, labelNode.to - 2);
  const bodyRange = trimmedNodeRange(source, labelNode.to, node.to);
  const fragments = buildInlineFragments(
    node,
    source,
    bodyRange.from,
    bodyRange.to,
    { sourceRanges: options.sourceRanges },
  );

  return {
    kind: "footnote-definition",
    sourceRange: { from: node.from, to: node.to },
    labelRange: { from: labelNode.from, to: labelNode.to },
    bodyRange,
    id,
    fragments,
    text: inlineFragmentsPlainText(fragments),
    hasMath: fragmentsContainMath(fragments),
  };
}

export function fencedDivRenderPlan(
  source: string,
  node: SyntaxNode,
  options: FencedDivRenderPlanOptions = {},
): FencedDivRenderPlan {
  if (node.name !== NODE.FencedDiv) {
    throw new Error(`expected fenced div node, got ${node.name}`);
  }

  let classes: readonly string[] = [];
  let id: string | undefined;
  let keyValues: Readonly<Record<string, string>> = {};
  const attrsNode = node.getChild(NODE.FencedDivAttributes);
  if (attrsNode) {
    const parsed = extractDivClass(source.slice(attrsNode.from, attrsNode.to).trim());
    if (parsed) {
      classes = parsed.classes;
      id = parsed.id;
      keyValues = { ...parsed.keyValues };
    }
  }

  let title = keyValues.title;
  const children: FencedDivRenderChildPlan[] = [];
  let previousRenderable: SyntaxNode | null = null;
  let bodyFrom: number | null = null;
  let bodyTo: number | null = null;
  let hasClosingFence = false;
  let firstFence: SyntaxNode | null = null;
  let lastFence: SyntaxNode | null = null;
  let child = node.firstChild;
  while (child) {
    switch (child.name) {
      case NODE.FencedDivFence:
        firstFence ??= child;
        lastFence = child;
        if (child !== firstFence) hasClosingFence = true;
        break;
      case NODE.FencedDivAttributes:
        break;
      case NODE.FencedDivTitle: {
        const rawTitle = source.slice(child.from, child.to).trim();
        if (rawTitle) title = rawTitle;
        break;
      }
      default: {
        if (child.from === child.to) break;
        const blankBeforeRanges = previousRenderable && child.from > previousRenderable.to
          ? blankLineRangesBetweenBlocks(source, previousRenderable.to, child.from).map(([from, to]) => ({
            from,
            to,
          }))
          : [];
        bodyFrom ??= child.from;
        bodyTo = child.to;
        children.push({ node: child, blankBeforeRanges });
        previousRenderable = child;
        break;
      }
    }
    child = child.nextSibling;
  }

  const normalizedPrimaryClassName = classes[0]?.toLowerCase();
  const primaryManifestEntry = BLOCK_MANIFEST_ENTRIES.find((entry) =>
    classes.includes(entry.name) || normalizedPrimaryClassName === entry.name
  );
  const primaryClassName = primaryManifestEntry?.name ?? normalizedPrimaryClassName;
  const displayTitle = primaryClassName
    ? (options.displayTitleForBlockType?.(primaryClassName) ?? primaryClassName)
    : undefined;
  const number = primaryClassName
    ? options.numberForBlockType?.(primaryClassName)
    : undefined;
  const presentation = primaryClassName && displayTitle
    ? blockPresentationPlan({
      blockType: primaryClassName,
      displayTitle,
      number,
      title,
    })
    : undefined;
  const titleFragments = title ? parseInlineFragments(title) : [];
  const fenceRange = firstFence && lastFence
    ? source.slice(firstFence.from, lastFence.to)
    : "";

  return {
    kind: "fenced-div",
    sourceRange: { from: node.from, to: node.to },
    classes,
    id,
    keyValues,
    title,
    titleFragments,
    titleText: inlineFragmentsPlainText(titleFragments),
    titleHasMath: fragmentsContainMath(titleFragments),
    isSelfClosing: hasClosingFence && !fenceRange.includes("\n"),
    bodyRange: bodyFrom === null || bodyTo === null
      ? null
      : { from: bodyFrom, to: bodyTo },
    children,
    primaryManifestEntry,
    primaryClassName,
    displayTitle,
    number,
    presentation,
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
