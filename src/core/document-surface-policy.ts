export type DocumentSurfaceName =
  | "reader"
  | "editor-preview"
  | "hover-preview";

export type SemanticBlockDisclosurePolicy = "interactive" | "static";

export interface DocumentSurfacePolicy {
  readonly semanticBlockDisclosures: SemanticBlockDisclosurePolicy;
}

const READER_DOCUMENT_POLICY: DocumentSurfacePolicy = {
  semanticBlockDisclosures: "interactive",
};

const STATIC_PREVIEW_DOCUMENT_POLICY: DocumentSurfacePolicy = {
  semanticBlockDisclosures: "static",
};

export function documentSurfacePolicy(surface: DocumentSurfaceName): DocumentSurfacePolicy {
  switch (surface) {
    case "reader":
      return READER_DOCUMENT_POLICY;
    case "editor-preview":
    case "hover-preview":
      return STATIC_PREVIEW_DOCUMENT_POLICY;
  }
}
