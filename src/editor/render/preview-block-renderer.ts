import type { SyntaxNode } from "@lezer/common";
import type {
  CitationFormatter,
  DocumentContext,
} from "../../core/document-context-types";
import {
  BLOCK_MANIFEST_ENTRIES,
  EXCLUDED_FROM_FALLBACK,
  isCollapsibleBlockType,
  type BlockManifestEntry,
} from "../../core/constants/block-manifest";
import { CSS } from "../../core/constants/css-classes";
import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "../../core/document-surface-classes";
import { appendCodeBlockDom } from "../../core/code-block-surface";
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
  isLooseListNode,
  orderedListStartNumber,
} from "../../core/parser/list-shape";
import {
  analyzeDocumentSemantics,
  stringTextSource,
  type DocumentSemantics,
} from "../semantics/document";
import {
  blockTitleOverridesFromConfig,
  computeBlockNumbers,
  createConfiguredBlockNumberingSpecLookup,
  displayTitleForBlockType,
} from "../../core/semantics/block-numbering";
import type { BibStore } from "../state/bib-data";
import {
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
      renderHeading(parent, node, context);
      return;
    case "FencedCode":
      renderFencedCode(parent, node, context);
      return;
    case "BulletList":
      renderList(parent, node, context, "ul");
      return;
    case "OrderedList":
      renderList(parent, node, context, "ol");
      return;
    case "HorizontalRule": {
      const hr = document.createElement("hr");
      hr.className = CSS.block("hr");
      parent.appendChild(hr);
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
  appendParagraphDom(parent, document, (paragraph) => {
    appendInlineNode(paragraph, node, context);
  });
}

function renderHeading(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const heading = context.semantics.headingByFrom.get(node.from);
  const fallbackLevel = Number(node.name[node.name.length - 1]);
  const level = heading?.level ?? fallbackLevel;
  const element = document.createElement(`h${level}`) as HTMLHeadingElement;
  element.className = documentSurfaceClassNames(
    DOCUMENT_SURFACE_CLASS.heading,
    DOCUMENT_SURFACE_CLASS.headingLevel(level),
    heading?.unnumbered && DOCUMENT_SURFACE_CLASS.headingUnnumbered,
  );
  if (heading) {
    if (heading.unnumbered) {
      element.dataset.headingNumbering = "none";
    } else {
      element.dataset.sectionNumber = heading.number;
    }
  }

  if (heading?.id) {
    element.id = heading.id;
  }
  renderInlineMarkdown(
    element,
    heading?.text ?? context.doc.slice(node.from, node.to).replace(/^#{1,6}\s*/, "").trim(),
    context.macros,
    "document-body",
    context.referenceContext,
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
  tag: "ul" | "ol",
): void {
  const list = document.createElement(tag);
  const start = tag === "ol" ? orderedListStartNumber(node, context.doc) : 1;
  if (tag === "ol") {
    if (start !== 1) {
      list.setAttribute("start", String(start));
    }
  }
  const loose = isLooseListNode(node, context.doc);
  let isTaskList = false;
  let child = node.firstChild;
  let itemIndex = 0;

  while (child) {
    if (child.name === "ListItem") {
      const item = document.createElement("li");
      const markerNumber = start + itemIndex;
      itemIndex += 1;
      const taskMarker = child.getChild("Task")?.getChild("TaskMarker") ?? null;
      const isTask = taskMarker !== null;
      isTaskList ||= isTask;
      item.className = documentSurfaceClassNames(
        DOCUMENT_SURFACE_CLASS.listItem,
        isTask && DOCUMENT_SURFACE_CLASS.listItemCheck,
      );
      if (taskMarker) {
        const checked = context.doc.slice(taskMarker.from, taskMarker.to) !== "[ ]";
        item.dataset.checked = String(checked);
      }
      appendListMarker(item, tag, markerNumber);
      renderListItem(item, child, context);
      list.appendChild(item);
    }
    child = child.nextSibling;
  }

  list.className = documentSurfaceClassNames(
    DOCUMENT_SURFACE_CLASS.list,
    tag === "ol" ? DOCUMENT_SURFACE_CLASS.listOrdered : DOCUMENT_SURFACE_CLASS.listUnordered,
    isTaskList && DOCUMENT_SURFACE_CLASS.listCheck,
    loose ? DOCUMENT_SURFACE_CLASS.listLoose : DOCUMENT_SURFACE_CLASS.listTight,
  );
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
  const spacer = document.createElement("div");
  spacer.className = DOCUMENT_SURFACE_CLASS.blankLine;
  spacer.setAttribute("aria-hidden", "true");
  spacer.appendChild(document.createElement("br"));
  parent.appendChild(spacer);
}

function appendListMarker(parent: HTMLElement, tag: "ul" | "ol", number: number): void {
  const marker = document.createElement("span");
  marker.className = tag === "ol" ? CSS.listNumber : CSS.listBullet;
  marker.textContent = tag === "ol" ? `${number}.` : "•";
  parent.appendChild(marker);
  parent.appendChild(document.createTextNode(" "));
}

// Matches the reader's unwrap rule: an item whose content is exactly one
// paragraph renders it inline; anything else keeps block wrappers.
function isSingleParagraphItem(node: SyntaxNode): boolean {
  let blockCount = 0;
  let onlyParagraph = true;
  let child = node.firstChild;
  while (child) {
    if (child.name !== "ListMark") {
      blockCount += 1;
      if (child.name !== "Paragraph" && child.name !== "Task") onlyParagraph = false;
    }
    child = child.nextSibling;
  }
  return blockCount === 1 && onlyParagraph;
}

function renderListItem(
  parent: HTMLElement,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const inlineOnly = isSingleParagraphItem(node);
  let child = node.firstChild;

  while (child) {
    if (child.name === "ListMark") {
      child = child.nextSibling;
      continue;
    }

    if (child.name === "Task") {
      renderTaskListItem(parent, child, context, !inlineOnly);
      child = child.nextSibling;
      continue;
    }

    if (child.name === "Paragraph" && inlineOnly) {
      appendInlineNode(parent, child, context);
      child = child.nextSibling;
      continue;
    }

    renderNode(parent, child, context);
    child = child.nextSibling;
  }
}

function renderTaskListItem(
  parent: HTMLElement,
  node: SyntaxNode,
  context: PreviewRenderContext,
  wrap: boolean,
): void {
  const target = wrap ? document.createElement("p") : parent;
  if (wrap) {
    target.className = DOCUMENT_SURFACE_CLASS.paragraph;
  }
  const taskMarker = node.getChild("TaskMarker");
  if (taskMarker) {
    const markerText = context.doc.slice(taskMarker.from, taskMarker.to);
    const input = document.createElement("input");
    input.type = "checkbox";
    // Non-interactive without `disabled`, matching the reader's emission
    // (disabled checkboxes gray out in some user agents).
    input.tabIndex = -1;
    input.setAttribute("aria-disabled", "true");
    input.checked = markerText !== "[ ]";
    // The checkbox sits directly in the <li>, before any paragraph wrapper,
    // matching the reader's emission.
    parent.appendChild(input);
    parent.appendChild(document.createTextNode(" "));

    const contentStart = Math.min(taskMarker.to + 1, node.to);
    const content = context.doc.slice(contentStart, node.to).trim();
    if (content) {
      renderInlineMarkdown(
        target,
        content,
        context.macros,
        "document-body",
        context.referenceContext,
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

  const block = document.createElement("div");
  for (const className of classes) {
    block.classList.add(...CSS.block(className).split(" "));
  }
  if (id) {
    block.id = id;
  }

  const title = fencedDiv?.title ?? "";
  const isSelfClosing = fencedDiv?.isSelfClosing ?? false;
  const primaryClass = getPrimaryBlockClass(classes);
  const primaryClassName = primaryClass?.name ?? fencedDiv?.primaryClass;
  const blockNumber = primaryClassName
    ? context.documentBlockNumbers.get(node.from)?.number
    : undefined;
  const captionBelow = primaryClass?.captionPosition === "below";
  const inlineHeader = primaryClass?.headerPosition === "inline";
  const summary = primaryClassName
    ? createBlockSummaryFragment(context, primaryClassName, title, blockNumber)
    : undefined;
  const headerLabel = getBlockHeaderLabel(context, primaryClass, blockNumber);

  if (title && isSelfClosing) {
    const paragraph = document.createElement("p");
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

    if (inlineHeader && summary) {
      if (primaryClass?.specialBehavior === "qed") {
        addClassToLastChildElement(body, CSS.blockQed);
      }
      prependInlineHeader(body, summary);
    }

    if (summary && isCollapsibleBlockType(primaryClassName)) {
      appendBlockHeader(block, summary, body);
    } else {
      if (title && !captionBelow && !inlineHeader) {
        const strong = document.createElement("strong");
        strong.className = CSS.blockHeaderRendered;
        appendInlineText(strong, title, context, "document-body");
        block.appendChild(strong);
      }
      block.appendChild(body);
    }
  }

  if (!isSelfClosing && captionBelow && title) {
    const caption = document.createElement("div");
    caption.className = "cf-block-caption";

    const label = document.createElement("span");
    label.className = CSS.blockHeaderRendered;
    label.textContent = headerLabel;
    caption.appendChild(label);

    const text = document.createElement("span");
    text.className = "cf-block-caption-text";
    appendInlineText(text, title, context, "document-body");
    caption.appendChild(text);
    block.appendChild(caption);
  }

  parent.appendChild(block);
}

function getPrimaryBlockClass(classes: readonly string[]): BlockManifestEntry | undefined {
  return BLOCK_MANIFEST_ENTRIES.find((entry) => classes.includes(entry.name));
}

function getBlockHeaderLabel(
  context: PreviewRenderContext,
  entry: BlockManifestEntry | undefined,
  number: number | undefined,
): string {
  if (!entry) return "";
  const title = displayTitleForBlockType(entry.name, context.blockTitleOverrides);
  return number === undefined ? title : `${title} ${number}`;
}

function createBlockSummaryFragment(
  context: PreviewRenderContext,
  blockType: string,
  title: string,
  number: number | undefined,
): DocumentFragment {
  const summary = document.createDocumentFragment();
  const displayTitle = displayTitleForBlockType(blockType, context.blockTitleOverrides);
  const headerText = blockType === "proof"
    ? "Proof"
    : number === undefined
      ? displayTitle
      : `${displayTitle} ${number}`;

  const header = document.createElement("span");
  header.className = CSS.blockHeaderRendered;
  header.textContent = headerText;
  summary.appendChild(header);

  if (title && blockType !== "proof") {
    const attrTitle = document.createElement("span");
    attrTitle.className = CSS.blockAttrTitle;

    const openParen = document.createElement("span");
    openParen.className = CSS.blockTitleParen;
    openParen.textContent = "(";
    attrTitle.appendChild(openParen);

    const renderedTitle = document.createElement("span");
    appendInlineText(renderedTitle, title, context, "document-body");
    attrTitle.appendChild(renderedTitle);

    const closeParen = document.createElement("span");
    closeParen.className = CSS.blockTitleParen;
    closeParen.textContent = ")";
    attrTitle.appendChild(closeParen);

    summary.appendChild(attrTitle);
  }

  return summary;
}

function appendBlockHeader(
  block: HTMLElement,
  summary: DocumentFragment,
  body: DocumentFragment,
): void {
  const heading = document.createElement("div");
  heading.className = DOCUMENT_SURFACE_CLASS.blockHeading;

  const headingContent = document.createElement("span");
  headingContent.className = CSS.blockHeadingContent;
  headingContent.appendChild(summary);
  heading.appendChild(headingContent);
  block.appendChild(heading);

  const bodyWrapper = document.createElement("div");
  bodyWrapper.className = CSS.blockDisclosureBody;
  bodyWrapper.appendChild(body);
  block.appendChild(bodyWrapper);
}

function prependInlineHeader(body: DocumentFragment, summary: DocumentFragment): void {
  const header = document.createElement("span");
  header.className = DOCUMENT_SURFACE_CLASS.blockHeading;
  header.appendChild(summary);

  const first = body.firstElementChild;
  if (first instanceof HTMLParagraphElement) {
    first.prepend(header);
    return;
  }

  const paragraph = createParagraphDom(document, (paragraph) => {
    paragraph.appendChild(header);
  });
  body.prepend(paragraph);
}

function addClassToLastChildElement(parent: DocumentFragment, className: string): void {
  parent.lastElementChild?.classList.add(className);
}

function renderDisplayMath(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const marks = node.getChildren("DisplayMathMark");
  let latex = "";

  if (marks.length >= 2) {
    const afterOpen = marks[0].to;
    const beforeClose = marks[marks.length - 1].from;
    if (beforeClose > afterOpen) {
      latex = context.doc.slice(afterOpen, beforeClose).trim();
    }
  } else if (marks.length === 1) {
    latex = context.doc.slice(marks[0].to, node.to).trim();
  }

  const equationLabel = node.getChild("EquationLabel");
  const equationId = equationLabel
    ? readBracedLabelId(context.doc, equationLabel.from, equationLabel.to, "eq:")
    : null;
  const equationNumber = equationId
    ? context.semantics.equationById.get(equationId)?.number
    : undefined;

  const wrapper = document.createElement("div");
  wrapper.className = equationNumber === undefined
    ? CSS.mathDisplay
    : `${CSS.mathDisplay} ${CSS.mathDisplayNumbered}`;
  if (equationId) {
    wrapper.id = equationId;
  }

  if (equationNumber === undefined) {
    renderKatex(wrapper, latex, true, context.macros);
  } else {
    const content = document.createElement("div");
    content.className = CSS.mathDisplayContent;
    renderKatex(content, latex, true, context.macros);
    wrapper.appendChild(content);

    const number = document.createElement("span");
    number.className = CSS.mathDisplayNumber;
    number.textContent = `(${equationNumber})`;
    wrapper.appendChild(number);
  }

  parent.appendChild(wrapper);
}

function renderFootnoteDef(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const footnote = context.semantics.footnotes.defByFrom.get(node.from);
  if (!footnote) return;

  const block = document.createElement("div");
  block.className = "footnote";
  block.id = `fn-${footnote.id}`;

  const label = document.createElement("sup");
  label.textContent = footnote.id;
  block.appendChild(label);
  block.appendChild(document.createTextNode(" "));

  if (footnote.content) {
    const paragraph = document.createElement("p");
    appendInlineText(paragraph, footnote.content, context, "document-body");
    block.appendChild(paragraph);
  }

  parent.appendChild(block);
}

function renderBlockquote(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const blockquote = document.createElement("blockquote");
  blockquote.className = DOCUMENT_SURFACE_CLASS.blockquote;
  renderChildNodes(blockquote, node, context);
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
    context.referenceContext,
  );
}

function appendInlineText(
  parent: HTMLElement,
  text: string,
  context: PreviewRenderContext,
  surface: "document-body" | "document-inline",
): void {
  renderInlineMarkdown(parent, text, context.macros, surface, context.referenceContext);
}
