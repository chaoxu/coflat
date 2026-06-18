import { describe, expect, it } from "vitest";

import { inlineSurfacePolicy } from "./inline-surface-policy";

describe("inlineSurfacePolicy", () => {
  it("keeps document body inline content fully rendered", () => {
    expect(inlineSurfacePolicy("document-body")).toEqual({
      links: "active",
      references: "resolved",
      images: "rendered",
      footnotes: "numbered-reference",
      hardBreaks: "line-break",
    });
  });

  it("keeps title-like document inline content active but image-light", () => {
    expect(inlineSurfacePolicy("document-inline")).toEqual({
      links: "active",
      references: "resolved",
      images: "alt-text",
      footnotes: "numbered-reference",
      hardBreaks: "space",
    });
    expect(inlineSurfacePolicy("table-preview-inline")).toEqual(
      inlineSurfacePolicy("document-inline"),
    );
  });

  it("keeps app chrome inline content inert", () => {
    expect(inlineSurfacePolicy("ui-chrome-inline")).toEqual({
      links: "inert",
      references: "inert",
      images: "alt-text",
      footnotes: "raw-superscript",
      hardBreaks: "space",
    });
  });
});
