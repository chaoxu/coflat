import { describe, expect, it, vi } from "vitest";
import { type CslJsonItem } from "../../core/citations/bibtex-parser";
import {
  CslProcessor,
  parseLocator,
  registerCitationsWithProcessor,
} from "./csl-processor";

describe("parseLocator", () => {
  it("parses chapter abbreviation", () => {
    expect(parseLocator("chap. 36")).toEqual({ label: "chapter", locator: "36" });
  });

  it("parses page abbreviation (plural)", () => {
    expect(parseLocator("pp. 100-120")).toEqual({ label: "page", locator: "100-120" });
  });

  it("parses page abbreviation (singular)", () => {
    expect(parseLocator("p. 42")).toEqual({ label: "page", locator: "42" });
  });

  it("parses full word labels", () => {
    expect(parseLocator("section 3.2")).toEqual({ label: "section", locator: "3.2" });
  });

  it("parses volume abbreviation", () => {
    expect(parseLocator("vol. 2")).toEqual({ label: "volume", locator: "2" });
  });

  it("treats unrecognized label text as suffix, per Pandoc", () => {
    // Pandoc: no recognized locator term → the whole text is a suffix.
    // (Previously pinned as locator "theorem 3", which citeproc rendered as
    // the garbled "p. theorem 3".)
    expect(parseLocator("theorem 3")).toEqual({ suffix: ", theorem 3" });
  });

  it("handles leading/trailing whitespace", () => {
    expect(parseLocator("  chap. 5  ")).toEqual({ label: "chapter", locator: "5" });
  });

  it("treats a label with no value as suffix, per Pandoc", () => {
    // "chap." with nothing after it — no locator value
    expect(parseLocator("chap.")).toEqual({ suffix: ", chap." });
  });

  it("splits suffix text after the locator value", () => {
    expect(parseLocator("p. 12, emphasis mine")).toEqual({
      label: "page",
      locator: "12",
      suffix: ", emphasis mine",
    });
  });

  it("keeps bare-number locators and splits trailing words as suffix", () => {
    expect(parseLocator("12")).toEqual({ locator: "12" });
    expect(parseLocator("12, but see below")).toEqual({
      locator: "12",
      suffix: ", but see below",
    });
  });

  it("parses roman numeral locators", () => {
    expect(parseLocator("xiv")).toEqual({ locator: "xiv" });
    expect(parseLocator("pp. xiv-xvi")).toEqual({ label: "page", locator: "xiv-xvi" });
  });

  it("does not treat leading roman-letter words as locator values", () => {
    expect(parseLocator("dog days")).toEqual({ suffix: ", dog days" });
  });

  it("recognizes labels ported from the CSL locale tables", () => {
    expect(parseLocator("table 5")).toEqual({ label: "table", locator: "5" });
    expect(parseLocator("§ 12")).toEqual({ label: "section", locator: "12" });
    // German and French labels map to the same CSL terms.
    expect(parseLocator("S. 5")).toEqual({ label: "page", locator: "5" });
    expect(parseLocator("Kap. 3")).toEqual({ label: "chapter", locator: "3" });
    expect(parseLocator("chapitre 7")).toEqual({ label: "chapter", locator: "7" });
  });

  it("keeps the plural 'pages' label from swallowing the value", () => {
    expect(parseLocator("pages 100")).toEqual({ label: "page", locator: "100" });
  });
});

