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
  documentSurfacePolicy,
  type DocumentSurfaceName,
} from "../../core/document-surface-policy";
import type { InlineSurfaceName } from "../../core/inline-surface-policy";
import type { InlineFragment } from "../../core/inline-fragments";
import { EXCLUDED_FROM_FALLBACK } from "../../core/constants/block-manifest";
import { CSS } from "../../core/constants/css-classes";
import { appendCodeBlockDom } from "../../core/code-block-surface";
import {
  createFootnoteSectionElement,
  footnoteSectionPlan,
} from "../../core/footnote-section-surface";
import {
  createDisplayMathContentElement,
  createDisplayMathSurfaceElement,
  replaceDisplayMathContent,
} from "../../core/math-display-surface";
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
  parseFrontmatter,
  parseMarkdownSource,
  type FrontmatterConfig,
} from "../../core/parser";
import {
  analyzeDocumentSemantics,
  numberFootnotes,
  orderedFootnoteEntries,
  stringTextSource,
  type DocumentSemantics,
} from "../semantics/document";
import {
  blockTitleOverridesFromConfig,
  computeBlockNumbers,
  createConfiguredBlockNumberingSpecLookup,
  displayTitleForBlockType,
} from "../../core/semantics/block-numbering";
import type { BlockPresentationPlan } from "../../core/block-presentation";
import {
  blockquoteRenderPlan,
  codeBlockRenderPlan,
  dispatchBlockNodeRender,
  documentRenderPlan,
  displayMathRenderPlan,
  emitBlockChildrenRenderPlan,
  emitDocumentRenderPlan,
  fencedDivRenderPlan,
  headingRenderPlan,
  horizontalRuleRenderPlan,
  listItemEmissionPlan,
  listRenderPlan,
  type ListItemRenderPlan,
  paragraphRenderPlan,
} from "../../core/block-render-plan";
import {
  fencedDivContainerOptions,
  fencedDivSurfaceAssemblyPlan,
} from "../../core/fenced-div-surface";
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
  readonly documentSurface?: DocumentSurfaceName;
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
  const surfacePolicy = documentSurfacePolicy(options.documentSurface ?? "editor-preview");
  const referenceController = createPreviewReferencePresentationController({
    bibliography: options.bibliography,
    blockCounters: options.blockCounters,
    documentContext: options.documentContext,
    documentPath: options.documentPath,
    formatter: options.formatter,
    referenceSemantics,
    surface: surfacePolicy.referenceHostSurface,
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
    surfacePolicy,
  };

  renderNode(container, tree.topNode, context);
  applyPreviewImageOverrides(container, context);
}

function renderNode(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  dispatchBlockNodeRender(node, {
    document: () => renderDocument(parent, node, context),
    paragraph: () => renderParagraph(parent, node, context),
    heading: () => renderHeading(parent, node, context),
    codeBlock: () => renderFencedCode(parent, node, context),
    list: () => renderList(parent, node, context),
    horizontalRule: () => renderHorizontalRule(parent, node),
    fencedDiv: () => renderFencedDiv(parent, node, context),
    displayMath: () => renderDisplayMath(parent, node, context),
    footnoteDefinition: () => undefined,
    table: () => renderPreviewTable(parent, node, context),
    blockquote: () => renderBlockquote(parent, node, context),
    ignored: () => undefined,
    fallback: () => renderChildNodes(parent, node, context),
  });
}

