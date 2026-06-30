import { markdown } from "@codemirror/lang-markdown";
import { EditorState, StateEffect } from "@codemirror/state";
import { afterEach, describe, expect, it } from "vitest";
import type { CitationFormatter } from "../../core/document-context-types";
import { equationLabelExtension } from "../../core/parser/equation-label";
import { fencedDiv } from "../../core/parser/fenced-div";
import { mathExtension } from "../../core/parser/math-backslash";
import { CslProcessor } from "../citations/csl-processor";
import { documentContextFacet } from "../document-context";
import { documentReferenceCatalogField } from "../semantics/editor-reference-catalog";
import type { DocumentReferenceCatalog } from "../semantics/reference-catalog";
import { bibDataEffect, bibDataField } from "../state/bib-data";
import { blockCounterField } from "../state/block-counter";
import { documentAnalysisField } from "../state/document-analysis";
import { frontmatterField } from "../state/frontmatter-state";
import { createPluginRegistryField } from "../state/plugin-registry";
import {
  applyStateEffects,
  CSL_FIXTURES,
  createEditorState,
  makeBibStore,
  makeBlockPlugin,
} from "../test-utils";
import {
  createCatalogReferencePresentationController,
  getReferencePresentationComputationCountForTest,
  getReferencePresentationModel,
  planReferencePresentation,
  type ReferencePresentationInput,
  referencePresentationField,
  resetReferencePresentationComputationCountForTest,
} from "./presentation";

function createState(doc: string): EditorState {
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
      documentReferenceCatalogField,
      bibDataField,
      referencePresentationField,
    ],
  });
}

function withBibliography(
  state: EditorState,
  items = [CSL_FIXTURES.karger],
): EditorState {
  return applyStateEffects(state, bibDataEffect.of({
    store: makeBibStore(items),
    formatter: new CslProcessor(items),
  }));
}

afterEach(() => {
  resetReferencePresentationComputationCountForTest();
});

describe("getReferencePresentationModel", () => {
  it("reads local display text from the shared catalog and citation text from the bibliography", () => {
    const state = withBibliography(createState([
      "# Background {#sec:background}",
      "",
      "::: {.theorem #thm:main}",
      "Statement.",
      ":::",
      "",
      "$$x^2$$ {#eq:main}",
    ].join("\n")));

    const presentation = getReferencePresentationModel(state);

    expect(presentation.getDisplayText("sec:background")).toBe("Section 1");
    expect(presentation.getDisplayText("thm:main")).toBe("Theorem 1");
    expect(presentation.getDisplayText("eq:main")).toBe("Eq. (1)");
    expect(presentation.getDisplayText("karger2000")).toBe("Karger 2000");
    expect(presentation.getPreviewText("thm:main")).toBeUndefined();
    expect(presentation.getPreviewText("karger2000")).toBe(
      "Karger, David R.. Minimum cuts in near-linear time. JACM, 47(1), 46-76. 2000.",
    );
  });

  it("reuses the model across non-document updates and invalidates on doc edits", () => {
    const state = withBibliography(createState("See [@karger2000]."));

    const first = getReferencePresentationModel(state);
    expect(first.getPreviewText("karger2000")).toContain("Minimum cuts in near-linear time");
    expect(first.getDisplayText("karger2000")).toBe("Karger 2000");
    expect(getReferencePresentationComputationCountForTest()).toBe(1);

    const selectionState = state.update({
      selection: { anchor: 0 },
    }).state;
    const second = getReferencePresentationModel(selectionState);
    expect(second).toBe(first);
    expect(second.getPreviewText("karger2000")).toContain("Minimum cuts in near-linear time");
    expect(getReferencePresentationComputationCountForTest()).toBe(1);

    const nextState = state.update({
      changes: {
        from: state.doc.length,
        insert: "\n\nMore text.",
      },
    }).state;
    const third = getReferencePresentationModel(nextState);
    expect(third).not.toBe(first);
    expect(third.getPreviewText("karger2000"))
      .toContain("Minimum cuts in near-linear time");
    expect(getReferencePresentationComputationCountForTest()).toBe(2);
  });

  it("invalidates citation formatting when the bibliography store changes without a doc edit", () => {
    const state = withBibliography(createState("See [@karger2000]."));
    const firstPreview = getReferencePresentationModel(state).getPreviewText("karger2000");
    expect(firstPreview).toContain("Minimum cuts in near-linear time");
    expect(getReferencePresentationComputationCountForTest()).toBe(1);

    const updatedEntry = {
      ...CSL_FIXTURES.karger,
      title: "Updated title",
    };
    const nextState = withBibliography(state, [updatedEntry]);
    expect(getReferencePresentationModel(nextState).getPreviewText("karger2000"))
      .toContain("Updated title");
    expect(getReferencePresentationComputationCountForTest()).toBe(2);
  });

  it("reads citation previews from DocumentContext when no local bibliography owns the key", () => {
    const formatter: CitationFormatter = {
      cite: () => "[1]",
      citeNarrative: (id) => `${id} [1]`,
      bibliographyEntries: () => [{
        id: "host2024",
        html: "<div><span>[1]</span> <i>Host citation title</i></div>",
      }],
      registerCitations: () => undefined,
      citationRegistrationKey: null,
      revision: 1,
    };
    const state = applyStateEffects(
      createState("See [@host2024]."),
      StateEffect.appendConfig.of(
        documentContextFacet.of({
          citationFormatter: formatter,
          citationKeys: new Set(["host2024"]),
        }),
      ),
    );

    expect(getReferencePresentationModel(state).getPreviewText("host2024"))
      .toBe("[1] Host citation title");
  });

  it("prefers DocumentContext citation previews over placeholder bibliography entries", () => {
    const formatter: CitationFormatter = {
      cite: () => "[1]",
      citeNarrative: (id) => `${id} [1]`,
      bibliographyEntries: () => [{
        id: "host2024",
        html: "<div><span>[1]</span> <i>Host citation title</i></div>",
      }],
      registerCitations: () => undefined,
      citationRegistrationKey: null,
      revision: 1,
    };
    const state = applyStateEffects(
      createState("See [@host2024]."),
      [
        bibDataEffect.of({
          store: makeBibStore([{ id: "host2024", type: "article" }]),
          formatter: null,
        }),
        StateEffect.appendConfig.of(
          documentContextFacet.of({
            citationFormatter: formatter,
            citationKeys: new Set(["host2024"]),
          }),
        ),
      ],
    );

    expect(getReferencePresentationModel(state).getPreviewText("host2024"))
      .toBe("[1] Host citation title");
  });
});

