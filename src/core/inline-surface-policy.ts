export type InlineSurfaceName =
  | "document-body"
  | "document-inline"
  | "table-preview-inline"
  | "outline-label-inline"
  | "ui-chrome-inline";

export type LinkSurfacePolicy = "active" | "inert";
export type ReferenceSurfacePolicy = "resolved" | "inert";
export type ImageSurfacePolicy = "rendered" | "alt-text";
export type FootnoteSurfacePolicy = "numbered-reference" | "raw-superscript";
export type HardBreakSurfacePolicy = "line-break" | "space";

export interface InlineSurfacePolicy {
  readonly links: LinkSurfacePolicy;
  readonly references: ReferenceSurfacePolicy;
  readonly images: ImageSurfacePolicy;
  readonly footnotes: FootnoteSurfacePolicy;
  readonly hardBreaks: HardBreakSurfacePolicy;
}

const DOCUMENT_BODY_INLINE_POLICY: InlineSurfacePolicy = {
  links: "active",
  references: "resolved",
  images: "rendered",
  footnotes: "numbered-reference",
  hardBreaks: "line-break",
};

const DOCUMENT_INLINE_POLICY: InlineSurfacePolicy = {
  links: "active",
  references: "resolved",
  images: "alt-text",
  footnotes: "numbered-reference",
  hardBreaks: "space",
};

const UI_CHROME_INLINE_POLICY: InlineSurfacePolicy = {
  links: "inert",
  references: "inert",
  images: "alt-text",
  footnotes: "raw-superscript",
  hardBreaks: "space",
};

const OUTLINE_LABEL_INLINE_POLICY: InlineSurfacePolicy = {
  links: "inert",
  references: "resolved",
  images: "alt-text",
  footnotes: "raw-superscript",
  hardBreaks: "space",
};

export function inlineSurfacePolicy(surface: InlineSurfaceName): InlineSurfacePolicy {
  switch (surface) {
    case "document-body":
      return DOCUMENT_BODY_INLINE_POLICY;
    case "document-inline":
    case "table-preview-inline":
      return DOCUMENT_INLINE_POLICY;
    case "outline-label-inline":
      return OUTLINE_LABEL_INLINE_POLICY;
    case "ui-chrome-inline":
      return UI_CHROME_INLINE_POLICY;
  }
}
