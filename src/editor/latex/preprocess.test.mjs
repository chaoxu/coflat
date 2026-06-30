import { describe, expect, it } from "vitest";

import {
  hoistAbstractBlock,
  hoistMathMacros,
  insertAppendixBoundary,
  liftFencedDivTitles,
  preprocess,
  promoteLabeledDisplayMath,
  renderMathMacros,
} from "./preprocess.mjs";

describe("liftFencedDivTitles", () => {
  it("hoists an inline title into a title attribute", () => {
    const input = "::: {#thm:main .theorem} Main result";
    const out = liftFencedDivTitles(input);
    expect(out).toBe('::: {#thm:main .theorem title="Main result"}');
  });

  it("leaves opener without trailing title untouched", () => {
    const input = "::: {#fig:demo .figure}";
    expect(liftFencedDivTitles(input)).toBe(input);
  });

  it("escapes double quotes in the title", () => {
    const input = '::: {.theorem} He said "hi"';
    expect(liftFencedDivTitles(input)).toBe('::: {.theorem title="He said \\"hi\\""}');
  });

  it("leaves non-opener lines alone", () => {
    const input = "regular paragraph\n:::\n";
    expect(liftFencedDivTitles(input)).toBe(input);
  });
});

describe("renderMathMacros", () => {
  it("detects arity by scanning for #N", () => {
    const out = renderMathMacros({ R: "\\mathbb{R}", floor: "\\lfloor #1 \\rfloor" });
    expect(out).toContain("\\newcommand{\\R}{\\mathbb{R}}");
    expect(out).toContain("\\newcommand{\\floor}[1]{\\lfloor #1 \\rfloor}");
  });

  it("strips leading backslash from macro name", () => {
    const out = renderMathMacros({ "\\B": "\\mathcal{B}" });
    expect(out).toBe("\\newcommand{\\B}{\\mathcal{B}}");
  });
});

describe("hoistMathMacros", () => {
  it("moves math: into header-includes and preserves other keys", () => {
    const src = [
      "---",
      "title: Paper",
      "math:",
      "  R: \"\\\\mathbb{R}\"",
      "  \\operatorname{cl}: \"\\\\operatorname{cl}\"",
      "---",
      "",
      "Body.",
    ].join("\n");
    const out = hoistMathMacros(src);
    expect(out).toContain("title: Paper");
    expect(out).not.toContain("math:\n");
    expect(out).toContain("\\newcommand{\\R}{\\mathbb{R}}");
    expect(out).toContain("header-includes:");
    expect(out.split("---")[2]).toContain("Body.");
  });

  it("drops user-provided header-includes", () => {
    const src = [
      "---",
      "title: Paper",
      "header-includes: \"\\\\input{/etc/passwd}\"",
      "math:",
      "  R: \"\\\\mathbb{R}\"",
      "---",
      "",
      "Body.",
    ].join("\n");
    const out = hoistMathMacros(src);
    expect(out).not.toContain("\\input{/etc/passwd}");
    expect(out).toContain("\\newcommand{\\R}{\\mathbb{R}}");
  });

  it("removes header-includes even when there are no math macros", () => {
    const src = "---\ntitle: X\nheader-includes: \"\\\\input{/etc/passwd}\"\n---\nBody\n";
    const out = hoistMathMacros(src);
    expect(out).toContain("title: X");
    expect(out).not.toContain("header-includes");
    expect(out).not.toContain("\\input{/etc/passwd}");
  });

  it("no-ops when no math frontmatter", () => {
    const src = "---\ntitle: X\n---\nBody\n";
    expect(hoistMathMacros(src)).toBe(src);
  });

  it("accepts closing delimiter whitespace", () => {
    const src = [
      "---",
      "title: Paper",
      "math:",
      "  R: \"\\\\mathbb{R}\"",
      "---   ",
      "",
      "Body.",
    ].join("\n");
    const out = hoistMathMacros(src);
    expect(out).toContain("\\newcommand{\\R}{\\mathbb{R}}");
    expect(out).toContain("Body.");
  });
});

