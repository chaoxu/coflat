import { describe, expect, it } from "vitest";
import { extractReferences } from "../../parse";

describe("extractReferences", () => {
  it("extracts a plain markdown link", () => {
    const src = "see [the docs](https://example.com) for more";
    const refs = extractReferences(src);
    expect(refs).toHaveLength(1);
    const [r] = refs;
    expect(r.kind).toBe("link");
    expect(r.href).toBe("https://example.com");
    expect(src.slice(r.from, r.to)).toBe("[the docs](https://example.com)");
    expect(r.raw).toBe("[the docs](https://example.com)");
  });

  it("extracts an image", () => {
    const src = "![alt text](./logo.png)";
    const refs = extractReferences(src);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: "image",
      href: "./logo.png",
      from: 0,
      to: src.length,
    });
  });

  it("extracts a bracketed reference [@key] as crossref", () => {
    const src = "as shown [@knuth1984] earlier";
    const refs = extractReferences(src);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: "crossref",
      key: "knuth1984",
      bracketed: true,
    });
    expect(src.slice(refs[0].from, refs[0].to)).toBe("@knuth1984");
  });

  it("extracts bare @key as crossref", () => {
    const src = "see @knuth1984 for details";
    const refs = extractReferences(src);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: "crossref",
      key: "knuth1984",
      bracketed: false,
    });
    expect(src.slice(refs[0].from, refs[0].to)).toBe("@knuth1984");
  });

  it("classifies @eq:pythag as crossref", () => {
    const src = "see equation @eq:pythag";
    const refs = extractReferences(src);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: "crossref",
      key: "eq:pythag",
    });
  });

  it("classifies @sec:intro and @thm:main as crossrefs", () => {
    const src = "see @sec:intro and @thm:main";
    const refs = extractReferences(src);
    expect(refs.map((r) => ({ kind: r.kind, key: r.key }))).toEqual([
      { kind: "crossref", key: "sec:intro" },
      { kind: "crossref", key: "thm:main" },
    ]);
  });

  it("does NOT extract refs or links inside an inline code span", () => {
    const src = "literal `[@foo](http://x)` and `@bar` should be left alone";
    const refs = extractReferences(src);
    expect(refs).toEqual([]);
  });

  it("does NOT extract refs inside a fenced code block", () => {
    const src = "```\n[@foo] and @bar and [text](http://x)\n```\n";
    const refs = extractReferences(src);
    expect(refs).toEqual([]);
  });

  it("does NOT extract an escaped \\[@foo\\] as a ref", () => {
    const src = "literal \\[@foo\\] not a ref";
    const refs = extractReferences(src);
    expect(refs).toEqual([]);
  });

  it("extracts multiple refs on one line in source order", () => {
    const src = "see [@a], then @b:x, then [@c]";
    const refs = extractReferences(src);
    expect(refs.map((r) => r.key)).toEqual(["a", "b:x", "c"]);
    // Sorted by `from`
    expect(refs[0].from).toBeLessThan(refs[1].from);
    expect(refs[1].from).toBeLessThan(refs[2].from);
  });

  it("extracts multiple keys inside a single [@a; @b] cluster", () => {
    const src = "see [@knuth1984; @eq:pythag]";
    const refs = extractReferences(src);
    expect(refs.map((r) => ({ kind: r.kind, key: r.key }))).toEqual([
      { kind: "crossref", key: "knuth1984" },
      { kind: "crossref", key: "eq:pythag" },
    ]);
  });

  it("returns items sorted by `from`", () => {
    const src = "@b and @a and [text](http://x) and @c";
    const refs = extractReferences(src);
    const froms = refs.map((r) => r.from);
    const sorted = [...froms].sort((a, b) => a - b);
    expect(froms).toEqual(sorted);
  });

  it("does not extract bare @key inside YAML frontmatter", () => {
    const src = "---\ntitle: hello @nobody\nauthor: @alice\n---\n\nBody with @claude here.";
    const refs = extractReferences(src);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ kind: "crossref", key: "claude" });
  });

  it("does not extract bare @key inside HTML comments", () => {
    const src = "<!-- todo @alice review this -->\n\nReal mention: @bob.";
    const refs = extractReferences(src);
    expect(refs).toHaveLength(1);
    expect(refs[0].key).toBe("bob");
  });

  it("does not extract bare @key inside inline math", () => {
    const src = "Solve $x = @something$ for x.";
    const refs = extractReferences(src);
    expect(refs).toHaveLength(0);
  });

  it("does not extract bare @key inside display math", () => {
    const src = "Equation:\n$$\n@notakey + 1 = 0\n$$\nDone.";
    const refs = extractReferences(src);
    expect(refs).toHaveLength(0);
  });

  it("extracts [@key](url) as a single link, not a double extraction", () => {
    const src = "see [@knuth1984](https://example.com/k1984)";
    const refs = extractReferences(src);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      kind: "link",
      href: "https://example.com/k1984",
    });
  });

  it("parses a link with a parenthesized title", () => {
    const src = `look [here](https://example.com "the docs")`;
    const refs = extractReferences(src);
    expect(refs).toHaveLength(1);
    expect(refs[0].kind).toBe("link");
    expect(refs[0].href).toBe("https://example.com");
  });

  it("handles multi-line source with refs on different lines", () => {
    const src = "First line @alice.\n\nSecond line [@knuth1984].\n\nThird line.";
    const refs = extractReferences(src);
    expect(refs.map((r) => ({ kind: r.kind, key: r.key }))).toEqual([
      { kind: "crossref", key: "alice" },
      { kind: "crossref", key: "knuth1984" },
    ]);
  });
});
