import { describe, expect, it } from "vitest";

import { documentSurfacePolicy } from "./document-surface-policy";

describe("documentSurfacePolicy", () => {
  it("keeps reader semantic block disclosures interactive", () => {
    expect(documentSurfacePolicy("reader")).toEqual({
      semanticBlockDisclosures: "interactive",
      bodyInlineSurface: "document-body",
      labelInlineSurface: "document-body",
      chromeLabelInlineSurface: "document-inline",
      referenceHostSurface: "reader",
    });
  });

  it("keeps editor preview static and widget-routed", () => {
    expect(documentSurfacePolicy("editor-preview")).toEqual({
      semanticBlockDisclosures: "static",
      bodyInlineSurface: "document-body",
      labelInlineSurface: "document-body",
      chromeLabelInlineSurface: "document-inline",
      referenceHostSurface: "editor-widget",
    });
  });

  it("keeps main editor rendering host-routed as editor", () => {
    expect(documentSurfacePolicy("editor")).toEqual({
      ...documentSurfacePolicy("editor-preview"),
      referenceHostSurface: "editor",
    });
  });

  it("keeps hover preview visually static but host-routed as hover", () => {
    expect(documentSurfacePolicy("hover-preview")).toEqual({
      ...documentSurfacePolicy("editor-preview"),
      referenceHostSurface: "editor-hover",
    });
  });

  it("keeps completion preview visually static but host-routed as completion", () => {
    expect(documentSurfacePolicy("completion-preview")).toEqual({
      ...documentSurfacePolicy("editor-preview"),
      referenceHostSurface: "editor-completion",
    });
  });

  it("keeps outline labels rich but non-document-sized", () => {
    expect(documentSurfacePolicy("outline-label")).toEqual({
      ...documentSurfacePolicy("editor-preview"),
      bodyInlineSurface: "document-inline",
      labelInlineSurface: "document-inline",
      chromeLabelInlineSurface: "outline-label-inline",
    });
  });
});
