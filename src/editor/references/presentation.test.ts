import { markdown } from "@codemirror/lang-markdown";
import { EditorState, StateEffect } from "@codemirror/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CitationFormatter } from "../../core/document-context-types";
import {
  type CitationCluster,
  getCitationRegistrationKey,
} from "../citations/citation-matching";
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
import { createBibliographyWidgetFromState } from "../render/bibliography-render";
import {
  createCatalogReferencePresentationController,
  ensureEditorReferencePresentationCitationsRegistered,
  getEditorNociteConfig,
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

describe("Pandoc citation syntax routing", () => {
  const citationKeys = { has: (id: string) => id === "a" || id === "b" };

  function makeRecordingController(calls: unknown[][]) {
    return createCatalogReferencePresentationController(catalog, {
      citationKeys,
      cite: (ids, locators, extras) => {
        calls.push([ids, locators, extras]);
        return "(cite)";
      },
      citeNarrative: (id) => `${id} narrative`,
    });
  }

  it("derives prefix and suppress-author extras from the raw cluster", () => {
    const calls: unknown[][] = [];
    const controller = makeRecordingController(calls);

    const route = controller.planReference({
      bracketed: true,
      ids: ["a", "b"],
      locators: ["p. 3", undefined],
      raw: "[see @a, p. 3; -@b]",
    });

    expect(route).toMatchObject({ kind: "citation", rendered: "(cite)" });
    expect(calls).toEqual([[
      ["a", "b"],
      ["p. 3", undefined],
      [{ prefix: "see" }, { suppressAuthor: true }],
    ]]);
  });

  it("passes no extras for plain clusters so old calls stay identical", () => {
    const calls: unknown[][] = [];
    const controller = makeRecordingController(calls);

    controller.planReference({
      bracketed: true,
      ids: ["a", "b"],
      locators: [undefined, "p. 3"],
      raw: "[@a; @b, p. 3]",
    });

    expect(calls).toEqual([[["a", "b"], [undefined, "p. 3"], undefined]]);
  });

  it("routes narrative -@key through a suppressed cite, not citeNarrative", () => {
    const calls: unknown[][] = [];
    const controller = makeRecordingController(calls);

    const route = controller.planReference({
      bracketed: false,
      ids: ["a"],
      locators: [undefined],
      raw: "-@a",
    });

    expect(route).toMatchObject({ kind: "citation", narrative: true, rendered: "(cite)" });
    expect(calls).toEqual([[["a"], [undefined], [{ suppressAuthor: true }]]]);
  });

  it("keeps plain narrative keys on the citeNarrative path", () => {
    const calls: unknown[][] = [];
    const controller = makeRecordingController(calls);

    const route = controller.planReference({
      bracketed: false,
      ids: ["a"],
      locators: [undefined],
      raw: "@a",
    });

    expect(route).toMatchObject({
      kind: "citation",
      narrative: true,
      rendered: "a narrative",
    });
    expect(calls).toEqual([]);
  });

  it("applies per-item extras to citation parts of mixed clusters", () => {
    const calls: unknown[][] = [];
    const controller = makeRecordingController(calls);

    const route = controller.planReference({
      bracketed: true,
      ids: ["thm-main", "a"],
      locators: [undefined, undefined],
      raw: "[@thm-main; see -@a]",
    });

    expect(route).toMatchObject({ kind: "mixed-cluster" });
    expect(calls).toEqual([[["a"], [], [{ prefix: "see", suppressAuthor: true }]]]);
  });

  it("renders Pandoc syntax end-to-end through a real CSL processor", async () => {
    const processor = await CslProcessor.create([CSL_FIXTURES.karger]);
    processor.registerCitations([{ ids: ["karger2000"] }]);
    const controller = createCatalogReferencePresentationController(catalog, {
      citationKeys: { has: (id: string) => id === "karger2000" },
      cite: (ids, locators, extras) => processor.cite([...ids], [...locators], extras),
      citeNarrative: (id) => processor.citeNarrative(id),
    });

    expect(controller.planReference({
      bracketed: true,
      ids: ["karger2000"],
      locators: ["p. 12, emphasis mine"],
      raw: "[see @karger2000, p. 12, emphasis mine]",
    })).toMatchObject({
      kind: "citation",
      rendered: "[see 1, p. 12, emphasis mine]",
    });

    expect(controller.planReference({
      bracketed: false,
      ids: ["karger2000"],
      locators: [undefined],
      raw: "-@karger2000",
    })).toMatchObject({
      kind: "citation",
      narrative: true,
      rendered: "[1]",
    });
  });
});

describe("ensureEditorReferencePresentationCitationsRegistered nocite", () => {
  function createRecordingFormatter(): {
    formatter: CitationFormatter;
    registrations: CitationCluster[][];
  } {
    const registrations: CitationCluster[][] = [];
    let key: string | null = null;
    const formatter: CitationFormatter = {
      cite: () => "",
      citeNarrative: (id) => id,
      bibliographyEntries: () => [],
      registerCitations(clusters) {
        const normalized = clusters.map((cluster) => ({
          ids: [...cluster.ids],
          locators: cluster.locators ? [...cluster.locators] : [],
        }));
        registrations.push(normalized);
        key = getCitationRegistrationKey(normalized);
      },
      get citationRegistrationKey() {
        return key;
      },
      revision: 0,
    };
    return { formatter, registrations };
  }

  it("appends the trailing nocite cluster and skips re-registration on the same inputs", () => {
    const analysis = createState("Cites [@karger2000].").field(documentAnalysisField);
    const store = makeBibStore([CSL_FIXTURES.karger, CSL_FIXTURES.stein]);
    const { formatter, registrations } = createRecordingFormatter();

    ensureEditorReferencePresentationCitationsRegistered(
      analysis,
      store,
      formatter,
      ["stein2001"],
    );

    expect(registrations).toHaveLength(1);
    expect(registrations[0].map((cluster) => [...cluster.ids])).toEqual([
      ["karger2000"],
      ["stein2001"],
    ]);

    ensureEditorReferencePresentationCitationsRegistered(
      analysis,
      store,
      formatter,
      ["stein2001"],
    );
    expect(registrations).toHaveLength(1);
  });

  it("expands the wildcard and drops nocite ids already cited in-text", () => {
    const analysis = createState("Cites [@karger2000].").field(documentAnalysisField);
    const store = makeBibStore([CSL_FIXTURES.karger, CSL_FIXTURES.stein]);
    const { formatter, registrations } = createRecordingFormatter();

    ensureEditorReferencePresentationCitationsRegistered(
      analysis,
      store,
      formatter,
      ["*", "karger2000"],
    );

    expect(registrations).toHaveLength(1);
    expect(registrations[0].map((cluster) => [...cluster.ids])).toEqual([
      ["karger2000"],
      ["stein2001"],
    ]);
  });

  it("registers only in-text clusters when nocite is absent or empty", () => {
    const analysis = createState("Cites [@karger2000].").field(documentAnalysisField);
    const store = makeBibStore([CSL_FIXTURES.karger, CSL_FIXTURES.stein]);
    const { formatter, registrations } = createRecordingFormatter();

    ensureEditorReferencePresentationCitationsRegistered(analysis, store, formatter, []);

    expect(registrations).toHaveLength(1);
    expect(registrations[0].map((cluster) => [...cluster.ids])).toEqual([["karger2000"]]);
  });

  it("computes the same registration key as the bibliography widget path", async () => {
    const items = [CSL_FIXTURES.karger, CSL_FIXTURES.stein];
    const state = applyStateEffects(
      createState([
        "---",
        "nocite: \"@stein2001\"",
        "---",
        "",
        "Cites [@karger2000].",
      ].join("\n")),
      bibDataEffect.of({
        store: makeBibStore(items),
        formatter: await CslProcessor.create(items),
      }),
    );
    const { store, formatter } = state.field(bibDataField);
    expect(getEditorNociteConfig(state)).toEqual(["stein2001"]);

    // Bibliography widget path registers first (in-text + trailing nocite).
    expect(createBibliographyWidgetFromState(state)).not.toBeNull();
    const registrationKey = formatter?.citationRegistrationKey;
    expect(registrationKey).not.toBeNull();

    // The presentation path must recognize that key instead of re-registering.
    const registerSpy = vi.spyOn(formatter as CitationFormatter, "registerCitations");
    ensureEditorReferencePresentationCitationsRegistered(
      state.field(documentAnalysisField),
      store,
      formatter,
      getEditorNociteConfig(state),
    );
    expect(registerSpy).not.toHaveBeenCalled();
    expect(formatter?.citationRegistrationKey).toBe(registrationKey);
    registerSpy.mockRestore();
  });

  it("primes the bibliography widget path when the presentation path registers first", async () => {
    const items = [CSL_FIXTURES.karger, CSL_FIXTURES.stein];
    const state = applyStateEffects(
      createState([
        "---",
        "nocite: \"@*\"",
        "---",
        "",
        "Cites [@karger2000].",
      ].join("\n")),
      bibDataEffect.of({
        store: makeBibStore(items),
        formatter: await CslProcessor.create(items),
      }),
    );
    const { store, formatter } = state.field(bibDataField);

    ensureEditorReferencePresentationCitationsRegistered(
      state.field(documentAnalysisField),
      store,
      formatter,
      getEditorNociteConfig(state),
    );

    const registerSpy = vi.spyOn(formatter as CitationFormatter, "registerCitations");
    expect(createBibliographyWidgetFromState(state)).not.toBeNull();
    expect(registerSpy).not.toHaveBeenCalled();
    registerSpy.mockRestore();
  });
});
