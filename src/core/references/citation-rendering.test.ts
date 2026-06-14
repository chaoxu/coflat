import { describe, expect, it } from "vitest";
import type { CitationFormatter } from "../document-context-types";
import {
  bibliographyEntries,
  bibliographyEntryFor,
  citeInline,
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
