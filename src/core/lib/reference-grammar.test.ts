import { describe, expect, it } from "vitest";
import {
  BRACKETED_REFERENCE_EXACT_RE,
  extractReferenceCluster,
  NARRATIVE_REFERENCE_EXACT_RE,
  NARRATIVE_REFERENCE_GLOBAL_RE,
  parseReferenceClusterBody,
} from "./reference-grammar";

function matchAll(text: string): Array<{ raw: string; id: string; index: number }> {
  NARRATIVE_REFERENCE_GLOBAL_RE.lastIndex = 0;
  return [...text.matchAll(NARRATIVE_REFERENCE_GLOBAL_RE)].map((match) => ({
    raw: match[0],
    id: match[1],
    index: match.index ?? 0,
  }));
}

describe("bracketed cluster body", () => {
  it("parses the plain single-item cluster unchanged", () => {
    expect(parseReferenceClusterBody("@doe2020")).toEqual([
      {
        id: "doe2020",
        locator: undefined,
        prefix: undefined,
        suppressAuthor: undefined,
        markerFrom: 0,
        markerTo: 8,
      },
    ]);
  });

  it("keeps multi-item comma-locator parsing byte-compatible", () => {
    expect(extractReferenceCluster("@a, p. 12; @b, chap. 3")).toEqual({
      ids: ["a", "b"],
      locators: ["p. 12", "chap. 3"],
    });
  });

  it("parses suppress-author at cluster start and middle", () => {
    const items = parseReferenceClusterBody("-@a; @b; -@c, p. 3");
    expect(items?.map((item) => ({
      id: item.id,
      suppressAuthor: item.suppressAuthor,
      locator: item.locator,
    }))).toEqual([
      { id: "a", suppressAuthor: true, locator: undefined },
      { id: "b", suppressAuthor: undefined, locator: undefined },
      { id: "c", suppressAuthor: true, locator: "p. 3" },
    ]);
  });

  it("parses prefix text before the key", () => {
    const items = parseReferenceClusterBody("see also @a, p. 3; cf. @b");
    expect(items?.map((item) => ({ id: item.id, prefix: item.prefix }))).toEqual([
      { id: "a", prefix: "see also" },
      { id: "b", prefix: "cf." },
    ]);
  });

  it("parses prefix combined with suppress-author", () => {
    const items = parseReferenceClusterBody("see -@a");
    expect(items?.[0]).toMatchObject({
      id: "a",
      prefix: "see",
      suppressAuthor: true,
    });
  });

  it("keeps commas in the after-key text as one locator/suffix string", () => {
    const items = parseReferenceClusterBody("@a, p. 12, emphasis mine");
    expect(items?.[0].locator).toBe("p. 12, emphasis mine");
  });

  it("points markerFrom/markerTo at the @id even with prefix and suppression", () => {
    const body = "see -@key, p. 3";
    const items = parseReferenceClusterBody(body);
    expect(items?.[0].markerFrom).toBe(body.indexOf("@"));
    expect(items?.[0].markerTo).toBe(body.indexOf("@") + "@key".length);
  });

  it("requires whitespace between prefix and key", () => {
    expect(parseReferenceClusterBody("see@a")).toBeNull();
    expect(BRACKETED_REFERENCE_EXACT_RE.test("[see@a]")).toBe(false);
  });

  it("rejects prefixes containing @", () => {
    expect(parseReferenceClusterBody("mail me@x.org @a")).toBeNull();
  });

  it("rejects semicolon parts without a key", () => {
    expect(parseReferenceClusterBody("@a; no key")).toBeNull();
    expect(parseReferenceClusterBody("no key")).toBeNull();
  });

  it("matches Pandoc prefix clusters with the exact regex", () => {
    expect(BRACKETED_REFERENCE_EXACT_RE.test("[see @a]")).toBe(true);
    expect(BRACKETED_REFERENCE_EXACT_RE.test("[-@a]")).toBe(true);
    expect(BRACKETED_REFERENCE_EXACT_RE.test("[see -@a, p. 3; also @b]")).toBe(true);
    expect(BRACKETED_REFERENCE_EXACT_RE.test("[@a]")).toBe(true);
  });
});

describe("narrative references", () => {
  it("matches -@key with the suppress marker included", () => {
    expect(matchAll("as -@doe2020 said")).toEqual([
      { raw: "-@doe2020", id: "doe2020", index: 3 },
    ]);
    expect(NARRATIVE_REFERENCE_EXACT_RE.test("-@doe2020")).toBe(true);
  });

  it("does not treat an intra-word hyphen as a suppress marker", () => {
    // `x-@key` keeps the pre-existing behavior: the hyphen stays text.
    expect(matchAll("pre-@doe2020")).toEqual([
      { raw: "@doe2020", id: "doe2020", index: 4 },
    ]);
  });

  it("still matches plain narrative keys", () => {
    expect(matchAll("see @doe2020.")).toEqual([
      { raw: "@doe2020", id: "doe2020", index: 4 },
    ]);
  });
});
