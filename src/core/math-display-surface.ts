import {
  CSS,
  mathSurfaceClassNames,
} from "./constants/css-classes";
import { escapeHtml } from "./lib/html-escape";

export interface DisplayMathSurfaceOptions {
  readonly equationNumber?: number | string;
  readonly hasQedMarker?: boolean;
}

export interface DisplayMathPlaceholderHtmlOptions extends DisplayMathSurfaceOptions {
  readonly id?: string;
  readonly sourceAttrs?: string;
}

export function displayMathSurfaceClassNames(
  options: DisplayMathSurfaceOptions = {},
): string {
  return mathSurfaceClassNames(
    true,
    options.equationNumber !== undefined && CSS.mathDisplayNumbered,
    options.hasQedMarker && CSS.blockQed,
  );
}

export function createDisplayMathSurfaceElement(
  ownerDocument: Document,
  latex: string,
  options: DisplayMathSurfaceOptions & { readonly id?: string } = {},
): HTMLDivElement {
  const el = ownerDocument.createElement("div");
  el.className = displayMathSurfaceClassNames(options);
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", latex);
  if (options.id) el.id = options.id;
  return el;
}

export function renderDisplayMathPlaceholderHtml(
  latex: string,
  fallbackText: string,
  options: DisplayMathPlaceholderHtmlOptions = {},
): string {
  const idAttr = options.id ? ` id="${escapeHtml(options.id)}"` : "";
  const numberAttr = options.equationNumber !== undefined
    ? ` data-equation-number="${escapeHtml(String(options.equationNumber))}"`
    : "";
  const sourceAttrs = options.sourceAttrs ?? "";
  return (
    `<div class="${displayMathSurfaceClassNames(options)}"${idAttr}` +
    ` data-math="${escapeHtml(latex)}"${numberAttr}${sourceAttrs}>` +
    `${escapeHtml(fallbackText)}</div>`
  );
}

export function createDisplayMathContentElement(
  ownerDocument: Document,
): HTMLDivElement {
  const content = ownerDocument.createElement("div");
  content.className = CSS.mathDisplayContent;
  return content;
}

export function syncDisplayMathEquationNumber(
  el: HTMLElement,
  equationNumber: number | string | undefined,
): void {
  el.classList.toggle(CSS.mathDisplayNumbered, equationNumber !== undefined);
  const numberText = equationNumber !== undefined ? `(${equationNumber})` : undefined;
  const numberEl = el.querySelector<HTMLElement>(`.${CSS.mathDisplayNumber}`);

  if (!numberText) {
    numberEl?.remove();
    return;
  }

  if (numberEl) {
    numberEl.textContent = numberText;
    return;
  }

  const nextNumberEl = el.ownerDocument.createElement("span");
  nextNumberEl.className = CSS.mathDisplayNumber;
  nextNumberEl.textContent = numberText;
  el.appendChild(nextNumberEl);
}

export function replaceDisplayMathContent(
  el: HTMLElement,
  content: HTMLElement,
  equationNumber: number | string | undefined,
): void {
  content.className = CSS.mathDisplayContent;
  el.replaceChildren(content);
  syncDisplayMathEquationNumber(el, equationNumber);
}
