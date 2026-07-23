import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { LATEX_PANDOC_FROM } from "./export-options.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILTER_PATH = resolve(__dirname, "filter.lua");
const hasPandoc = spawnSync("pandoc", ["--version"], { encoding: "utf8" }).status === 0;

if (process.env.REQUIRE_PANDOC === "1" && !hasPandoc) {
  throw new Error("Pandoc is required for LaTeX filter tests when REQUIRE_PANDOC=1");
}

function runPandoc(markdown) {
  const result = spawnSync(
    "pandoc",
    [
      `--from=${LATEX_PANDOC_FROM}`,
      "--to=latex",
      `--lua-filter=${FILTER_PATH}`,
    ],
    {
      encoding: "utf8",
      input: markdown,
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `pandoc exited ${result.status}`);
  }
  return result.stdout;
}

describe("LaTeX filter custom blocks", () => {
  it.skipIf(!hasPandoc)("leaves unknown fenced div content as ordinary content", () => {
    const latex = runPandoc("::: {.custom-widget}\nBody content\n:::\n");

    expect(latex).toContain("Body content");
    expect(latex).not.toContain("content omitted");
  });

  it.skipIf(!hasPandoc)("escapes plain theorem title attributes", () => {
    const latex = runPandoc('::: {.theorem #thm:main title="A & B_#%$"}\nBody\n:::\n');

    expect(latex).toContain("\\begin{theorem}[A \\& B\\_\\#\\%\\$]\\label{thm:main}");
  });

  it.skipIf(!hasPandoc)("escapes plain figure caption attributes", () => {
    const latex = runPandoc('::: {.figure #fig:main title="A & B_#%$"}\n![Alt](image.png)\n:::\n');

    expect(latex).toContain("\\caption{A \\& B\\_\\#\\%\\$}\\label{fig:main}");
  });

  it.skipIf(!hasPandoc)("parses inline math in table caption attributes", () => {
    const latex = runPandoc([
      '::: {.table #tbl:main title="rank-$j$ reduction"}',
      "| A |",
      "|---|",
      "| b |",
      ":::",
    ].join("\n"));

    expect(latex).toContain("\\caption{rank-\\(j\\) reduction}\\label{tbl:main}");
  });

  it.skipIf(!hasPandoc)("keeps algorithms at their source position", () => {
    const latex = runPandoc('::: {.algorithm #alg:main title="Main procedure"}\nBody\n:::\n');

    expect(latex).toContain("\\begin{algorithm}[H]\\caption{Main procedure}\\label{alg:main}");
  });

  it.skipIf(!hasPandoc)("glues the environment end onto the final paragraph", () => {
    const latex = runPandoc("::: {.proof}\nThe result follows.\n:::\n");

    expect(latex).toContain("The result follows.\\end{proof}");
    expect(latex).not.toContain("\n\n\\end{proof}");
  });
});

describe("LaTeX filter inline mappings", () => {
  it.skipIf(!hasPandoc)("keeps author macro calls unexpanded in LaTeX output", () => {
    const latex = runPandoc([
      "\\newcommand{\\set}[1]{\\left\\{#1\\right\\}}",
      "",
      "Body $\\set{1,2}$.",
    ].join("\n"));

    expect(latex).toContain("\\(\\set{1,2}\\)");
    expect(latex).not.toContain("\\(\\left\\{1,2\\right\\}\\)");
  });

  it.skipIf(!hasPandoc)("does not require newer Pandoc mark syntax support", () => {
    const latex = runPandoc("A ==highlighted **term**==.\n");

    expect(latex).toContain("==highlighted \\textbf{term}==");
  });

  it.skipIf(!hasPandoc)("preserves author-written LaTeX nonbreaking spaces", () => {
    const latex = runPandoc("See Theorem~3.1 and [@karger2000, Thm.~5].\n");

    expect(latex).toContain("Theorem~3.1");
    expect(latex).not.toContain("\\textasciitilde");
  });

  it.skipIf(!hasPandoc)("renders document citations as cross-reference clusters", () => {
    const latex = runPandoc([
      "::: {.theorem #thm:main}",
      "Body",
      ":::",
      "",
      "## Later {#sec:later}",
      "",
      "See [@thm:main; @sec:later].",
    ].join("\n"));

    expect(latex).toContain("\\cref{thm:main,sec:later}");
  });

  it.skipIf(!hasPandoc)("leaves bibliography citations for citeproc", () => {
    const latex = runPandoc([
      "::: {.theorem #thm:main}",
      "Body",
      ":::",
      "",
      "See [@thm:main] and [@karger2000, p. 42].",
    ].join("\n"));

    expect(latex).toContain("\\cref{thm:main}");
    expect(latex).not.toContain("\\cref{karger2000}");
  });
});

describe("LaTeX filter algo blocks", () => {
  it.skipIf(!hasPandoc)("maps line-block algo bodies to the coflatalgo tabbing environment", () => {
    const latex = runPandoc([
      '::: {.algo #alg:min title="Compute a minimum."}',
      "| $\\textsc{Min}(f)$:",
      "|   if $|V| \\le 6$",
      "|     return brute force",
      "|   return best candidate",
      ":::",
    ].join("\n"));

    expect(latex).toContain("\\begin{algorithm}[H]\\caption{Compute a minimum.}\\label{alg:min}");
    expect(latex).toContain("\\begin{coflatalgo}");
    expect(latex).toContain("\\end{coflatalgo}");
    // Indent deltas become tabbing marks placed before the line break.
    expect(latex).toContain("\\+\\\\ if \\(|V| \\le 6\\)");
    expect(latex).toContain("\\+\\\\ return brute force");
    expect(latex).toContain("\\-\\\\ return best candidate");
    // No leading non-breaking spaces survive into the body.
    expect(latex).not.toContain(" ");
  });

  it.skipIf(!hasPandoc)("keeps blank algo lines as empty rows", () => {
    const latex = runPandoc([
      "::: {.algo}",
      "| phase one",
      "",
      "| phase two",
      ":::",
    ].join("\n"));

    expect(latex).toContain("phase one\n\\\\ \n\\\\ phase two");
  });
});
