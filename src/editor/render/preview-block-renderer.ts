import type { SyntaxNode } from "@lezer/common";
import type {
  CitationFormatter,
  DocumentContext,
} from "../../core/document-context-types";
import {
  appendBlockCaptionLabel,
  appendBlockCaptionText,
  createBlockCaptionElement,
} from "../../core/block-caption-surface";
import {
  appendBlockDisclosure,
  createBlockLabelElement,
  createBlockSummaryFragment as createBlockSummarySurfaceFragment,
  prependInlineBlockHeading,
} from "../../core/block-heading-surface";
import {
  createBlockContainerElement,
  createBlankLineElement,
  createBlockquoteElement,
  createHorizontalRuleElement,
} from "../../core/block-surface";
import {
  BLOCK_MANIFEST_ENTRIES,
  EXCLUDED_FROM_FALLBACK,
  isCollapsibleBlockType,
  type BlockManifestEntry,
} from "../../core/constants/block-manifest";
import { CSS } from "../../core/constants/css-classes";
import { appendCodeBlockDom } from "../../core/code-block-surface";
import { createFootnoteEntryElement } from "../../core/footnote-section-surface";
import {
  createDisplayMathContentElement,
  createDisplayMathSurfaceElement,
  replaceDisplayMathContent,
} from "../../core/math-display-surface";
import { displayMathLatex } from "../../core/math-source";
import {
  createHeadingSurfaceElement,
} from "../../core/heading-surface";
import {
  appendListMarker,
  appendReadOnlyTaskCheckbox,
  createListItemSurfaceElement,
  createListSurfaceElement,
} from "../../core/list-surface";
import { appendParagraphDom, createParagraphDom } from "../../core/paragraph-surface";
import type { BlockCounterEntry } from "../../core/lib/file-system-types";
import {
  extractRawFrontmatter,
  parseFrontmatter,
  parseMarkdownSource,
  type FrontmatterConfig,
} from "../../core/parser";
import {
  blankLineRangesBetweenBlocks,
  trailingBlankLineRangesAfterLastBlock,
} from "../../core/parser/blank-lines";
import { readBracedLabelId } from "../../core/parser/label-utils";
import {
  analyzeDocumentSemantics,
  numberFootnotes,
  stringTextSource,
  type DocumentSemantics,
} from "../semantics/document";
import {
  blockTitleOverridesFromConfig,
  computeBlockNumbers,
  createConfiguredBlockNumberingSpecLookup,
  displayTitleForBlockType,
} from "../../core/semantics/block-numbering";
import { blockPresentationPlan, type BlockPresentationPlan } from "../../core/block-presentation";
import {
  blockquoteRenderPlan,
  headingRenderPlan,
  horizontalRuleRenderPlan,
  listRenderPlan,
  type ListItemRenderPlan,
  paragraphRenderPlan,
} from "../../core/block-render-plan";
import type { BibStore } from "../state/bib-data";
import {
  renderInlineFragmentsToDom,
  renderInlineMarkdown,
  renderInlineSyntaxNodeToDom,
} from "./inline-render";
import { renderKatex } from "./math-widget";
import {
  createPreviewReferencePresentationController,
} from "../references/presentation";
import { renderPreviewTable } from "./preview-table-renderer";
import { applyPreviewImageOverrides } from "./preview-media-overrides";
import type { PreviewRenderContext } from "./preview-render-context";

export interface PreviewBlockRenderOptions {
  readonly macros?: Record<string, string>;
  readonly config?: FrontmatterConfig;
  readonly bibliography?: BibStore;
  readonly documentContext?: DocumentContext;
  readonly formatter?: CitationFormatter | null;
  readonly blockCounters?: ReadonlyMap<string, BlockCounterEntry>;
  readonly documentPath?: string;
  readonly imageUrlOverrides?: ReadonlyMap<string, string>;
  readonly referenceSemantics?: DocumentSemantics;
}

/**
 * Render markdown into preview DOM.
 *
 * Block-level structure, cf-doc-* classes, and data attributes follow the
 * reader's emission contract; preview-reader-parity.test.ts locks the two
 * pipelines together. Sanitization boundary: this pipeline builds DOM via
 * createElement/textContent only — never raw HTML — so untrusted source
 * cannot inject markup. The one innerHTML consumer downstream
 * (reference widgets) receives HTML its caller already sanitized.
 */
