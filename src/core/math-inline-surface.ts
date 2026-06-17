import {
  CSS,
  mathSurfaceClassNames,
} from "./constants/css-classes";
import { escapeHtml } from "./lib/html-escape";

export interface InlineMathPlaceholderHtmlOptions {
  readonly sourceAttrs?: string;
}

export function inlineMathSurfaceClassNames(error = false): string {
  return mathSurfaceClassNames(false, error && CSS.mathError);
}

export function renderInlineMathPlaceholderHtml(
  latex: string,
  fallbackText: string,
  options: InlineMathPlaceholderHtmlOptions = {},
): string {
  return (
    `<span class="${inlineMathSurfaceClassNames()}" data-math="${escapeHtml(latex)}"${options.sourceAttrs ?? ""}>` +
    `${escapeHtml(fallbackText)}</span>`
  );
}

export function createInlineMathSurfaceElement(
  ownerDocument: Document,
  latex: string,
): HTMLSpanElement {
  const el = ownerDocument.createElement("span");
  syncInlineMathSurfaceElement(el, latex);
  return el;
}

export function syncInlineMathSurfaceElement(
  el: HTMLElement,
  latex: string,
): void {
  el.className = inlineMathSurfaceClassNames();
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", latex);
}

export function renderInlineMathErrorFallback(
  el: HTMLElement,
  fallbackText: string,
  label: string,
  options: { readonly role?: string } = {},
): void {
  el.className = inlineMathSurfaceClassNames(true);
  el.setAttribute("role", options.role ?? "img");
  el.setAttribute("aria-label", label);
  el.textContent = fallbackText;
}