describe("CslProcessor narrative citations", () => {
  const entry: CslJsonItem = {
    id: "karger2000",
    type: "article-journal",
    author: [{ family: "Karger", given: "David R." }],
    title: "Minimum cuts in near-linear time",
    issued: { "date-parts": [[2000]] },
    "container-title": "JACM",
  };

  it("uses author-only + suppress-author when the style provides both", () => {
    // Regression: citeNarrative must use only makeCitationCluster (stateless)
    // to avoid mutating the engine's citation registry. See #498.
    const processor = new CslProcessor([entry]);
    let callCount = 0;
    (processor as unknown as {
      engine: {
        makeCitationCluster: (items: Array<Record<string, unknown>>) => string;
      };
    }).engine = {
      makeCitationCluster: (items: Array<Record<string, unknown>>) => {
        callCount++;
        if (items[0]?.["author-only"]) return "Karger";
        if (items[0]?.["suppress-author"]) return "(2000)";
        return "[1]";
      },
    };

    expect(processor.citeNarrative("karger2000")).toBe("Karger (2000)");
    expect(callCount).toBe(2); // author-only + suppress-author, no processCitationCluster
  });

  it("falls back to author plus suppress-author cite when author-only form is unavailable", async () => {
    const processor = new CslProcessor([entry]);
    await processor.ensureReady();
    // registerCitations is required before citeNarrative in real usage —
    // it tells the engine which items exist so makeCitationCluster works.
    processor.registerCitations([{ ids: ["karger2000"] }]);
    expect(processor.citeNarrative("karger2000")).toBe("Karger [1]");
  });

  it("produces author plus bracketed number for default IEEE numeric style", async () => {
    // Regression: numeric styles like IEEE must use suppress-author fallback
    // (e.g. "Karger [1]"), not the author-year format "Karger (2000)".
    // See #359.
    const processor = new CslProcessor([entry]);
    await processor.ensureReady();
    processor.registerCitations([{ ids: ["karger2000"] }]);
    const result = processor.citeNarrative("karger2000");
    expect(result).toBe("Karger [1]");
    expect(result).not.toContain("(2000)");
  });

  it("falls back to author (year) only when engine is null", () => {
    // The Author (Year) catch-all should only trigger when the engine
    // is unavailable, not when the style is numeric.
    const processor = new CslProcessor([entry]);
    // Force engine to null to simulate init failure
    (processor as unknown as { engine: null }).engine = null;
    expect(processor.citeNarrative("karger2000")).toBe("Karger (2000)");
  });

  it("falls back to author (year) when all citeproc calls throw", () => {
    const processor = new CslProcessor([entry]);
    (processor as unknown as {
      engine: {
        makeCitationCluster: () => never;
      };
    }).engine = {
      makeCitationCluster: () => { throw new Error("citeproc error"); },
    };
    expect(processor.citeNarrative("karger2000")).toBe("Karger (2000)");
  });

  it("registers narrative citations in document order too", () => {
    const processor = {
      registerCitations: (clusters: Array<{ ids: string[] }>) => {
        expect(clusters).toEqual([
          { ids: ["karger2000"] },
          { ids: ["stein2001"] },
        ]);
      },
    } as unknown as CslProcessor;

    registerCitationsWithProcessor(
      [
        { ids: ["karger2000"] },
        { ids: ["stein2001"] },
      ],
      processor,
    );
  });

  it("does not corrupt numbering for subsequent cite() calls (#498)", async () => {
    // Regression: the old processCitationCluster-based citeNarrative
    // registered a phantom citation in the engine, causing subsequent
    // cite() calls to return wrong numbers. makeCitationCluster is stateless
    // and must not affect numbering.
    const entryA: CslJsonItem = {
      id: "alpha2020",
      type: "article-journal",
      author: [{ family: "Alpha" }],
      issued: { "date-parts": [[2020]] },
    };
    const entryB: CslJsonItem = {
      id: "beta2021",
      type: "article-journal",
      author: [{ family: "Beta" }],
      issued: { "date-parts": [[2021]] },
    };
    const processor = new CslProcessor([entryA, entryB]);
    await processor.ensureReady();
    processor.registerCitations([
      { ids: ["alpha2020"] },
      { ids: ["beta2021"] },
    ]);

    const citeBefore = processor.cite(["alpha2020"]);

    // Call citeNarrative — must NOT mutate engine state.
    processor.citeNarrative("beta2021");

    const citeAfter = processor.cite(["alpha2020"]);
    expect(citeAfter).toBe(citeBefore);
  });
});

