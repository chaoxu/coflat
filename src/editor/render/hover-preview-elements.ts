import {
  createHoverPreviewContentElement,
  createHoverPreviewHeaderElement,
} from "../../core/hover-preview-surface";
import { renderDocumentFragmentToDom } from "../document-surfaces";

export function createHoverPreviewHeader(
  text: string,
  macros: Record<string, string> = {},
  extraClass?: string,
): HTMLElement {
  const header = createHoverPreviewHeaderElement("", extraClass);
  renderDocumentFragmentToDom(header, {
    kind: "title",
    text,
    macros,
  });
  return header;
}

export function createHoverPreviewContent(
  extraClass?: string | null,
): HTMLElement {
  return createHoverPreviewContentElement(extraClass);
}
