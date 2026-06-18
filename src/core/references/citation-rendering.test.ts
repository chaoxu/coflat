import { describe, expect, it } from "vitest";
import type { CitationFormatter } from "../document-context-types";
import {
  appendCitedKeysFromReferenceIds,
  bibliographyEntries,
  bibliographyEntryFor,
  citeInline,
  collectCitationMatches,
  collectCitedIdsFromReferences,
  getCitationRegistrationKey,
  isCitationKey,
} from "./citation-rendering";

// A stand-in formatter whose bibliographyEntries returns the FULL list
// regardless of the id argument — mirroring real citeproc behavior, which is
// exactly the gotcha bibliographyEntries() must absorb.
function fakeFormatter(order: readonly string[]): CitationFormatter {
  const number = new Map(order.map((id, i) => [id, i + 1]));
  return {
    cite: (ids, locators) =>
      ids
        .map((id, i) => {
          const loc = locators[i];
          return `[${number.get(id) ?? "?"}${loc ? `, ${loc}` : ""}]`;
        })
        .join(", "),
    citeNarrative: (id) => `Author ${number.get(id) ?? "?"} [${number.get(id) ?? "?"}]`,
    bibliographyEntries: () => order.map((id) => ({ id, html: `<div>[${number.get(id)}] ${id}</div>` })),
    registerCitations: () => {},
    citationRegistrationKey: null,
    revision: 0,
  };
}

describe("isCitationKey", () => {
  it("is true only for known keys", () => {
    const keys = new Set(["a", "b"]);
    expect(isCitationKey(keys, "a")).toBe(true);
    expect(isCitationKey(keys, "eq:gaussian")).toBe(false);
    expect(isCitationKey(undefined, "a")).toBe(false);
  });
});

describe("citeInline", () => {
  it("formats inline; null without a formatter", () => {
    const fmt = fakeFormatter(["a", "b"]);
    expect(citeInline(fmt, ["a"], [undefined])).toBe("[1]");
    expect(citeInline(fmt, ["a"], ["p. 4"])).toBe("[1, p. 4]");
    expect(citeInline(undefined, ["a"])).toBeNull();
  });
});

describe("bibliographyEntries", () => {
  it("returns entries picked BY ID in cited order, not by position", () => {
    const fmt = fakeFormatter(["alpha", "beta", "gamma"]);
    // Hover/References for beta must get beta's entry, not entries[0] (alpha).
    expect(bibliographyEntryFor(fmt, "beta")).toEqual({ id: "beta", html: "<div>[2] beta</div>" });
    const list = bibliographyEntries(fmt, ["gamma", "alpha"]);
    expect(list.map((e) => e.id)).toEqual(["gamma", "alpha"]);
  });

  it("dedupes and ignores unknown keys; empty without formatter", () => {
    const fmt = fakeFormatter(["a", "b"]);
    expect(bibliographyEntries(fmt, ["a", "a", "zzz"]).map((e) => e.id)).toEqual(["a"]);
    expect(bibliographyEntries(undefined, ["a"])).toEqual([]);
    expect(bibliographyEntries(fmt, [])).toEqual([]);
  });
});

describe("citation collection policy", () => {
  const store = {
    has: (id: string) => id === "alpha" || id === "beta" || id === "local",
  };

  it("filters local targets while preserving cluster and locator order", () => {
    const matches = collectCitationMatches([
      {
        ids: ["local", "alpha", "missing", "beta"],
        locators: [undefined, "p. 3", undefined, "sec. 2"],
      },
      {
        ids: ["alpha"],
        locators: [undefined],
      },
    ], store, {
      isLocalTarget: (id) => id === "local",
    });

    expect(matches).toEqual([
      { ids: ["alpha", "beta"], locators: ["p. 3", "sec. 2"] },
      { ids: ["alpha"], locators: [undefined] },
    ]);
    expect(getCitationRegistrationKey(matches)).toBe(
      "alpha\0p. 3\u0001beta\0sec. 2\u0002alpha\0",
    );
  });

  it("collects first-citation bibliography order through one policy", () => {
    expect(collectCitedIdsFromReferences([
      {
        ids: ["beta", "local", "alpha"],
        locators: [],
      },
      {
        ids: ["alpha", "beta"],
        locators: [],
      },
    ], store, {
      isLocalTarget: (id) => id === "local",
    })).toEqual(["beta", "alpha"]);
  });

  it("appends cited keys without duplicating existing registrations", () => {
    const citedIds = ["alpha"];
    appendCitedKeysFromReferenceIds(
      citedIds,
      ["local", "beta", "alpha"],
      new Set(["alpha", "beta", "local"]),
      { isLocalTarget: (id) => id === "local" },
    );

    expect(citedIds).toEqual(["alpha", "beta"]);
  });
});
