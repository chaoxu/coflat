import { CSS } from "./constants/css-classes";
import { escapeHtml } from "./lib/html-escape";

export function footnoteAnchorId(id: string): string {
  return `fn-${encodeURIComponent(id)}`;
}

export function footnoteReferenceAnchorId(id: string): string {
  return `fnref-${encodeURIComponent(id)}`;
}

export function renderReaderFootnoteReferenceHtml(
  number: number,
  id: string,
  attrs = "",
): string {
  const anchorId = escapeHtml(footnoteAnchorId(id));
  const refId = escapeHtml(footnoteReferenceAnchorId(id));
  return (
    `<sup class="${CSS.footnoteRef}"${attrs}>` +
    `<a href="#${anchorId}" id="${refId}">${number}</a>` +
    `</sup>`
  );
}

export function createReaderFootnoteReferenceElement(
  ownerDocument: Document,
  label: string,
  id: string,
): HTMLElement {
  const sup = ownerDocument.createElement("sup");
  sup.className = CSS.footnoteRef;

  const anchor = ownerDocument.createElement("a");
  anchor.href = `#${footnoteAnchorId(id)}`;
  anchor.id = footnoteReferenceAnchorId(id);
  anchor.textContent = label;
  sup.appendChild(anchor);

  return sup;
}

export function createEditorFootnoteReferenceElement(
  ownerDocument: Document,
  number: number,
  id: string,
): HTMLElement {
  const el = ownerDocument.createElement("sup");
  el.className = CSS.sidenoteRef;
  el.textContent = String(number);
  el.setAttribute("data-footnote-id", id);
  el.setAttribute("aria-label", `Footnote ${id}`);
  return el;
}