describe("hoistAbstractBlock", () => {
  it("moves the first abstract block into YAML metadata", () => {
    const src = [
      "---",
      "title: Paper",
      "---",
      "",
      "::: {.abstract}",
      "This is the abstract with $x^2$.",
      ":::",
      "",
      "Body.",
    ].join("\n");
    const out = hoistAbstractBlock(src);

    expect(out).toContain("title: Paper");
    expect(out).toContain("abstract: This is the abstract with $x^2$.");
    expect(out).toContain("Body.");
    expect(out).not.toContain("::: {.abstract}");
  });

  it("creates YAML metadata when the source has no frontmatter", () => {
    const src = "::: {.abstract}\nAbstract body.\n:::\n\nBody.";
    const out = hoistAbstractBlock(src);

    expect(out.startsWith("---\nabstract: Abstract body.\n---\nBody.")).toBe(true);
  });
});

describe("promoteLabeledDisplayMath", () => {
  it("wraps a $$...$$ block with a trailing {#eq:id} into an equation env", () => {
    const src = "Before.\n\n$$\na + b = c\n$$ {#eq:sum}\n\nAfter.\n";
    const out = promoteLabeledDisplayMath(src);
    expect(out).toContain("\\begin{equation}\\label{eq:sum}");
    expect(out).toContain("a + b = c");
    expect(out).toContain("\\end{equation}");
    expect(out).not.toContain("$$");
  });

  it("leaves unlabeled $$...$$ blocks alone", () => {
    const src = "Before.\n\n$$\na = b\n$$\n\nAfter.\n";
    expect(promoteLabeledDisplayMath(src)).toBe(src);
  });

  it("handles two labeled blocks in sequence", () => {
    const src = "$$\nx\n$$ {#eq:a}\n\n$$\ny\n$$ {#eq:b}\n";
    const out = promoteLabeledDisplayMath(src);
    expect(out).toContain("\\label{eq:a}");
    expect(out).toContain("\\label{eq:b}");
  });

  it("does not promote display math when title text follows the label", () => {
    const src = "$$\nx\n$$ {#eq:a} Energy identity\n";
    expect(promoteLabeledDisplayMath(src)).toBe(src);
  });

  it("leaves canonical raw LaTeX labeled equations untouched", () => {
    const src = "\\begin{equation}\\label{eq:a}\nx\n\\end{equation}\n";
    expect(promoteLabeledDisplayMath(src)).toBe(src);
  });
});