describe("CslProcessor corporate authors", () => {
  // Regression: citeNarrative must not produce "undefined" for corporate
  // authors. CSL-JSON represents corporate/institutional authors with a
  // `literal` field and no `family`/`given`. See #346.
  it("uses literal field for corporate author narrative citation", () => {
    const entry: CslJsonItem = {
      id: "ieee2023",
      type: "report",
      author: [{ literal: "IEEE Computer Society" }],
      title: "Some Standard",
      issued: { "date-parts": [[2023]] },
    };
    const processor = new CslProcessor([entry]);
    // Force engine to null so we hit the plain author+year fallback.
    (processor as unknown as { engine: null }).engine = null;
    const result = processor.citeNarrative("ieee2023");
    expect(result).not.toContain("undefined");
    expect(result).toContain("IEEE Computer Society");
  });

  it("falls back to item id when all author name fields are absent", () => {
    const entry: CslJsonItem = {
      id: "anon2020",
      type: "article-journal",
      // Empty author objects — no literal, family, or given.
      author: [{} as { family?: string; given?: string; literal?: string }],
      issued: { "date-parts": [[2020]] },
    };
    const processor = new CslProcessor([entry]);
    (processor as unknown as { engine: null }).engine = null;
    const result = processor.citeNarrative("anon2020");
    expect(result).not.toContain("undefined");
    expect(result).toContain("anon2020");
  });

  it("handles mixed individual and corporate authors without undefined", () => {
    const entry: CslJsonItem = {
      id: "mixed2021",
      type: "report",
      author: [
        { family: "Smith", given: "John" },
        { literal: "IETF" },
      ],
      issued: { "date-parts": [[2021]] },
    };
    const processor = new CslProcessor([entry]);
    (processor as unknown as { engine: null }).engine = null;
    const result = processor.citeNarrative("mixed2021");
    expect(result).not.toContain("undefined");
    expect(result).toContain("Smith");
    expect(result).toContain("IETF");
  });
});

