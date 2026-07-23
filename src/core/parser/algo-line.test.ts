import { type ChangedRange, TreeFragment } from "@lezer/common";
import { describe, expect, it } from "vitest";
import { findNodeInfo, type NodeInfo, parseNodeInfos, parseNodeNames } from "../test-utils";
import { algoLineIndentDepth } from "./algo-line";
import { getMarkdownParser } from "./index";

const coflatParser = getMarkdownParser();

function nodeNames(text: string): string[] {
  return parseNodeNames(text, coflatParser);
}

function nodeInfos(text: string): NodeInfo[] {
  return parseNodeInfos(text, coflatParser);
}

const ALGO_DOC = [
  "::: {.algo #alg:min3 title=\"Compute a minimum 3-partition.\"}",
  "$\\textsc{Min3Partition}(f)$:",
  "  $V \\gets \\mathrm{domain}(f)$",
  "  if $|V| \\le 6$",
  "    return the optimum by brute force",
  "  return minimum over all candidates",
  ":::",
].join("\n");

describe("algo line-mode parsing", () => {
  it("parses .algo divs as LineFencedDiv with the standard opener children", () => {
    const names = nodeNames(ALGO_DOC);
    expect(names).toContain("LineFencedDiv");
    expect(names).not.toContain("FencedDiv");
    expect(names).toContain("FencedDivAttributes");
    expect(names.filter((n) => n === "FencedDivFence")).toHaveLength(2);
  });

  it("emits one AlgoLine per non-blank body line and no paragraphs", () => {
    const names = nodeNames(ALGO_DOC);
    expect(names.filter((n) => n === "AlgoLine")).toHaveLength(5);
    expect(names).not.toContain("Paragraph");
  });

  it("parses inline math inside algo lines", () => {
    const infos = nodeInfos(ALGO_DOC);
    const mathNodes = infos.filter((n) => n.name === "InlineMath");
    expect(mathNodes.length).toBeGreaterThanOrEqual(3);
    const firstLine = findNodeInfo(infos, "AlgoLine");
    expect(firstLine.text).toBe("$\\textsc{Min3Partition}(f)$:");
  });

  it("includes leading indentation inside the AlgoLine span", () => {
    const infos = nodeInfos(ALGO_DOC);
    const lines = infos.filter((n) => n.name === "AlgoLine");
    expect(lines[3]?.text).toBe("    return the optimum by brute force");
    expect(algoLineIndentDepth(lines[3]?.text ?? "")).toBe(2);
    expect(algoLineIndentDepth(lines[0]?.text ?? "")).toBe(0);
  });

  it("keeps blank lines as spacing without emitting nodes", () => {
    const doc = "::: {.algo}\nfirst phase\n\nsecond phase\n:::";
    const names = nodeNames(doc);
    expect(names.filter((n) => n === "AlgoLine")).toHaveLength(2);
    expect(names).not.toContain("Paragraph");
  });

  it("treats block-shaped lines as pseudocode lines, not nested blocks", () => {
    const doc = [
      "::: {.algo}",
      "# not a heading",
      "- not a list",
      "::: {.theorem}",
      "```",
      ":::",
    ].join("\n");
    const names = nodeNames(doc);
    expect(names.filter((n) => n === "AlgoLine")).toHaveLength(4);
    expect(names).not.toContain("ATXHeading1");
    expect(names).not.toContain("BulletList");
    expect(names).not.toContain("FencedCode");
    // The inner ::: opener must not open a nested div...
    expect(names).not.toContain("FencedDiv");
    // ...and must not consume the real closer.
    expect(names.filter((n) => n === "FencedDivFence")).toHaveLength(2);
  });

  it("supports algo divs nested inside regular divs", () => {
    const doc = [
      ":::: {.figure title=\"Wrapper\"}",
      "::: {.algo}",
      "step one",
      ":::",
      "::::",
    ].join("\n");
    const names = nodeNames(doc);
    expect(names).toContain("FencedDiv");
    expect(names).toContain("LineFencedDiv");
    expect(names.filter((n) => n === "AlgoLine")).toHaveLength(1);
  });

  it("leaves non-line-mode divs byte-for-byte unaffected", () => {
    const doc = "::: {.theorem}\nStatement with $x$.\n:::";
    const names = nodeNames(doc);
    expect(names).toContain("FencedDiv");
    expect(names).toContain("Paragraph");
    expect(names).not.toContain("LineFencedDiv");
    expect(names).not.toContain("AlgoLine");
  });

  it("tolerates an unclosed algo div at end of file", () => {
    const doc = "::: {.algo}\nline one\nline two";
    const names = nodeNames(doc);
    expect(names).toContain("LineFencedDiv");
    expect(names.filter((n) => n === "AlgoLine")).toHaveLength(2);
  });

  it("re-parses body lines when an incremental edit flips the opener class", () => {
    const before = "::: {.algo}\nstep with $x$\n:::";
    const after = "::: {.theorem}\nstep with $x$\n:::";
    const tree = coflatParser.parse(before);
    // Replace "algo" (offset 6..10) with "theorem".
    const changes: readonly ChangedRange[] = [{ fromA: 6, toA: 10, fromB: 6, toB: 13 }];
    const fragments = TreeFragment.applyChanges(TreeFragment.addTree(tree), changes);
    const reparsed = coflatParser.parse(after, fragments);
    const names: string[] = [];
    reparsed.iterate({
      enter(node) {
        names.push(node.name);
      },
    });
    expect(names).toContain("FencedDiv");
    expect(names).toContain("Paragraph");
    expect(names).not.toContain("LineFencedDiv");
    expect(names).not.toContain("AlgoLine");
  });

  it("re-parses body lines when an incremental edit flips the class to algo", () => {
    const before = "::: {.theorem}\nstep with $x$\n:::";
    const after = "::: {.algo}\nstep with $x$\n:::";
    const tree = coflatParser.parse(before);
    const changes: readonly ChangedRange[] = [{ fromA: 6, toA: 13, fromB: 6, toB: 10 }];
    const fragments = TreeFragment.applyChanges(TreeFragment.addTree(tree), changes);
    const reparsed = coflatParser.parse(after, fragments);
    const names: string[] = [];
    reparsed.iterate({
      enter(node) {
        names.push(node.name);
      },
    });
    expect(names).toContain("LineFencedDiv");
    expect(names).toContain("AlgoLine");
    expect(names).not.toContain("Paragraph");
  });

  it("matches the opener subtree structure of a regular div", () => {
    const algoInfos = nodeInfos("::: {.algo #alg:a title=\"T\"}\nbody\n:::");
    const divInfos = nodeInfos("::: {.theorem #thm:a title=\"T\"}\nbody\n:::");
    const openerNames = (infos: NodeInfo[], stop: string) => {
      const names: string[] = [];
      // Skip Document and the div node itself (which differ by design);
      // compare the opener/attr/title child structure.
      for (const info of infos.slice(2)) {
        if (info.name === stop) break;
        names.push(info.name);
      }
      return names;
    };
    expect(openerNames(algoInfos, "AlgoLine")).toEqual(openerNames(divInfos, "Paragraph"));
  });
});