describe("insertAppendixBoundary", () => {
  it("inserts a LaTeX appendix command and unnumbers the boundary heading", () => {
    const src = "# Intro\n\n# Appendix {.appendix}\n\n# Proofs\n";
    const out = insertAppendixBoundary(src);

    expect(out).toBe("# Intro\n\n\\appendix\n# Appendix {.unnumbered}\n\n# Proofs\n");
  });

  it("preserves ids and other heading attributes on the appendix boundary", () => {
    const src = "# Appendix {#app .appendix .bookmark}\n\n# Proofs\n";
    const out = insertAppendixBoundary(src);

    expect(out).toContain("\\appendix\n# Appendix {#app .bookmark .unnumbered}");
    expect(out).not.toContain(".appendix");
  });

  it("does not rewrite appendix text inside fenced code", () => {
    const src = "```md\n# Appendix {.appendix}\n```\n\n# Body\n";

    expect(insertAppendixBoundary(src)).toBe(src);
  });

  it("does not rewrite appendix text inside longer fenced code blocks", () => {
    const src = "````md\n```\n# Appendix {.appendix}\n```\n````\n\n# Body\n";

    expect(insertAppendixBoundary(src)).toBe(src);
  });

  it("does not close fenced code on fence markers with trailing text", () => {
    const src = "```txt\n```not-close\n# Appendix {.appendix}\n```\n";

    expect(insertAppendixBoundary(src)).toBe(src);
  });

  it("does not let math-looking text inside fenced code hide a real appendix boundary", () => {
    const src = "```txt\n$$\n```\n\n# Appendix {.appendix}\n\n# Proofs\n";

    expect(insertAppendixBoundary(src)).toBe(
      "```txt\n$$\n```\n\n\\appendix\n# Appendix {.unnumbered}\n\n# Proofs\n",
    );
  });

  it("does not scan YAML frontmatter comments as appendix headings", () => {
    const src = "---\ntitle: Demo\n# Appendix {.appendix}\n---\n\n# Body\n";

    expect(insertAppendixBoundary(src)).toBe(src);
  });

  it("does not rewrite appendix text inside display math", () => {
    const src = "$$\n# Appendix {.appendix}\n$$\n\n# Body\n";

    expect(insertAppendixBoundary(src)).toBe(src);
  });

  it("does not rewrite appendix text inside raw LaTeX environments", () => {
    const src = "\\begin{equation}\n# Appendix {.appendix}\n\\end{equation}\n\n# Body\n";

    expect(insertAppendixBoundary(src)).toBe(src);
  });

  it("ignores non-top-level appendix headings for export", () => {
    const src = "# Main\n\n## Appendix {.appendix}\n\n## Proofs\n";

    expect(insertAppendixBoundary(src)).toBe(src);
  });

  it("seeds appendix A before the first numbered subheading", () => {
    const src = "# Appendix {.appendix}\n\n## Proofs\n\n# Data\n";

    expect(insertAppendixBoundary(src)).toBe(
      "\\appendix\n# Appendix {.unnumbered}\n\n\\setcounter{section}{1}\n## Proofs\n\n# Data\n",
    );
  });

  it("does not seed appendix A before a top-level appendix heading", () => {
    const src = "# Appendix {.appendix}\n\n# Proofs\n";

    expect(insertAppendixBoundary(src)).toBe("\\appendix\n# Appendix {.unnumbered}\n\n# Proofs\n");
  });

  it("skips unnumbered headings before deciding whether to seed appendix A", () => {
    const src = "# Appendix {.appendix}\n\n## Notes {-}\n\n## Proofs\n";

    expect(insertAppendixBoundary(src)).toBe(
      "\\appendix\n# Appendix {.unnumbered}\n\n## Notes {-}\n\n\\setcounter{section}{1}\n## Proofs\n",
    );
  });
});

describe("preprocess", () => {
  it("preserves standard \\textsc in math for LaTeX/PDF export", async () => {
    const body = "Problem $\\textsc{Minimum Vertex Cover}$ stays standard.";
    const out = await preprocess(body, "main.md");

    expect(out).toContain("\\textsc{Minimum Vertex Cover}");
    expect(out).not.toContain("\\htmlClass");
    expect(out).not.toContain("cf-katex-small-caps");
  });

  it("runs macro hoisting, equation promotion, and title lifting", async () => {
    const body = [
      "---",
      "math:",
      "  R: \"\\\\mathbb{R}\"",
      "---",
      "",
      "::: {#thm:x .theorem} Inside",
      "$$",
      "x \\in \\R",
      "$$ {#eq:x}",
      ":::",
    ].join("\n");
    const out = await preprocess(body, "main.md");
    expect(out).toContain("\\newcommand{\\R}{\\mathbb{R}}");
    expect(out).toContain('::: {#thm:x .theorem title="Inside"}');
    expect(out).toContain("\\begin{equation}\\label{eq:x}");
  });

  it("hoists abstract blocks before pandoc export", async () => {
    const body = [
      "---",
      "title: Paper",
      "---",
      "",
      "::: {.abstract}",
      "Exported abstract.",
      ":::",
      "",
      "Body.",
    ].join("\n");
    const out = await preprocess(body, "main.md");

    expect(out).toContain("abstract: Exported abstract.");
    expect(out).not.toContain("::: {.abstract}");
    expect(out).toContain("Body.");
  });

  it("inserts appendix boundaries before pandoc export", async () => {
    const out = await preprocess("# Main\n\n# Appendix {.appendix}\n\n# Proofs\n", "main.md");

    expect(out).toContain("\\appendix\n# Appendix {.unnumbered}");
    expect(out).not.toContain("{.appendix}");
  });
});