const catalogTargets = [
  {
    id: "thm-main",
    kind: "block" as const,
    from: 0,
    to: 10,
    displayLabel: "Theorem 1",
    ordinal: 1,
    title: "Main",
  },
  {
    id: "eq-main",
    kind: "equation" as const,
    from: 20,
    to: 30,
    displayLabel: "Eq. (1)",
    ordinal: 1,
  },
] as const;

const catalog: DocumentReferenceCatalog = {
  targets: catalogTargets,
  targetsById: new Map(catalogTargets.map((target) => [target.id, [target]])),
  uniqueTargetById: new Map(catalogTargets.map((target) => [target.id, target])),
  duplicatesById: new Map(),
  references: [],
};

function makeInput(
  ids: readonly string[],
  raw: string,
  bracketed = true,
): ReferencePresentationInput {
  return {
    bracketed,
    ids,
    locators: ids.map(() => undefined),
    raw,
  };
}

describe("reference presentation controller", () => {
  it("classifies local targets and leaves unmatched ids unresolved", () => {
    const controller = createCatalogReferencePresentationController(catalog, {
      bibliography: makeBibStore([CSL_FIXTURES.karger]),
      cite: (ids) => `[${ids.join(", ")}]`,
      citeNarrative: (id) => `${id} narrative`,
    });

    expect(controller.classify("thm-main", true)).toMatchObject({
      kind: "crossref",
      resolved: { kind: "block", label: "Theorem 1" },
    });
    expect(controller.classify("karger2000", true)).toEqual({ kind: "unresolved", id: "karger2000" });
    expect(controller.classify("missing", true)).toEqual({ kind: "unresolved", id: "missing" });
  });

  it("routes mixed and clustered references from the shared presentation plan", () => {
    const controller = createCatalogReferencePresentationController(catalog, {
      bibliography: makeBibStore([CSL_FIXTURES.karger]),
      cite: (ids) => `(${ids.join("; ")})`,
      citeNarrative: (id) => `${id} narrative`,
    });

    expect(controller.planReference(
      makeInput(["eq-main", "karger2000"], "[@eq-main; @karger2000]"),
    )).toMatchObject({
      kind: "clustered-crossref",
      parts: [
        { id: "eq-main", text: "Eq. (1)" },
        { id: "karger2000", text: "karger2000", unresolved: true },
      ],
    });

    expect(planReferencePresentation(
      controller,
      makeInput(["thm-main", "missing"], "[@thm-main; @missing]"),
    )).toMatchObject({
      kind: "clustered-crossref",
      parts: [
        { id: "thm-main", text: "Theorem 1" },
        { id: "missing", text: "missing", unresolved: true },
      ],
    });
  });
});
