import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "./document-surface-classes";
import { escapeHtml } from "./lib/html-escape";

export function headingSurfaceClassNames(
  level: number,
  unnumbered = false,
): string {
  return documentSurfaceClassNames(
    DOCUMENT_SURFACE_CLASS.heading,
    DOCUMENT_SURFACE_CLASS.headingLevel(level),
    unnumbered && DOCUMENT_SURFACE_CLASS.headingUnnumbered,
  );
}

export function headingNumberingHtmlAttrs(
  sectionNumber: string | undefined,
  unnumbered: boolean,
): string {
  return unnumbered
    ? ' data-heading-numbering="none"'
    : ` data-section-number="${escapeHtml(sectionNumber ?? "")}"`;
}

export function setHeadingNumberingAttrs(
  element: HTMLElement,
  sectionNumber: string | undefined,
  unnumbered: boolean,
): void {
  if (unnumbered) {
    element.dataset.headingNumbering = "none";
    delete element.dataset.sectionNumber;
    return;
  }
  element.dataset.sectionNumber = sectionNumber ?? "";
  delete element.dataset.headingNumbering;
}

export interface HeadingSurfaceOptions {
  readonly level: number;
  readonly id?: string;
  readonly sectionNumber?: string;
  readonly unnumbered: boolean;
}

export function renderHeadingSurfaceHtml(
  innerHtml: string,
  options: HeadingSurfaceOptions,
  attrs = "",
): string {
  const idAttr = options.id ? ` id="${escapeHtml(options.id)}"` : "";
  return (
    `<h${options.level} class="${headingSurfaceClassNames(options.level, options.unnumbered)}"` +
    `${idAttr}${headingNumberingHtmlAttrs(options.sectionNumber, options.unnumbered)}${attrs}>` +
    `${innerHtml}</h${options.level}>`
  );
}

export function createHeadingSurfaceElement(
  ownerDocument: Document,
  options: HeadingSurfaceOptions,
  appendContent: (heading: HTMLHeadingElement) => void,
): HTMLHeadingElement {
  const heading = ownerDocument.createElement(`h${options.level}`) as HTMLHeadingElement;
  heading.className = headingSurfaceClassNames(options.level, options.unnumbered);
  setHeadingNumberingAttrs(heading, options.sectionNumber, options.unnumbered);
  if (options.id) heading.id = options.id;
  appendContent(heading);
  return heading;
}
