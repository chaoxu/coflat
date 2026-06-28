import { describe, expect, it } from "vitest";

import { mergeConfigs, parseProjectConfig } from "./project-config";

describe("project config", () => {
  it("keeps coflat.yaml limited to Coflat document config keys", () => {
    const config = parseProjectConfig([
      "title: Project Title",
      "subtitle: Project Subtitle",
      "author: Project Author",
      "date: 2026-06-20",
      "bibliography: refs.bib",
      "csl: style.csl",
      "numbering: global",
      "imageFolder: assets",
      "latex:",
      "  template: lipics",
      "  csl: ieee.csl",
      "math:",
      '  \\R: "\\\\mathbb{R}"',
      "blocks:",
      "  theorem:",
      "    counter: theorem",
    ].join("\n"));

    expect(config).toEqual({
      bibliography: "refs.bib",
      csl: "style.csl",
      numbering: "global",
      imageFolder: "assets",
      latex: {
        template: "lipics",
        csl: "ieee.csl",
      },
      math: {
        "\\R": "\\mathbb{R}",
      },
      blocks: {
        theorem: {
          counter: "theorem",
        },
      },
    });
  });

  it("preserves article metadata from file frontmatter when merging", () => {
    expect(
      mergeConfigs(
        { bibliography: "project.bib" },
        {
          title: "File Title",
          subtitle: "File Subtitle",
          author: "File Author",
          bibliography: "file.bib",
        },
      ),
    ).toMatchObject({
      title: "File Title",
      subtitle: "File Subtitle",
      author: "File Author",
      bibliography: "file.bib",
    });
  });
});
