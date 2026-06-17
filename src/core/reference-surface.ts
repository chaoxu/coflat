import { escapeHtml } from "./lib/html-escape";

export type ReferenceMode = "bracketed" | "narrative";

export interface ReferenceSurfaceSpec {
  readonly className: string;
  readonly refKey?: string;
  readonly refMode?: ReferenceMode;
  readonly sourceAttrs?: string;
}

export interface ReferenceListItemSpec {
  readonly className?: string;
  readonly id: string;
  readonly innerHtml?: string;
  readonly refKey?: string;
  readonly refMode?: ReferenceMode;
  readonly text?: string;
}

export interface ReferenceListSurfaceSpec extends ReferenceSurfaceSpec {
  readonly items: readonly ReferenceListItemSpec[];
  readonly prefixText?: string;
  readonly separatorText?: string;
  readonly suffixText?: string;
}

export function renderReferenceSurfaceHtml(
  innerHtml: string,
  spec: ReferenceSurfaceSpec,
): string {
  let attrs = ` class="${escapeHtml(spec.className)}"`;
  if (spec.refKey !== undefined) {
    attrs += ` data-ref-key="${escapeHtml(spec.refKey)}"`;
  }
  if (spec.refMode !== undefined) {
    attrs += ` data-ref-mode="${escapeHtml(spec.refMode)}"`;
  }
  if (spec.sourceAttrs) attrs += spec.sourceAttrs;
  return `<span${attrs}>${innerHtml}</span>`;
}

function referenceItemAttrs(item: ReferenceListItemSpec): string {
  let attrs = ` data-ref-id="${escapeHtml(item.id)}"`;
  const refKey = item.refKey ?? item.id;
  attrs += ` data-ref-key="${escapeHtml(refKey)}"`;
  if (item.refMode !== undefined) {
    attrs += ` data-ref-mode="${escapeHtml(item.refMode)}"`;
  }
  if (item.className) {
    attrs += ` class="${escapeHtml(item.className)}"`;
  }
  return attrs;
}

export function renderReferenceListSurfaceHtml(
  spec: ReferenceListSurfaceSpec,
): string {
  const pieces: string[] = [];
  if (spec.prefixText) pieces.push(escapeHtml(spec.prefixText));
  for (let index = 0; index < spec.items.length; index += 1) {
    if (index > 0 && spec.separatorText) {
      pieces.push(escapeHtml(spec.separatorText));
    }
    const item = spec.items[index];
    const inner = item.innerHtml ?? escapeHtml(item.text ?? "");
    pieces.push(`<span${referenceItemAttrs(item)}>${inner}</span>`);
  }
  if (spec.suffixText) pieces.push(escapeHtml(spec.suffixText));
  return renderReferenceSurfaceHtml(pieces.join(""), spec);
}

export function applyReferenceSurface(
  el: HTMLElement,
  spec: ReferenceSurfaceSpec,
): void {
  el.className = spec.className;
  if (spec.refKey !== undefined) {
    el.dataset.refKey = spec.refKey;
  } else {
    delete el.dataset.refKey;
  }
  if (spec.refMode !== undefined) {
    el.dataset.refMode = spec.refMode;
  } else {
    delete el.dataset.refMode;
  }
}

export function appendReferenceListSurfaceDom(
  container: HTMLElement,
  spec: ReferenceListSurfaceSpec,
): void {
  const ownerDocument = container.ownerDocument;
  if (spec.prefixText) {
    container.appendChild(ownerDocument.createTextNode(spec.prefixText));
  }
  for (let index = 0; index < spec.items.length; index += 1) {
    if (index > 0 && spec.separatorText) {
      container.appendChild(ownerDocument.createTextNode(spec.separatorText));
    }
    const item = spec.items[index];
    const span = ownerDocument.createElement("span");
    span.dataset.refId = item.id;
    span.dataset.refKey = item.refKey ?? item.id;
    if (item.refMode !== undefined) span.dataset.refMode = item.refMode;
    if (item.className) span.className = item.className;
    if (item.innerHtml !== undefined) {
      span.innerHTML = item.innerHtml;
    } else {
      span.textContent = item.text ?? "";
    }
    container.appendChild(span);
  }
  if (spec.suffixText) {
    container.appendChild(ownerDocument.createTextNode(spec.suffixText));
  }
}
