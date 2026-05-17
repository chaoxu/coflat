import { describe, expect, it } from "vitest";
import {
  parseFrontmatter,
  serializeFrontmatter,
  updateFrontmatter,
} from "../../parse";

describe("parseFrontmatter (generic)", () => {
  it("returns nulls/source when no frontmatter present", () => {
    const src = "# Hello\n\nNo frontmatter here.\n";
    const out = parseFrontmatter(src);
    expect(out.frontmatter).toBeNull();
    expect(out.range).toBeNull();
    expect(out.body).toBe(src);
  });

  it("parses a typical frontmatter block", () => {
    const src = "---\ntitle: Hello\nauthor: Chao\n---\n\n# Body\n";
    const out = parseFrontmatter(src);
    expect(out.frontmatter).toEqual({ title: "Hello", author: "Chao" });
    expect(out.range).toEqual({ from: 0, to: "---\ntitle: Hello\nauthor: Chao\n---\n".length });
    expect(out.body).toBe("\n# Body\n");
  });

  it("treats empty `---\\n---\\n` as an empty mapping with a range", () => {
    const src = "---\n---\n\n# Body\n";
    const out = parseFrontmatter(src);
    expect(out.frontmatter).toEqual({});
    expect(out.range).toEqual({ from: 0, to: "---\n---\n".length });
    expect(out.body).toBe("\n# Body\n");
  });

  it("malformed YAML inside a well-formed block → frontmatter:null, range set", () => {
    // Unterminated quote makes the YAML parser throw.
    const src = '---\ntitle: "unterminated\n---\n\nbody\n';
    const out = parseFrontmatter(src);
    expect(out.frontmatter).toBeNull();
    expect(out.range).not.toBeNull();
    expect(out.body).toBe("\nbody\n");
  });
});

describe("serializeFrontmatter", () => {
  it("serializes object + body into a `---` block", () => {
    const result = serializeFrontmatter({ title: "Hello" }, "\n# Body\n");
    expect(result).toBe("---\ntitle: Hello\n---\n\n# Body\n");
  });

  it("round-trips a parsed-then-unchanged document byte-for-byte", () => {
    const src = "---\ntitle: Hello\nauthor: Chao\n---\n\n# Body\n";
    const parsed = parseFrontmatter(src);
    expect(parsed.frontmatter).not.toBeNull();
    const out = serializeFrontmatter(parsed.frontmatter!, parsed.body);
    expect(out).toBe(src);
  });

  it("emits an empty `---\\n---\\n` block when frontmatter is `{}`", () => {
    const result = serializeFrontmatter({}, "body\n");
    expect(result).toBe("---\n---\nbody\n");
  });

  it("keyOrder reorders specified keys to the front, remaining in insertion order", () => {
    const result = serializeFrontmatter(
      { author: "Chao", title: "Hello", date: "2026-05-16" },
      "",
      { keyOrder: ["title", "date"] },
    );
    expect(result.startsWith("---\ntitle: Hello\ndate: 2026-05-16\nauthor: Chao\n---\n")).toBe(true);
  });

  it("CRLF body → CRLF frontmatter on serialize", () => {
    const body = "\r\n# Hello\r\nworld\r\n";
    const out = serializeFrontmatter({ title: "Hi" }, body);
    expect(out).toBe("---\r\ntitle: Hi\r\n---\r\n\r\n# Hello\r\nworld\r\n");
  });
});

describe("updateFrontmatter", () => {
  it("identity mutator preserves source byte-for-byte (in-source key order)", () => {
    const src = "---\ntitle: Hello\nauthor: Chao\nnumbering: global\n---\n\n# Body\n";
    const out = updateFrontmatter(src, () => {
      /* no-op */
    });
    expect(out).toBe(src);
  });

  it("identity mutator with returned object still preserves source order", () => {
    const src = "---\ntitle: Hello\nauthor: Chao\n---\n\n# Body\n";
    const out = updateFrontmatter(src, (fm) => ({ ...fm }));
    expect(out).toBe(src);
  });

  it("adding a key appends it after existing keys", () => {
    const src = "---\ntitle: Hello\nauthor: Chao\n---\n\n# Body\n";
    const out = updateFrontmatter(src, (fm) => {
      fm.numbering = "global";
    });
    expect(out).toBe("---\ntitle: Hello\nauthor: Chao\nnumbering: global\n---\n\n# Body\n");
  });

  it("deleting a key preserves order of remaining keys", () => {
    const src = "---\ntitle: Hello\nauthor: Chao\nnumbering: global\n---\n\n# Body\n";
    const out = updateFrontmatter(src, (fm) => {
      delete fm.author;
    });
    expect(out).toBe("---\ntitle: Hello\nnumbering: global\n---\n\n# Body\n");
  });

  it("replacing whole object via return value uses the returned object", () => {
    const src = "---\ntitle: Old\n---\n\nbody\n";
    const out = updateFrontmatter(src, () => ({ title: "New", extra: 1 }));
    expect(out).toBe("---\ntitle: New\nextra: 1\n---\n\nbody\n");
  });

  it("synthesizes a frontmatter block when source has none but mutator adds keys", () => {
    const src = "# Just a body\n";
    const out = updateFrontmatter(src, (fm) => {
      fm.title = "Added";
    });
    expect(out).toBe("---\ntitle: Added\n---\n# Just a body\n");
  });

  it("no-op when source has no frontmatter and mutator leaves it empty", () => {
    const src = "# Body only\n";
    const out = updateFrontmatter(src, () => {
      /* nothing */
    });
    expect(out).toBe(src);
  });

  it("CRLF source round-trips with CRLF frontmatter", () => {
    const src = "---\r\ntitle: Hello\r\n---\r\n\r\n# Body\r\n";
    const out = updateFrontmatter(src, () => {
      /* no-op */
    });
    expect(out).toBe(src);
  });
});