describe("CslProcessor ordering", () => {
  it("keeps citation engines isolated across processors with the same style", async () => {
    const alpha: CslJsonItem = {
      id: "alpha2020",
      type: "article-journal",
      author: [{ family: "Alpha" }],
      issued: { "date-parts": [[2020]] },
      title: "Alpha paper",
    };
    const beta: CslJsonItem = {
      id: "beta2021",
      type: "article-journal",
      author: [{ family: "Beta" }],
      issued: { "date-parts": [[2021]] },
      title: "Beta paper",
    };

    const first = await CslProcessor.create([alpha]);
    first.registerCitations([{ ids: ["alpha2020"] }]);
    expect(first.cite(["alpha2020"])).toBe("[1]");

    const second = await CslProcessor.create([beta]);
    second.registerCitations([{ ids: ["beta2021"] }]);
    expect(second.cite(["beta2021"])).toBe("[1]");

    // Regression (#788): a second processor must not overwrite the first
    // processor's retrieveItem callback and force raw-key fallback output.
    expect(first.cite(["alpha2020"])).toBe("[1]");
  });

  it("tracks citation registration state across shared render surfaces", async () => {
    const alpha: CslJsonItem = {
      id: "alpha2020",
      type: "article-journal",
      author: [{ family: "Alpha" }],
      issued: { "date-parts": [[2020]] },
      title: "Alpha paper",
    };
    const beta: CslJsonItem = {
      id: "beta2021",
      type: "article-journal",
      author: [{ family: "Beta" }],
      issued: { "date-parts": [[2021]] },
      title: "Beta paper",
    };

    const processor = await CslProcessor.create([alpha, beta]);

    expect(processor.citationRegistrationKey).toBeNull();

    processor.registerCitations([{ ids: ["alpha2020"] }, { ids: ["beta2021"] }]);
    const fullDocumentKey = processor.citationRegistrationKey;
    expect(fullDocumentKey).toBeTruthy();

    processor.registerCitations([{ ids: ["alpha2020"] }]);
    expect(processor.citationRegistrationKey).not.toBe(fullDocumentKey);

    await processor.setStyle("<style>invalid</style>");
    expect(processor.citationRegistrationKey).toBeNull();
  });

  it("renders non-consecutive numeric clusters inside one pair of brackets", async () => {
    const alpha: CslJsonItem = {
      id: "alpha2020",
      type: "article-journal",
      author: [{ family: "Alpha" }],
      issued: { "date-parts": [[2020]] },
      title: "Alpha paper",
    };
    const beta: CslJsonItem = {
      id: "beta2021",
      type: "article-journal",
      author: [{ family: "Beta" }],
      issued: { "date-parts": [[2021]] },
      title: "Beta paper",
    };
    const gamma: CslJsonItem = {
      id: "gamma2022",
      type: "article-journal",
      author: [{ family: "Gamma" }],
      issued: { "date-parts": [[2022]] },
      title: "Gamma paper",
    };

    const processor = await CslProcessor.create([alpha, beta, gamma]);
    processor.registerCitations([
      { ids: ["alpha2020"] },
      { ids: ["beta2021"] },
      { ids: ["gamma2022"] },
    ]);

    expect(processor.cite(["alpha2020", "gamma2022"])).toBe("[1, 3]");
  });

  it("does not register a failed citation cluster as prior context", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const processor = CslProcessor.empty() as unknown as {
      registerCitations: CslProcessor["registerCitations"];
      engine: {
        updateItems: (ids: string[]) => void;
        processCitationCluster: ReturnType<typeof vi.fn>;
      };
    };
    const processCitationCluster = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error("bad cluster");
      })
      .mockReturnValueOnce(undefined);
    processor.engine = {
      updateItems: vi.fn(),
      processCitationCluster,
    };

    try {
      processor.registerCitations([
        { ids: ["bad"] },
        { ids: ["good"] },
      ]);
    } finally {
      warn.mockRestore();
    }

    expect(processCitationCluster.mock.calls[1][0]).toEqual(
      expect.objectContaining({ citationID: "cite-1" }),
    );
    expect(processCitationCluster.mock.calls[1][1]).not.toContainEqual(["cite-0", 0]);
  });

  it("preserves registered numbering context when rendering the bibliography", () => {
    const processor = new CslProcessor([
      { id: "karger2000", type: "article-journal" as const },
    ]) as unknown as {
      bibliography: CslProcessor["bibliography"];
      engine: {
        updateItems: ReturnType<typeof vi.fn>;
        makeBibliography: ReturnType<typeof vi.fn>;
      };
    };
    const updateItems = vi.fn();
    processor.engine = {
      updateItems,
      makeBibliography: vi.fn(() => [{}, ["  <span class=\"csl-entry\">[1] Entry</span>  "]]),
    };

    const entries = processor.bibliography(["karger2000"]);

    expect(entries).toEqual(['<span class="csl-entry">[1] Entry</span>']);
    expect(updateItems).not.toHaveBeenCalled();
  });

  it("renders Pandoc locator, suffix, prefix, and suppress-author fields", async () => {
    const alpha: CslJsonItem = {
      id: "alpha2020",
      type: "article-journal",
      author: [{ family: "Alpha" }],
      issued: { "date-parts": [[2020]] },
      title: "Alpha paper",
    };
    const beta: CslJsonItem = {
      id: "beta2021",
      type: "article-journal",
      author: [{ family: "Beta" }],
      issued: { "date-parts": [[2021]] },
      title: "Beta paper",
    };
    const processor = await CslProcessor.create([alpha, beta]);
    processor.registerCitations([{ ids: ["alpha2020"] }, { ids: ["beta2021"] }]);

    // Locator + suffix split (previously rendered "pp. 12, emphasis mine").
    expect(processor.cite(["alpha2020"], ["p. 12, emphasis mine"]))
      .toBe("[1, p. 12, emphasis mine]");
    // Bare suffix without a locator.
    expect(processor.cite(["alpha2020"], ["emphasis mine"])).toBe("[1, emphasis mine]");
    // Prefix before the key.
    expect(processor.cite(["alpha2020"], [undefined], [{ prefix: "see" }]))
      .toBe("[see 1]");
    // Suppress-author is a no-op for numeric styles but must not break them.
    expect(processor.cite(["alpha2020"], [undefined], [{ suppressAuthor: true }]))
      .toBe("[1]");
    // Per-item extras across a cluster.
    expect(processor.cite(
      ["alpha2020", "beta2021"],
      [undefined, "p. 3"],
      [{ prefix: "see" }, { prefix: "cf." }],
    )).toBe("[see 1, cf. 2, p. 3]");
  });

  it("renders prefix and suppress-author for author-date styles", async () => {
    const chicago = (await import("./chicago-author-date.csl?raw")).default;
    const alpha: CslJsonItem = {
      id: "alpha2020",
      type: "article-journal",
      author: [{ family: "Alpha" }],
      issued: { "date-parts": [[2020]] },
      title: "Alpha paper",
    };
    const processor = await CslProcessor.create([alpha], chicago);
    processor.registerCitations([{ ids: ["alpha2020"] }]);

    expect(processor.cite(["alpha2020"])).toBe("(Alpha, 2020)");
    expect(processor.cite(["alpha2020"], [undefined], [{ prefix: "see" }]))
      .toBe("(see Alpha, 2020)");
    expect(processor.cite(["alpha2020"], [undefined], [{ suppressAuthor: true }]))
      .toBe("(2020)");
    expect(processor.cite(["alpha2020"], ["emphasis mine"]))
      .toBe("(Alpha, 2020, emphasis mine)");
  });

  it("accepts a bundled locale code via options", async () => {
    const alpha: CslJsonItem = {
      id: "alpha2020",
      type: "article-journal",
      author: [{ family: "Alpha" }, { family: "Beta" }, { family: "Gamma" }, { family: "Delta" }],
      issued: { "date-parts": [[2020]] },
      title: "Alpha paper",
    };
    const chicago = (await import("./chicago-author-date.csl?raw")).default;
    const en = await CslProcessor.create([alpha], chicago);
    en.registerCitations([{ ids: ["alpha2020"] }]);
    const de = await CslProcessor.create([alpha], chicago, { locale: "de-DE" });
    de.registerCitations([{ ids: ["alpha2020"] }]);

    // "et al." renders locale-dependently ("u. a." with NBSP in German).
    expect(en.cite(["alpha2020"])).toBe("(Alpha et al., 2020)");
    expect(de.cite(["alpha2020"])).toBe("(Alpha u.\u00a0a., 2020)");
  });

  it("registers host-supplied locale XML for non-bundled locales", async () => {
    const alpha: CslJsonItem = {
      id: "alpha2020",
      type: "article-journal",
      author: [{ family: "Alpha" }, { family: "Beta" }, { family: "Gamma" }, { family: "Delta" }],
      issued: { "date-parts": [[2020]] },
      title: "Alpha paper",
    };
    // A minimal locale that only overrides the "et-al" term.
    const localeXml = `<?xml version="1.0" encoding="utf-8"?>
<locale xmlns="http://purl.org/net/xbiblio/csl" version="1.0" xml:lang="xx-XX">
  <terms>
    <term name="et-al">with friends</term>
  </terms>
</locale>`;
    const chicago = (await import("./chicago-author-date.csl?raw")).default;
    const processor = await CslProcessor.create([alpha], chicago, {
      locale: "xx-XX",
      localeXml,
    });
    processor.registerCitations([{ ids: ["alpha2020"] }]);

    expect(processor.cite(["alpha2020"])).toBe("(Alpha with friends, 2020)");
  });

  it("emits citeproc bibliography wrappers for default IEEE output", async () => {
    const processor = await CslProcessor.create([
      {
        id: "karger2000",
        type: "article-journal",
        author: [{ family: "Karger", given: "David R." }],
        title: "Minimum cuts in near-linear time",
        issued: { "date-parts": [[2000]] },
        "container-title": "JACM",
      },
    ]);
    processor.registerCitations([{ ids: ["karger2000"] }]);

    const [entry] = processor.bibliography(["karger2000"]);

    expect(entry).toContain('<div class="csl-entry">');
    expect(entry).toContain('<div class="csl-left-margin">[1]</div>');
    expect(entry).toContain('<div class="csl-right-inline">');
  });
});
