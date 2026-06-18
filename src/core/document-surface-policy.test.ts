import { describe, expect, it } from "vitest";

import { documentSurfacePolicy } from "./document-surface-policy";

describe("documentSurfacePolicy", () => {
  it("keeps reader semantic block disclosures interactive", () => {
    expect(documentSurfacePolicy("reader")).toEqual({
      semanticBlockDisclosures: "interactive",
    });
  });

  it("keeps editor and inert previews static", () => {
    expect(documentSurfacePolicy("editor-preview")).toEqual({
      semanticBlockDisclosures: "static",
    });
    expect(documentSurfacePolicy("inert-preview")).toEqual(
      documentSurfacePolicy("editor-preview"),
    );
  });
});
