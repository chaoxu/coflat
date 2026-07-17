import { markdown } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";
import { equationLabelExtension } from "../../core/parser/equation-label";
import { fencedDiv } from "../../core/parser/fenced-div";
import { mathExtension } from "../../core/parser/math-backslash";
import type { DocumentAnalysis } from "../semantics/document";
import { blockCounterField } from "../state/block-counter";
import { documentAnalysisField } from "../state/document-analysis";
import { frontmatterField } from "../state/frontmatter-state";
import { createPluginRegistryField } from "../state/plugin-registry";
import {
  createEditorState,
  makeBibStore,
  makeBlockPlugin,
} from "../test-utils";
import type { CitationIdLookup } from "./citation-matching";
import {
  collectCitationBacklinkIndexFromReferences,
  collectCitationBacklinksFromTokens,
  collectCitationMatchesFromAnalysis,
  getAnalysisCitationRegistrationKey,
} from "./citation-matching";

const store: CitationIdLookup = {
  has: (id) => id === "alpha" || id === "beta",
};

describe("citation backlink aggregation", () => {
  it("aggregates reference backlinks with stable occurrences and duplicate ids", () => {
    const backlinks = collectCitationBacklinkIndexFromReferences([
      {
        from: 10,
        to: 20,
        ids: ["alpha", "missing", "alpha"],
        locators: [],
      },
      {
        from: 30,
        to: 40,
        ids: ["missing"],
        locators: [],
      },
      {
        from: 50,
        to: 60,
        ids: ["beta", "alpha"],
        locators: [],
      },
    ], store).backlinks;

    expect(backlinks.get("alpha")).toEqual([
      { occurrence: 1, from: 10, to: 20 },
      { occurrence: 1, from: 10, to: 20 },
      { occurrence: 2, from: 50, to: 60 },
    ]);
    expect(backlinks.get("beta")).toEqual([
      { occurrence: 2, from: 50, to: 60 },
    ]);
    expect(backlinks.has("missing")).toBe(false);
  });

  it("aggregates token backlinks with stable occurrences and duplicate ids", () => {
    const backlinks = collectCitationBacklinksFromTokens([
      {
        id: "alpha",
        clusterFrom: 100,
        clusterTo: 110,
        clusterIndex: 2,
      },
      {
        id: "beta",
        clusterFrom: 100,
        clusterTo: 110,
        clusterIndex: 0,
      },
      {
        id: "alpha",
        clusterFrom: 50,
        clusterTo: 60,
        clusterIndex: 0,
      },
      {
        id: "missing",
        clusterFrom: 75,
        clusterTo: 85,
        clusterIndex: 0,
      },
      {
        id: "alpha",
        clusterFrom: 100,
        clusterTo: 110,
        clusterIndex: 1,
      },
    ], store);

    expect(backlinks.get("alpha")).toEqual([
      { occurrence: 1, from: 50, to: 60 },
      { occurrence: 2, from: 100, to: 110 },
      { occurrence: 2, from: 100, to: 110 },
    ]);
    expect(backlinks.get("beta")).toEqual([
      { occurrence: 2, from: 100, to: 110 },
    ]);
    expect(backlinks.has("missing")).toBe(false);
  });
});

const precedenceStore = makeBibStore([
  { id: "thm-main", type: "book", title: "Theorem as citation" },
  { id: "eq:main", type: "book", title: "Equation as citation" },
  { id: "sec-main", type: "book", title: "Heading as citation" },
  { id: "real-cite", type: "book", title: "Real citation" },
]);

function analyze(doc: string): DocumentAnalysis {
  return createEditorState(doc, {
    extensions: [
      markdown({
        extensions: [fencedDiv, mathExtension, equationLabelExtension],
      }),
      frontmatterField,
      documentAnalysisField,
      createPluginRegistryField([
        makeBlockPlugin({ name: "theorem", counter: "theorem", title: "Theorem" }),
      ]),
      blockCounterField,
    ],
  }).field(documentAnalysisField);
}

describe("citation registration precedence", () => {
  it("excludes block, equation, and heading targets that collide with bib keys", () => {
    const analysis = analyze([
      "# Intro",
      "",
      "## Section {#sec-main}",
      "",
      "::: {.theorem #thm-main}",
      "Statement.",
      ":::",
      "",
      "$$x^2$$ {#eq:main}",
      "",
      "See [@thm-main], [@eq:main], [@sec-main], and [@real-cite].",
    ].join("\n"));

    const matches = collectCitationMatchesFromAnalysis(analysis, precedenceStore);

    expect(matches).toEqual([
      { ids: ["real-cite"], locators: [undefined] },
    ]);
    expect(getAnalysisCitationRegistrationKey(analysis, precedenceStore)).toBe("real-cite\0");
  });

  it("keeps real citations from mixed clusters while filtering local targets", () => {
    const analysis = analyze([
      "$$x^2$$ {#eq:main}",
      "",
      "See [@eq:main; @real-cite, p. 7].",
    ].join("\n"));

    expect(collectCitationMatchesFromAnalysis(analysis, precedenceStore)).toEqual([
      { ids: ["real-cite"], locators: ["p. 7"] },
    ]);
  });
});