export function renderPreviewBlockContentToDom(
  container: HTMLElement,
  text: string,
  options: PreviewBlockRenderOptions = {},
): void {
  container.textContent = "";

  const tree = parseMarkdownSource(text, "html-render");
  const semantics = analyzeDocumentSemantics(stringTextSource(text), tree);
  const config = options.config ?? parseFrontmatter(text).config;
  const blockNumbers = computeBlockNumbers(
    semantics.fencedDivs,
    createConfiguredBlockNumberingSpecLookup(config.blocks),
    config.numbering ?? "grouped",
  );
  const referenceSemantics = options.referenceSemantics ?? semantics;
  const footnoteNumbers = numberFootnotes(semantics.footnotes);
  const referenceController = createPreviewReferencePresentationController({
    bibliography: options.bibliography,
    blockCounters: options.blockCounters,
    documentContext: options.documentContext,
    documentPath: options.documentPath,
    formatter: options.formatter,
    referenceSemantics,
    surface: "editor-widget",
  });

  referenceController.registerCitations(semantics.references);

  const context: PreviewRenderContext = {
    doc: text,
    macros: options.macros ?? options.config?.math ?? {},
    semantics,
    referenceSemantics,
    bibliography: options.bibliography,
    formatter: options.formatter,
    blockCounters: options.blockCounters,
    documentBlockNumbers: blockNumbers.byPosition,
    blockTitleOverrides: blockTitleOverridesFromConfig(config.blocks),
    documentPath: options.documentPath,
    imageUrlOverrides: options.imageUrlOverrides,
    footnoteNumbers,
    referenceContext: referenceController,
  };

  renderNode(container, tree.topNode, context);
  applyPreviewImageOverrides(container, context);
}

function renderNode(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  switch (node.name) {
    case "Document":
      renderDocument(parent, node, context);
      return;
    case "Paragraph":
      renderParagraph(parent, node, context);
      return;
    case "ATXHeading1":
    case "ATXHeading2":
    case "ATXHeading3":
    case "ATXHeading4":
    case "ATXHeading5":
    case "ATXHeading6":
    case "SetextHeading1":
    case "SetextHeading2":
      renderHeading(parent, node, context);
      return;
    case "FencedCode":
      renderFencedCode(parent, node, context);
      return;
    case "BulletList":
      renderList(parent, node, context);
      return;
    case "OrderedList":
      renderList(parent, node, context);
      return;
    case "HorizontalRule": {
      renderHorizontalRule(parent, node);
      return;
    }
    case "FencedDiv":
      renderFencedDiv(parent, node, context);
      return;
    case "DisplayMath":
      renderDisplayMath(parent, node, context);
      return;
    case "FootnoteDef":
      renderFootnoteDef(parent, node, context);
      return;
    case "Table":
      renderPreviewTable(parent, node, context);
      return;
    case "Blockquote":
      renderBlockquote(parent, node, context);
      return;
    default:
      renderChildNodes(parent, node, context);
      return;
  }
}

function renderDocument(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  let child = node.firstChild;
  const frontmatterEnd = extractRawFrontmatter(context.doc)?.end ?? -1;
  let previousRenderable: SyntaxNode | null = null;
  let topCount = 0;

  if (frontmatterEnd >= 0) {
    while (child && child.to <= frontmatterEnd) {
      child = child.nextSibling;
    }
    if (child && child.from < frontmatterEnd) {
      child = child.nextSibling;
    }
  }

  while (child) {
    if (previousRenderable && child.from > previousRenderable.to) {
      appendBlankLines(parent, context, previousRenderable.to, child.from);
    }
    renderNode(parent, child, context);
    previousRenderable = child;
    topCount += 1;
    child = child.nextSibling;
  }

  if (previousRenderable && topCount > 1) {
    appendTrailingBlankLines(parent, context, previousRenderable.to);
  }
}

function renderChildNodes(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  let child = node.firstChild;
  while (child) {
    renderNode(parent, child, context);
    child = child.nextSibling;
  }
}

function renderParagraph(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const plan = paragraphRenderPlan(context.doc, node);
  appendParagraphDom(parent, document, (paragraph) => {
    renderInlineFragmentsToDom(
      paragraph,
      plan.fragments,
      context.macros,
      "document-body",
      {
        ...context.referenceContext,
        imageUrlOverrides: context.imageUrlOverrides,
        footnoteNumbers: context.footnoteNumbers,
      },
    );
  });
}

function renderHorizontalRule(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
): void {
  const plan = horizontalRuleRenderPlan(node);
  if (plan.kind !== "horizontal-rule") return;
  parent.appendChild(createHorizontalRuleElement(document));
}

function renderHeading(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const plan = headingRenderPlan(context.doc, node);
  const heading = context.semantics.headingByFrom.get(node.from);
  const level = heading?.level ?? plan.level;
  const element = createHeadingSurfaceElement(
    document,
    {
      level,
      id: heading?.id,
      sectionNumber: heading?.number,
      unnumbered: heading?.unnumbered ?? false,
    },
    (target) => {
      renderInlineFragmentsToDom(
        target,
        plan.fragments,
        context.macros,
        "document-body",
        {
          ...context.referenceContext,
          imageUrlOverrides: context.imageUrlOverrides,
        },
      );
    },
  );
  parent.appendChild(element);
}

