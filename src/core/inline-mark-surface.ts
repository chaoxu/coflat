import { CSS } from "./constants/css-classes";
import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "./document-surface-classes";

export type InlineMarkKind =
  | "emphasis"
  | "strong"
  | "strikethrough"
  | "highlight"
  | "code";

export type InlineMarkSurface =
  | "document-body"
  | "document-inline"
  | "table-preview-inline"
  | "outline-label-inline"
  | "ui-chrome-inline";

export interface InlineMarkSurfaceOptions {
  readonly surface?: InlineMarkSurface;
  readonly sourceAttrs?: string;
}

export function inlineMarkTagName(
  kind: InlineMarkKind,
  surface: InlineMarkSurface = "document-body",
): keyof HTMLElementTagNameMap {
  switch (kind) {
    case "emphasis":
      return "em";
    case "strong":
      return "strong";
    case "strikethrough":
      return "del";
    case "highlight":
      return surface === "document-body" ? "mark" : "span";
    case "code":
      return "code";
  }
}

export function inlineMarkClassName(kind: InlineMarkKind): string {
  switch (kind) {
    case "emphasis":
      return CSS.italic;
    case "strong":
      return CSS.bold;
    case "strikethrough":
      return CSS.strikethrough;
    case "highlight":
      return CSS.highlight;
    case "code":
      return documentSurfaceClassNames(
        DOCUMENT_SURFACE_CLASS.codeToken,
        CSS.inlineCode,
      );
  }
}

export function renderInlineMarkHtml(
  kind: InlineMarkKind,
  innerHtml: string,
  options: InlineMarkSurfaceOptions = {},
): string {
  const tag = inlineMarkTagName(kind, options.surface);
  const attrs = options.sourceAttrs ?? "";
  return `<${tag} class="${inlineMarkClassName(kind)}"${attrs}>${innerHtml}</${tag}>`;
}

export function createInlineMarkElement(
  ownerDocument: Document,
  kind: InlineMarkKind,
  options: InlineMarkSurfaceOptions = {},
): HTMLElement {
  const el = ownerDocument.createElement(inlineMarkTagName(kind, options.surface));
  el.className = inlineMarkClassName(kind);
  return el;
}
