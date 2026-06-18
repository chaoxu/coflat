import { documentSurfacePolicy } from "../core/document-surface-policy";
import type { InlineRenderSurface } from "./inline-surface";
import { renderInlineMarkdown, type InlineReferenceRenderContext } from "./render/inline-render";

export type DocumentSurfaceMode = InlineRenderSurface | "document-body";

export type DocumentFragmentKind =
  | "title"
  | "block-title"
  | "footnote"
  | "hover"
  | "chrome-label";

export interface DocumentSurfaceFragment {
  kind: DocumentFragmentKind;
  text: string;
  macros?: Record<string, string>;
  referenceContext?: InlineReferenceRenderContext;
  surface?: DocumentSurfaceMode;
}

function resolveSurface(fragment: DocumentSurfaceFragment): DocumentSurfaceMode {
  if (fragment.surface) {
    return fragment.surface;
  }
  switch (fragment.kind) {
    case "title":
    case "block-title":
      return documentSurfacePolicy("outline-label").labelInlineSurface;
    case "footnote":
      return documentSurfacePolicy("editor-preview").bodyInlineSurface;
    case "hover":
      return documentSurfacePolicy("hover-preview").bodyInlineSurface;
    case "chrome-label":
      return documentSurfacePolicy("outline-label").chromeLabelInlineSurface;
  }
}

export function renderDocumentFragmentToDom(
  container: HTMLElement,
  fragment: DocumentSurfaceFragment,
): void {
  renderInlineMarkdown(
    container,
    fragment.text,
    fragment.macros ?? {},
    resolveSurface(fragment),
    fragment.referenceContext,
  );
}

export function renderDocumentFragmentToHtml(
  fragment: DocumentSurfaceFragment,
): string {
  const scratch = document.createElement("span");
  renderDocumentFragmentToDom(scratch, fragment);
  return scratch.innerHTML;
}
