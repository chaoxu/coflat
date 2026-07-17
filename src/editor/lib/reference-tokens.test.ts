import { describe, expect, it } from "vitest";

import {
  parseReferenceToken,
  scanReferenceRevealTokens,
  scanReferenceTokens,
} from "./reference-tokens";

describe("reference-tokens", () => {
  it("accepts slash ids in narrative and bracketed references", () => {
    expect(parseReferenceToken("@sec:intro/motivation")).toEqual({
      bracketed: false,
      ids: ["sec:intro/motivation"],
      locators: [undefined],
    });
    expect(parseReferenceToken("[@sec:intro/motivation]")).toEqual({
      bracketed: true,
      ids: ["sec:intro/motivation"],
      locators: [undefined],
    });
  });

  it("accepts apostrophe ids in narrative and bracketed references", () => {
    expect(parseReferenceToken("@o'brien2020")).toEqual({
      bracketed: false,
      ids: ["o'brien2020"],
      locators: [undefined],
    });
    expect(parseReferenceToken("[@o'brien2020]")).toEqual({
      bracketed: true,
      ids: ["o'brien2020"],
      locators: [undefined],
    });
  });

  it("parses semicolon clusters", () => {
    expect(parseReferenceToken("[@thm:main; @eq:sum; @fig:plot]")).toEqual({
      bracketed: true,
      ids: ["thm:main", "eq:sum", "fig:plot"],
      locators: [undefined, undefined, undefined],
    });
  });

  it("excludes trailing punctuation from narrative ids", () => {
    expect(
      scanReferenceTokens("See @thm:main, @sec:results: and @fig:plot.").map(
        (token) => token.id,
      ),
    ).toEqual(["thm:main", "sec:results", "fig:plot"]);
  });

  it("accepts Pandoc prefix text before the key", () => {
    // Pandoc citation grammar: `[see @id]` is a citation with prefix "see".
    expect(parseReferenceToken("[see @id]")).toEqual({
      bracketed: true,
      ids: ["id"],
      locators: [undefined],
    });
    expect(parseReferenceToken("[@id; see @other]")).toEqual({
      bracketed: true,
      ids: ["id", "other"],
      locators: [undefined, undefined],
    });
    expect(scanReferenceTokens("[see @id]").map((token) => token.id)).toEqual(["id"]);
  });

  it("rejects malformed bracket content", () => {
    // Prefix text must end in whitespace before the `@`, and every
    // semicolon-separated part needs a key.
    expect(parseReferenceToken("[see@id]")).toBeNull();
    expect(parseReferenceToken("[no key here]")).toBeNull();
    expect(parseReferenceToken("[@id; no key]")).toBeNull();
    expect(scanReferenceTokens("[no key here]")).toEqual([]);
  });

  it("parses suppress-author markers inside and outside brackets", () => {
    expect(parseReferenceToken("[-@doe2020]")).toEqual({
      bracketed: true,
      ids: ["doe2020"],
      locators: [undefined],
    });
    expect(parseReferenceToken("-@doe2020")).toEqual({
      bracketed: false,
      ids: ["doe2020"],
      locators: [undefined],
    });
    const [token] = scanReferenceTokens("as -@doe2020 said");
    expect(token.id).toBe("doe2020");
    // The narrative token covers the suppress marker: `-@doe2020`.
    expect(token.from).toBe(3);
    expect(token.to).toBe(12);
    expect(token.labelFrom).toBe(5);
    expect(token.labelTo).toBe(12);
  });

  it("parses locator clusters", () => {
    expect(parseReferenceToken("[@doe2020, p. 12; @roe2021, ch. 3]")).toEqual({
      bracketed: true,
      ids: ["doe2020", "roe2021"],
      locators: ["p. 12", "ch. 3"],
    });
  });

  it("exposes one reveal token per rendered reference source", () => {
    expect(
      scanReferenceRevealTokens("See [@eq:sum; @fig:plot] and @sec:intro.").map((token) => ({
        bracketed: token.bracketed,
        source: token.source,
      })),
    ).toEqual([
      { bracketed: true, source: "[@eq:sum; @fig:plot]" },
      { bracketed: false, source: "@sec:intro" },
    ]);
  });

  it("treats a detached dash as prefix text, not author suppression", () => {
    expect(parseReferenceToken("@thm:foo")).toEqual({
      bracketed: false,
      ids: ["thm:foo"],
      locators: [undefined],
    });
    // `- @key` (dash + space) is a one-character Pandoc prefix; only the
    // adjacent `-@key` form suppresses the author.
    expect(parseReferenceToken("[- @thm:foo]")).toEqual({
      bracketed: true,
      ids: ["thm:foo"],
      locators: [undefined],
    });
    expect(scanReferenceTokens("See [- @thm:foo] and @thm:bar.").map((token) => token.id))
      .toEqual(["thm:foo", "thm:bar"]);
  });
});
