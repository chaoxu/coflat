import { CSS } from "./constants/css-classes";
import { DOCUMENT_SURFACE_CLASS } from "./document-surface-classes";
import { escapeHtml } from "./lib/html-escape";
import { createParagraphDom, renderParagraphHtml } from "./paragraph-surface";

export function renderBlockLabelContentHtml(labelHtml: string): string {
  return `<span class="${CSS.blockHeaderRendered}">${labelHtml}</span>`;
}

export function renderBlockLabelHtml(label: string): string {
  return renderBlockLabelContentHtml(escapeHtml(label));
}

export function renderBlockAttributeTitleHtml(titleHtml: string): string {
  return (
    `<span class="${CSS.blockAttrTitle}">` +
    `<span class="${CSS.blockTitleParen}">(</span>` +
    `<span>${titleHtml}</span>` +
    `<span class="${CSS.blockTitleParen}">)</span>` +
    `</span>`
  );
}

export function renderBlockSummaryHtml(label: string, titleHtml?: string): string {
  return renderBlockLabelHtml(label) + (titleHtml === undefined ? "" : renderBlockAttributeTitleHtml(titleHtml));
}

export function renderBlockDisclosureHtml(summaryHtml: string, bodyHtml: string): string {
  return (
    `<div class="${DOCUMENT_SURFACE_CLASS.blockHeading}">` +
    `<span class="${CSS.blockHeadingContent}">${summaryHtml}</span>` +
    `</div>` +
    `<div class="${CSS.blockDisclosureBody}">${bodyHtml}</div>`
  );
}

export function renderInlineBlockHeadingHtml(summaryHtml: string): string {
  return `<span class="${DOCUMENT_SURFACE_CLASS.blockHeading}">${summaryHtml}</span>`;
}

export function renderInlineBlockHeadingContainerHtml(
  attrs: string,
  sourceAttrs: string,
  summaryHtml: string,
  bodyHtml: string,
): string {
  const fallbackHtml = (
    `<div${attrs}${sourceAttrs}>` +
    renderParagraphHtml(renderInlineBlockHeadingHtml(summaryHtml)) +
    bodyHtml +
    `</div>`
  );
  const firstParagraph = bodyHtml.match(/^<p\b([^>]*)>/);
  if (!firstParagraph?.[1] || !/\bclass="[^"]*\bcf-doc-paragraph\b[^"]*"/.test(firstParagraph[1])) {
    return fallbackHtml;
  }

  const openEnd = firstParagraph[0].length - 1;
  const closeStart = bodyHtml.indexOf("</p>", openEnd + 1);
  if (closeStart < 0) {
    return fallbackHtml;
  }

  const paragraphAttrs = firstParagraph[1];
  const firstInner = bodyHtml.slice(openEnd + 1, closeStart).replace(/^\s+/, "");
  const rest = bodyHtml.slice(closeStart + "</p>".length);
  return (
    `<div${attrs}${sourceAttrs}>` +
    `<p${paragraphAttrs}>` +
    renderInlineBlockHeadingHtml(summaryHtml) +
    firstInner +
    `</p>` +
    rest +
    `</div>`
  );
}

export function createBlockLabelElement(
  ownerDocument: Document,
  label = "",
): HTMLSpanElement {
  const labelEl = ownerDocument.createElement("span");
  labelEl.className = CSS.blockHeaderRendered;
  labelEl.textContent = label;
  return labelEl;
}

export function appendBlockLabel(
  parent: HTMLElement | DocumentFragment,
  label = "",
): HTMLSpanElement {
  const labelEl = createBlockLabelElement(parent.ownerDocument, label);
  parent.appendChild(labelEl);
  return labelEl;
}

export function createBlockAttributeTitleElement(
  ownerDocument: Document,
  appendTitleContent: (titleContent: HTMLSpanElement) => void,
): HTMLSpanElement {
  const attrTitle = ownerDocument.createElement("span");
  populateBlockAttributeTitleElement(attrTitle, appendTitleContent);
  return attrTitle;
}

export function populateBlockAttributeTitleElement(
  attrTitle: HTMLSpanElement,
  appendTitleContent: (titleContent: HTMLSpanElement) => void,
): void {
  const ownerDocument = attrTitle.ownerDocument;
  attrTitle.className = CSS.blockAttrTitle;
  attrTitle.textContent = "";

  const openParen = ownerDocument.createElement("span");
  openParen.className = CSS.blockTitleParen;
  openParen.textContent = "(";
  attrTitle.appendChild(openParen);

  const titleContent = ownerDocument.createElement("span");
  appendTitleContent(titleContent);
  attrTitle.appendChild(titleContent);

  const closeParen = ownerDocument.createElement("span");
  closeParen.className = CSS.blockTitleParen;
  closeParen.textContent = ")";
  attrTitle.appendChild(closeParen);
}

export function appendBlockAttributeTitle(
  parent: HTMLElement | DocumentFragment,
  appendTitleContent: (titleContent: HTMLSpanElement) => void,
): HTMLSpanElement {
  const attrTitle = createBlockAttributeTitleElement(parent.ownerDocument, appendTitleContent);
  parent.appendChild(attrTitle);
  return attrTitle;
}

export function createBlockSummaryFragment(
  ownerDocument: Document,
  label: string,
  appendTitleContent?: (titleContent: HTMLSpanElement) => void,
): DocumentFragment {
  const summary = ownerDocument.createDocumentFragment();
  appendBlockLabel(summary, label);
  if (appendTitleContent) {
    appendBlockAttributeTitle(summary, appendTitleContent);
  }
  return summary;
}

export function appendBlockDisclosure(
  block: HTMLElement,
  summary: DocumentFragment,
  body: DocumentFragment,
): void {
  const heading = block.ownerDocument.createElement("div");
  heading.className = DOCUMENT_SURFACE_CLASS.blockHeading;

  const headingContent = block.ownerDocument.createElement("span");
  headingContent.className = CSS.blockHeadingContent;
  headingContent.appendChild(summary);
  heading.appendChild(headingContent);
  block.appendChild(heading);

  const bodyWrapper = block.ownerDocument.createElement("div");
  bodyWrapper.className = CSS.blockDisclosureBody;
  bodyWrapper.appendChild(body);
  block.appendChild(bodyWrapper);
}

export function createInlineBlockHeadingElement(
  ownerDocument: Document,
  summary: DocumentFragment,
): HTMLSpanElement {
  const header = ownerDocument.createElement("span");
  header.className = DOCUMENT_SURFACE_CLASS.blockHeading;
  header.appendChild(summary);
  return header;
}

export function prependInlineBlockHeading(
  body: DocumentFragment,
  summary: DocumentFragment,
): void {
  const header = createInlineBlockHeadingElement(body.ownerDocument, summary);

  const first = body.firstElementChild;
  if (first?.tagName === "P") {
    first.prepend(header);
    return;
  }

  const paragraph = createParagraphDom(body.ownerDocument, (paragraph) => {
    paragraph.appendChild(header);
  });
  body.prepend(paragraph);
}
