import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "./document-surface-classes";

export function blockSurfaceClassNames(type: string | undefined): string {
  return documentSurfaceClassNames(
    DOCUMENT_SURFACE_CLASS.block,
    type && DOCUMENT_SURFACE_CLASS.blockType(type),
  );
}

export function renderHorizontalRuleHtml(attrs = ""): string {
  return `<hr class="${blockSurfaceClassNames("hr")}"${attrs}>`;
}

export function createHorizontalRuleElement(ownerDocument: Document): HTMLHRElement {
  const hr = ownerDocument.createElement("hr");
  hr.className = blockSurfaceClassNames("hr");
  return hr;
}

export function renderBlankLineHtml(attrs = ""): string {
  return `<div class="${DOCUMENT_SURFACE_CLASS.blankLine}" aria-hidden="true"${attrs}><br></div>`;
}

export function createBlankLineElement(ownerDocument: Document): HTMLDivElement {
  const spacer = ownerDocument.createElement("div");
  spacer.className = DOCUMENT_SURFACE_CLASS.blankLine;
  spacer.setAttribute("aria-hidden", "true");
  spacer.appendChild(ownerDocument.createElement("br"));
  return spacer;
}

export function renderBlockquoteHtml(innerHtml: string, attrs = ""): string {
  return `<blockquote class="${DOCUMENT_SURFACE_CLASS.blockquote}"${attrs}>${innerHtml}</blockquote>`;
}

export function createBlockquoteElement(ownerDocument: Document): HTMLQuoteElement {
  const blockquote = ownerDocument.createElement("blockquote");
  blockquote.className = DOCUMENT_SURFACE_CLASS.blockquote;
  return blockquote;
}
