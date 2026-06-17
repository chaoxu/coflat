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