function renderFencedCode(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const codeInfo = node.getChild("CodeInfo");
  const language = codeInfo ? context.doc.slice(codeInfo.from, codeInfo.to).trim() : "";
  const codeText = node.getChild("CodeText");
  appendCodeBlockDom(
    parent,
    document,
    language,
    codeText ? context.doc.slice(codeText.from, codeText.to) : "",
  );
}

function renderList(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const plan = listRenderPlan(context.doc, node);
  const renderedItems = plan.items.map((itemPlan) => {
    const item = createListItemSurfaceElement(document, {
      ordered: plan.ordered,
      task: itemPlan.task !== null,
      checked: itemPlan.task?.checked,
    });
    appendListMarker(item, plan.ordered, itemPlan.markerNumber);
    renderListItem(item, itemPlan, context);
    return item;
  });

  const list = createListSurfaceElement(document, {
    ordered: plan.ordered,
    task: plan.task,
    loose: plan.loose,
    start: plan.start,
  });
  list.append(...renderedItems);
  parent.appendChild(list);
}

function appendBlankLines(
  parent: HTMLElement | DocumentFragment,
  context: PreviewRenderContext,
  from: number,
  to: number,
): void {
  for (const [lineFrom, lineTo] of blankLineRangesBetweenBlocks(context.doc, from, to)) {
    appendBlankLine(parent, lineFrom, lineTo);
  }
}

function appendTrailingBlankLines(
  parent: HTMLElement | DocumentFragment,
  context: PreviewRenderContext,
  previousBlockTo: number,
): void {
  for (const [from, to] of trailingBlankLineRangesAfterLastBlock(context.doc, previousBlockTo)) {
    appendBlankLine(parent, from, to);
  }
}

function appendBlankLine(
  parent: HTMLElement | DocumentFragment,
  _from: number,
  _to: number,
): void {
  parent.appendChild(createBlankLineElement(document));
}

function renderListItem(
  parent: HTMLElement,
  plan: ListItemRenderPlan,
  context: PreviewRenderContext,
): void {
  for (const child of plan.children) {
    if (child.name === "Task") {
      renderTaskListItem(parent, child, plan, context, !plan.inlineOnly);
      continue;
    }

    if (child.name === "Paragraph" && plan.inlineOnly) {
      appendInlineNode(parent, child, context);
      continue;
    }

    renderNode(parent, child, context);
  }
}

function renderTaskListItem(
  parent: HTMLElement,
  node: SyntaxNode,
  plan: ListItemRenderPlan,
  context: PreviewRenderContext,
  wrap: boolean,
): void {
  const target = wrap ? createParagraphDom(document) : parent;
  if (plan.task) {
    appendReadOnlyTaskCheckbox(parent, plan.task.checked);

    const content = context.doc.slice(plan.task.contentRange.from, plan.task.contentRange.to).trim();
    if (content) {
      renderInlineMarkdown(
        target,
        content,
        context.macros,
        "document-body",
        {
          ...context.referenceContext,
          imageUrlOverrides: context.imageUrlOverrides,
        },
      );
    }
  } else {
    appendInlineNode(target, node, context);
  }

  if (wrap && target.hasChildNodes()) {
    parent.appendChild(target);
  }
}

