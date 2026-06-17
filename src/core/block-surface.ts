import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "./document-surface-classes";
import { escapeHtml } from "./lib/html-escape";

export function blockSurfaceClassNames(type: string | undefined): string {
  return documentSurfaceClassNames(
    DOCUMENT_SURFACE_CLASS.block,
    type && DOCUMENT_SURFACE_CLASS.blockType(type),
  );
}

export interface BlockContainerSurfaceOptions {
  readonly types?: readonly string[];
  readonly id?: string;
  readonly dataAttributes?: Readonly<Record<string, string>>;
  readonly extraClassNames?: readonly string[];
}

export function blockContainerSurfaceClassNames(
  options: Pick<BlockContainerSurfaceOptions, "types" | "extraClassNames"> = {},
): string {
  return documentSurfaceClassNames(
    DOCUMENT_SURFACE_CLASS.block,
    ...(options.types ?? []).map((type) => DOCUMENT_SURFACE_CLASS.blockType(type)),
    ...(options.extraClassNames ?? []),
  );
}

export function blockContainerSurfaceAttrs(
  options: BlockContainerSurfaceOptions,
  extraAttrs = "",
): string {
  let attrs = ` class="${escapeHtml(blockContainerSurfaceClassNames(options))}"`;
  if (options.id) attrs += ` id="${escapeHtml(options.id)}"`;
  for (const [key, value] of Object.entries(options.dataAttributes ?? {})) {
    attrs += ` data-${escapeHtml(key)}="${escapeHtml(value)}"`;
  }
  return attrs + extraAttrs;
}

export function createBlockContainerElement(
  ownerDocument: Document,
  options: BlockContainerSurfaceOptions,
): HTMLDivElement {
  const block = ownerDocument.createElement("div");
  block.className = blockContainerSurfaceClassNames(options);
  if (options.id) block.id = options.id;
  for (const [key, value] of Object.entries(options.dataAttributes ?? {})) {
    block.setAttribute(`data-${key}`, value);
  }
  return block;
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
