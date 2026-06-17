import { escapeHtml } from "./lib/html-escape";

export type ReferenceMode = "bracketed" | "narrative";

export interface ReferenceSurfaceSpec {
  readonly className: string;
  readonly refKey?: string;
  readonly refMode?: ReferenceMode;
  readonly sourceAttrs?: string;
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