function renderFencedDiv(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const fencedDiv = context.semantics.fencedDivByFrom.get(node.from);
  const classes = fencedDiv ? [...fencedDiv.classes] : [];
  const id = fencedDiv?.id;

  if (classes.some((className) => EXCLUDED_FROM_FALLBACK.has(className))) {
    return;
  }

  const block = createBlockContainerElement(document, {
    types: classes,
    id,
    dataAttributes: fencedDiv?.keyValues,
  });

  const title = fencedDiv?.title ?? "";
  const isSelfClosing = fencedDiv?.isSelfClosing ?? false;
  const primaryClass = getPrimaryBlockClass(classes);
  const primaryClassName = primaryClass?.name ?? fencedDiv?.primaryClass;
  const blockNumber = primaryClassName
    ? context.documentBlockNumbers.get(node.from)?.number
    : undefined;
  const plan = primaryClassName
    ? blockPresentationPlan({
      blockType: primaryClassName,
      displayTitle: displayTitleForBlockType(primaryClassName, context.blockTitleOverrides),
      number: blockNumber,
      title,
    })
    : undefined;
  const summary = plan
    ? createBlockSummaryFragment(context, plan)
    : undefined;

  if (title && isSelfClosing) {
    const paragraph = createParagraphDom(document);
    appendInlineText(paragraph, title, context, "document-body");
    block.appendChild(paragraph);
  }

  if (!isSelfClosing) {
    const body = document.createDocumentFragment();
    let child = node.firstChild;
    let previousRenderable: SyntaxNode | null = null;
    while (child) {
      if (
        child.name !== "FencedDivFence" &&
        child.name !== "FencedDivAttributes" &&
        child.name !== "FencedDivTitle"
      ) {
        if (previousRenderable && child.from > previousRenderable.to) {
          appendBlankLines(body, context, previousRenderable.to, child.from);
        }
        renderNode(body, child, context);
        previousRenderable = child;
      }
      child = child.nextSibling;
    }

    if (plan?.hasInlineHeader && summary) {
      if (primaryClass?.specialBehavior === "qed") {
        addClassToLastChildElement(body, CSS.blockQed);
      }
      prependInlineBlockHeading(body, summary);
    }

    if (summary && isCollapsibleBlockType(primaryClassName)) {
      appendBlockHeader(block, summary, body);
    } else {
      if (title && !plan?.hasCaptionBelow && !plan?.hasInlineHeader) {
        const strong = createBlockLabelElement(document);
        appendInlineText(strong, title, context, "document-body");
        block.appendChild(strong);
      }
      block.appendChild(body);
    }
  }

  if (!isSelfClosing && plan?.hasCaptionBelow && title) {
    const caption = createBlockCaptionElement(document);
    appendBlockCaptionLabel(caption, plan.label);
    const text = appendBlockCaptionText(caption);
    appendInlineText(text, title, context, "document-body");
    block.appendChild(caption);
  }

  parent.appendChild(block);
}

function getPrimaryBlockClass(classes: readonly string[]): BlockManifestEntry | undefined {
  return BLOCK_MANIFEST_ENTRIES.find((entry) => classes.includes(entry.name));
}

function createBlockSummaryFragment(
  context: PreviewRenderContext,
  plan: BlockPresentationPlan,
): DocumentFragment {
  return createBlockSummarySurfaceFragment(
    document,
    plan.label,
    plan.showTitleInHeader
      ? (renderedTitle) => {
        appendInlineText(renderedTitle, plan.title ?? "", context, "document-body");
      }
      : undefined,
  );
}

function appendBlockHeader(
  block: HTMLElement,
  summary: DocumentFragment,
  body: DocumentFragment,
): void {
  appendBlockDisclosure(block, summary, body);
}

function addClassToLastChildElement(parent: DocumentFragment, className: string): void {
  parent.lastElementChild?.classList.add(className);
}

function renderDisplayMath(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const latex = displayMathLatex(context.doc, node);

  const equationLabel = node.getChild("EquationLabel");
  const equationId = equationLabel
    ? readBracedLabelId(context.doc, equationLabel.from, equationLabel.to, "eq:")
    : null;
  const equationNumber = equationId
    ? context.semantics.equationById.get(equationId)?.number
    : undefined;

  const wrapper = createDisplayMathSurfaceElement(document, latex, {
    equationNumber,
    id: equationId ?? undefined,
  });
  const content = createDisplayMathContentElement(document);
  renderKatex(content, latex, true, context.macros);
  replaceDisplayMathContent(wrapper, content, equationNumber);

  parent.appendChild(wrapper);
}

function renderFootnoteDef(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const footnote = context.semantics.footnotes.defByFrom.get(node.from);
  if (!footnote) return;

  parent.appendChild(
    createFootnoteEntryElement(document, {
      num: context.footnoteNumbers.get(footnote.id) ?? 0,
      id: footnote.id,
      defFrom: footnote.from,
      appendContent: (content) => {
        appendInlineText(content, footnote.content, context, "document-body");
      },
    }),
  );
}

function renderBlockquote(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const plan = blockquoteRenderPlan(node);
  const blockquote = createBlockquoteElement(document);
  for (const child of plan.children) {
    renderNode(blockquote, child, context);
  }
  parent.appendChild(blockquote);
}

function appendInlineNode(
  parent: HTMLElement,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  renderInlineSyntaxNodeToDom(
    parent,
    node,
    context.doc,
    context.macros,
    "document-body",
    {
      ...context.referenceContext,
      imageUrlOverrides: context.imageUrlOverrides,
      footnoteNumbers: context.footnoteNumbers,
    },
  );
}

function appendInlineText(
  parent: HTMLElement,
  text: string,
  context: PreviewRenderContext,
  surface: "document-body" | "document-inline",
): void {
  renderInlineMarkdown(parent, text, context.macros, surface, {
    ...context.referenceContext,
    imageUrlOverrides: context.imageUrlOverrides,
    footnoteNumbers: context.footnoteNumbers,
  });
}
