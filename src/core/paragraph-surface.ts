import { DOCUMENT_SURFACE_CLASS } from "./document-surface-classes";

export function renderParagraphHtml(innerHtml: string, attrs = ""): string {
  return `<p class="${DOCUMENT_SURFACE_CLASS.paragraph}"${attrs}>${innerHtml}</p>`;
}

export function appendParagraphDom(
  parent: HTMLElement | DocumentFragment,
  ownerDocument: Document,
  appendContent: (paragraph: HTMLParagraphElement) => void,
): HTMLParagraphElement {
  const paragraph = createParagraphDom(ownerDocument, appendContent);
  parent.appendChild(paragraph);
  return paragraph;
}

export function createParagraphDom(
  ownerDocument: Document,
  appendContent?: (paragraph: HTMLParagraphElement) => void,
): HTMLParagraphElement {
  const paragraph = ownerDocument.createElement("p");
  paragraph.className = DOCUMENT_SURFACE_CLASS.paragraph;
  appendContent?.(paragraph);
  return paragraph;
}
