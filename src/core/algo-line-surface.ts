import { DOCUMENT_SURFACE_CLASS } from "./document-surface-classes";

/**
 * Rendered surface for one Erickson-style algo pseudocode line.
 *
 * Indentation is the line's literal leading whitespace, preserved inside the
 * rendered content (`white-space: break-spaces`) so the reader stays
 * pixel-aligned with the CM6 editor, which shows the source spaces. The
 * indent depth is exposed as `data-indent` for theming and tooling.
 */

export function renderAlgoLineHtml(
  innerHtml: string,
  indentDepth: number,
  attrs = "",
): string {
  const indent = indentDepth > 0 ? ` data-indent="${indentDepth}"` : "";
  return `<div class="${DOCUMENT_SURFACE_CLASS.algoLine}"${indent}${attrs}>${innerHtml}</div>`;
}

export function createAlgoLineDom(
  ownerDocument: Document,
  indentDepth: number,
  appendContent?: (line: HTMLDivElement) => void,
): HTMLDivElement {
  const line = ownerDocument.createElement("div");
  line.className = DOCUMENT_SURFACE_CLASS.algoLine;
  if (indentDepth > 0) {
    line.dataset.indent = String(indentDepth);
  }
  appendContent?.(line);
  return line;
}
