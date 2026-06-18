import { CSS } from "./constants/css-classes";
import {
  createPreviewSurfaceBody,
  createPreviewSurfaceContent,
  createPreviewSurfaceHeader,
} from "./preview-surface";
import { unresolvedReferencePreviewLabel } from "./reference-preview-source";

export function createHoverPreviewContentElement(
  extraClass?: string | null,
): HTMLElement {
  return createPreviewSurfaceContent(CSS.hoverPreview, extraClass);
}

export function createHoverPreviewHeaderElement(
  text = "",
  extraClass?: string | null,
): HTMLElement {
  const header = createPreviewSurfaceHeader(CSS.hoverPreviewHeader, extraClass);
  header.textContent = text;
  return header;
}

export function createHoverPreviewBodyElement(
  extraClass?: string | null,
): HTMLElement {
  return createPreviewSurfaceBody(CSS.hoverPreviewBody, extraClass);
}

export function createHoverPreviewCitationBodyElement(): HTMLElement {
  return createPreviewSurfaceBody(CSS.hoverPreviewCitation);
}

export function createHoverPreviewTextElement(
  text: string,
  bodyClass: string = CSS.hoverPreviewCitation,
): HTMLElement {
  const container = createHoverPreviewContentElement();
  const body = createPreviewSurfaceBody(bodyClass);
  body.textContent = text;
  container.appendChild(body);
  return container;
}

export function createHoverPreviewElementWithBody(
  body: HTMLElement,
): HTMLElement {
  const container = createHoverPreviewContentElement();
  container.appendChild(body);
  return container;
}

export function createHoverPreviewElementWithChild(
  child: HTMLElement,
): HTMLElement {
  const container = createHoverPreviewContentElement();
  container.appendChild(child);
  return container;
}

export function createUnresolvedHoverPreviewElement(key: string): HTMLElement {
  const container = createHoverPreviewContentElement();
  container.appendChild(
    createHoverPreviewHeaderElement(unresolvedReferencePreviewLabel(key), CSS.hoverPreviewUnresolved),
  );
  return container;
}
