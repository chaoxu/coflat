import { describe, expect, it } from "vitest";

import {
  markdownReferencePathCandidatesFromDocument,
  normalizeMarkdownReferencePath,
  relativeMarkdownReferencePathFromDocument,
  resolveMarkdownReferencePathFromDocument,
} from "./parse";

describe("@chaoxu/coflat/parse public path helpers", () => {
  it("exposes markdown-authored reference path normalization", () => {
    expect(normalizeMarkdownReferencePath("/assets/./figures/../plot.png")).toBe(
      "assets/plot.png",
    );
  });

  it("exposes document-relative reference resolution helpers", () => {
    expect(resolveMarkdownReferencePathFromDocument("notes/main.md", "assets/plot.png"))
      .toBe("notes/assets/plot.png");
    expect(markdownReferencePathCandidatesFromDocument("notes/main.md", "refs/library.bib"))
      .toEqual(["notes/refs/library.bib", "refs/library.bib"]);
    expect(relativeMarkdownReferencePathFromDocument("notes/main.md", "assets/plot.png"))
      .toBe("../assets/plot.png");
  });
});
