import type { InlineSurfaceName } from "./inline-surface-policy";

export type DocumentSurfaceName =
  | "reader"
  | "editor"
  | "editor-preview"
  | "hover-preview"
  | "completion-preview"
  | "outline-label";

export type ReferenceHostSurfaceName =
  | "reader"
  | "editor"
  | "editor-widget"
  | "editor-hover"
  | "editor-completion";

export type SemanticBlockDisclosurePolicy = "interactive" | "static";

export interface DocumentSurfacePolicy {
  readonly semanticBlockDisclosures: SemanticBlockDisclosurePolicy;
  readonly bodyInlineSurface: InlineSurfaceName;
  readonly labelInlineSurface: InlineSurfaceName;
  readonly chromeLabelInlineSurface: InlineSurfaceName;
  readonly referenceHostSurface: ReferenceHostSurfaceName;
}

const READER_DOCUMENT_POLICY: DocumentSurfacePolicy = {
  semanticBlockDisclosures: "interactive",
  bodyInlineSurface: "document-body",
  labelInlineSurface: "document-body",
  chromeLabelInlineSurface: "document-inline",
  referenceHostSurface: "reader",
};

const EDITOR_PREVIEW_DOCUMENT_POLICY: DocumentSurfacePolicy = {
  semanticBlockDisclosures: "static",
  bodyInlineSurface: "document-body",
  labelInlineSurface: "document-body",
  chromeLabelInlineSurface: "document-inline",
  referenceHostSurface: "editor-widget",
};

const EDITOR_DOCUMENT_POLICY: DocumentSurfacePolicy = {
  ...EDITOR_PREVIEW_DOCUMENT_POLICY,
  referenceHostSurface: "editor",
};

const HOVER_PREVIEW_DOCUMENT_POLICY: DocumentSurfacePolicy = {
  ...EDITOR_PREVIEW_DOCUMENT_POLICY,
  referenceHostSurface: "editor-hover",
};

const COMPLETION_PREVIEW_DOCUMENT_POLICY: DocumentSurfacePolicy = {
  ...EDITOR_PREVIEW_DOCUMENT_POLICY,
  referenceHostSurface: "editor-completion",
};

const OUTLINE_LABEL_DOCUMENT_POLICY: DocumentSurfacePolicy = {
  ...EDITOR_PREVIEW_DOCUMENT_POLICY,
  bodyInlineSurface: "document-inline",
  labelInlineSurface: "document-inline",
  chromeLabelInlineSurface: "outline-label-inline",
};

export function documentSurfacePolicy(surface: DocumentSurfaceName): DocumentSurfacePolicy {
  switch (surface) {
    case "reader":
      return READER_DOCUMENT_POLICY;
    case "editor":
      return EDITOR_DOCUMENT_POLICY;
    case "editor-preview":
      return EDITOR_PREVIEW_DOCUMENT_POLICY;
    case "hover-preview":
      return HOVER_PREVIEW_DOCUMENT_POLICY;
    case "completion-preview":
      return COMPLETION_PREVIEW_DOCUMENT_POLICY;
    case "outline-label":
      return OUTLINE_LABEL_DOCUMENT_POLICY;
  }
}