function renderDocument(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const plan = documentRenderPlan(context.doc, node);
  emitDocumentRenderPlan(plan, {
    emitBlank: (range) => appendBlankLine(parent, range.from, range.to),
    emitChild: (childPlan) => renderNode(parent, childPlan.node, context),
    afterDocument: () => appendFootnoteSection(parent, context),
  });
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
      context.surfacePolicy.bodyInlineSurface,
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
        context.surfacePolicy.bodyInlineSurface,
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
  const plan = codeBlockRenderPlan(context.doc, node);
  appendCodeBlockDom(parent, document, plan.language, plan.code);
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
  for (const childPlan of listItemEmissionPlan(plan)) {
    switch (childPlan.kind) {
      case "task":
        renderTaskListItem(parent, childPlan.node, plan, context, childPlan.wrapTaskContent);
        break;
      case "inline-paragraph":
        appendInlineNode(parent, childPlan.node, context);
        break;
      case "block":
        renderNode(parent, childPlan.node, context);
        break;
    }
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

    if (plan.task.contentMarkdown) {
      renderInlineMarkdown(
        target,
        plan.task.contentMarkdown,
        context.macros,
        context.surfacePolicy.bodyInlineSurface,
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
  const plan = fencedDivRenderPlan(context.doc, node, {
    displayTitleForBlockType: (blockType) => displayTitleForBlockType(blockType, context.blockTitleOverrides),
    numberForBlockType: () => context.documentBlockNumbers.get(node.from)?.number,
    semanticBlockDisclosures: context.surfacePolicy.semanticBlockDisclosures,
  });

  if (plan.classes.some((className) => EXCLUDED_FROM_FALLBACK.has(className))) {
    return;
  }

  const assembly = fencedDivSurfaceAssemblyPlan(plan);
  const block = createBlockContainerElement(document, fencedDivContainerOptions(plan));

  const summary = plan.presentation
    ? createBlockSummaryFragment(context, plan.presentation, plan.titleFragments)
    : undefined;
  const policy = context.surfacePolicy;

  if (assembly.renderSelfClosingTitleParagraph) {
    const paragraph = createParagraphDom(document);
    appendInlineFragments(paragraph, plan.titleFragments, context, policy.bodyInlineSurface);
    block.appendChild(paragraph);
  }

  if (assembly.renderBody) {
    const body = document.createDocumentFragment();
    emitBlockChildrenRenderPlan(plan.children, {
      emitBlank: (range) => appendBlankLine(body, range.from, range.to),
      emitChild: (childPlan) => renderNode(body, childPlan.node, context),
    });

    if (assembly.addQedToLastBodyBlock) {
      addClassToLastChildElement(body, CSS.blockQed);
    }
    if (assembly.prependInlineHeading && summary) {
      prependInlineBlockHeading(body, summary);
    }

    if (assembly.renderDisclosure && summary) {
      appendBlockHeader(block, summary, body);
    } else {
      if (assembly.renderStandaloneTitle) {
        const strong = createBlockLabelElement(document);
        appendInlineFragments(strong, plan.titleFragments, context, policy.labelInlineSurface);
        block.appendChild(strong);
      }
      if (assembly.appendPlainBody) {
        block.appendChild(body);
      }
    }
  }

  if (assembly.renderCaptionBelow && plan.presentation) {
    const caption = createBlockCaptionElement(document);
    appendBlockCaptionLabel(caption, plan.presentation.label);
    const text = appendBlockCaptionText(caption);
    appendInlineFragments(text, plan.titleFragments, context, policy.labelInlineSurface);
    block.appendChild(caption);
  }

  parent.appendChild(block);
}

function createBlockSummaryFragment(
  context: PreviewRenderContext,
  plan: BlockPresentationPlan,
  titleFragments: readonly InlineFragment[] = [],
): DocumentFragment {
  return createBlockSummarySurfaceFragment(
    document,
    plan.label,
    plan.showTitleInHeader
      ? (renderedTitle) => {
        appendInlineFragments(renderedTitle, titleFragments, context, context.surfacePolicy.labelInlineSurface);
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
  const plan = displayMathRenderPlan(context.doc, node);
  const equationNumber = plan.equationId
    ? context.semantics.equationById.get(plan.equationId)?.number
    : undefined;

  const wrapper = createDisplayMathSurfaceElement(document, plan.latex, {
    equationNumber,
    id: plan.equationId ?? undefined,
  });
  const content = createDisplayMathContentElement(document);
  renderKatex(content, plan.latex, true, context.macros);
  replaceDisplayMathContent(wrapper, content, equationNumber);

  parent.appendChild(wrapper);
}

function appendFootnoteSection(
  parent: HTMLElement | DocumentFragment,
  context: PreviewRenderContext,
): void {
  const orderedEntries = orderedFootnoteEntries(context.semantics.footnotes);
  if (orderedEntries.length === 0) return;

  const definitionsById = new Map(orderedEntries.map((entry) => [entry.id, entry.def]));
  const plannedEntries = footnoteSectionPlan(orderedEntries.map((entry) => ({
    num: entry.number,
    id: entry.id,
    defFrom: entry.def.from,
  })));
  if (plannedEntries.length === 0) return;

  parent.appendChild(createFootnoteSectionElement(
    document,
    plannedEntries.map((entry) => ({
      ...entry,
      appendContent: (content) => {
        const def = definitionsById.get(entry.id);
        if (!def) return;
        renderInlineMarkdown(
          content,
          def.content,
          context.macros,
          context.surfacePolicy.bodyInlineSurface,
          {
            ...context.referenceContext,
            imageUrlOverrides: context.imageUrlOverrides,
            footnoteNumbers: context.footnoteNumbers,
          },
        );
      },
    })),
  ));
}

function renderBlockquote(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const plan = blockquoteRenderPlan(node);
  const blockquote = createBlockquoteElement(document);
  emitBlockChildrenRenderPlan(plan.children, {
    emitBlank: () => undefined,
    emitChild: (childPlan) => renderNode(blockquote, childPlan.node, context),
  });
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
    context.surfacePolicy.bodyInlineSurface,
    {
      ...context.referenceContext,
      imageUrlOverrides: context.imageUrlOverrides,
      footnoteNumbers: context.footnoteNumbers,
    },
  );
}

function appendInlineFragments(
  parent: HTMLElement,
  fragments: readonly InlineFragment[],
  context: PreviewRenderContext,
  surface: InlineSurfaceName,
): void {
  renderInlineFragmentsToDom(parent, fragments, context.macros, surface, {
    ...context.referenceContext,
    imageUrlOverrides: context.imageUrlOverrides,
    footnoteNumbers: context.footnoteNumbers,
  });
}
