import { describe, expect, it } from "vitest";

import {
  editFrontmatter,
  readPanelProperties,
  readRawFrontmatter,
  removeMathMacro,
  renameFrontmatterScalar,
  renameMathMacro,
  setFrontmatterScalar,
  setMathMacro,
  setRawFrontmatter,
} from "./frontmatter-properties.js";

const DOC = `---
id: ztrcpji2
bibliography: reference.bib
title: "Rank reduction"
math:
  \\cl: "\\\\operatorname{cl}"
---

motivated by a workshop question

::: {.problem}
body
:::
`;

describe("readPanelProperties", () => {
  it("reads scalar fields and math macros", () => {
    const p = readPanelProperties(DOC);
    expect(p.id).toBe("ztrcpji2");
    expect(p.bibliography).toBe("reference.bib");
    expect(p.title).toBe("Rank reduction");
    expect(p.math).toEqual({ "\\cl": "\\operatorname{cl}" });
  });

  it("returns empty math and undefined fields when no frontmatter", () => {
    const p = readPanelProperties("just body text\n");
    expect(p.math).toEqual({});
    expect(p.title).toBeUndefined();
  });
});

describe("setFrontmatterScalar", () => {
  it("updates an existing key, preserving body and other keys", () => {
    const out = setFrontmatterScalar(DOC, "title", "New Title");
    const p = readPanelProperties(out);
    expect(p.title).toBe("New Title");
    expect(p.id).toBe("ztrcpji2");
    expect(out).toContain("motivated by a workshop question");
    expect(out.endsWith(":::\n")).toBe(true);
  });

  it("adds a new key", () => {
    const out = setFrontmatterScalar(DOC, "status", "draft");
    expect(readPanelProperties(out).status).toBe("draft");
  });

  it("removes a key when value is null", () => {
    const out = setFrontmatterScalar(DOC, "bibliography", null);
    expect(readPanelProperties(out).bibliography).toBeUndefined();
    expect(readPanelProperties(out).id).toBe("ztrcpji2");
  });

  it("creates a frontmatter block when none exists", () => {
    const out = setFrontmatterScalar("body only\n", "title", "Hello");
    expect(out.startsWith("---\n")).toBe(true);
    expect(readPanelProperties(out).title).toBe("Hello");
    expect(out).toContain("body only");
  });
});

describe("math macro editing", () => {
  it("adds a macro to an existing math map", () => {
    const out = setMathMacro(DOC, "\\R", "\\mathbb{R}");
    expect(readPanelProperties(out).math).toEqual({
      "\\cl": "\\operatorname{cl}",
      "\\R": "\\mathbb{R}",
    });
  });

  it("creates the math map when adding the first macro", () => {
    const out = setMathMacro("---\nid: x\n---\nbody\n", "\\R", "\\mathbb{R}");
    expect(readPanelProperties(out).math).toEqual({ "\\R": "\\mathbb{R}" });
    expect(readPanelProperties(out).id).toBe("x");
  });

  it("updates an existing macro expansion", () => {
    const out = setMathMacro(DOC, "\\cl", "\\operatorname{closure}");
    expect(readPanelProperties(out).math["\\cl"]).toBe("\\operatorname{closure}");
  });

  it("removes a macro and drops the empty math map", () => {
    const out = removeMathMacro(DOC, "\\cl");
    expect(readPanelProperties(out).math).toEqual({});
    expect(out).not.toContain("math:");
    expect(readPanelProperties(out).id).toBe("ztrcpji2");
  });

  it("renames a macro keeping its expansion", () => {
    const out = renameMathMacro(DOC, "\\cl", "\\clos");
    expect(readPanelProperties(out).math).toEqual({ "\\clos": "\\operatorname{cl}" });
  });
});

describe("losslessness", () => {
  it("preserves comments on untouched keys", () => {
    const withComment = `---
id: x # stable id
title: T
---
body
`;
    const out = setFrontmatterScalar(withComment, "title", "T2");
    expect(out).toContain("# stable id");
    expect(readPanelProperties(out).title).toBe("T2");
  });

  it("preserves key order when editing", () => {
    const out = setFrontmatterScalar(DOC, "id", "newid");
    const keys = out
      .slice(4, out.indexOf("\n---"))
      .split("\n")
      .map((l) => l.split(":")[0].trim())
      .filter((k) => k && !k.startsWith("\\"));
    expect(keys.slice(0, 3)).toEqual(["id", "bibliography", "title"]);
  });

  it("is a no-op shape for an unrelated edit round-trip", () => {
    const out = editFrontmatter(DOC, () => {});
    expect(readPanelProperties(out)).toEqual(readPanelProperties(DOC));
  });
});

describe("arbitrary (extra) properties", () => {
  const WITH_EXTRA = `---
title: T
keywords: algebra, topology
license:
---
body
`;

  it("reads non-known top-level string keys as extra, in order", () => {
    const extra = readPanelProperties(WITH_EXTRA).extra;
    // `keywords` is a string; `license` has no value (null) and surfaces blank.
    expect(extra).toEqual({ keywords: "algebra, topology", license: "" });
  });

  it("excludes known keys and `math` from extra", () => {
    expect(readPanelProperties(DOC).extra).toEqual({});
  });

  it("does not surface typed scalars or nested maps as extra", () => {
    const doc = `---\ncount: 5\nflag: true\nnested:\n  a: 1\n---\nbody\n`;
    expect(readPanelProperties(doc).extra).toEqual({});
  });

  it("adds and removes an extra key via setFrontmatterScalar", () => {
    const added = setFrontmatterScalar(DOC, "license", "CC-BY");
    expect(readPanelProperties(added).extra).toEqual({ license: "CC-BY" });
    const removed = setFrontmatterScalar(added, "license", null);
    expect(readPanelProperties(removed).extra).toEqual({});
  });

  it("renames an extra key while keeping its value", () => {
    const out = renameFrontmatterScalar(WITH_EXTRA, "keywords", "tags");
    const extra = readPanelProperties(out).extra;
    expect(extra.tags).toBe("algebra, topology");
    expect(extra.keywords).toBeUndefined();
  });

  it("rename is a no-op for a missing or unchanged key", () => {
    expect(renameFrontmatterScalar(WITH_EXTRA, "absent", "x")).toBe(WITH_EXTRA);
    expect(renameFrontmatterScalar(WITH_EXTRA, "keywords", "keywords")).toBe(WITH_EXTRA);
  });
});

describe("raw YAML escape hatch", () => {
  it("reads the inner YAML between the fences", () => {
    expect(readRawFrontmatter(DOC)).toContain('title: "Rank reduction"');
    expect(readRawFrontmatter(DOC)).not.toContain("---");
    expect(readRawFrontmatter("no frontmatter\n")).toBe("");
  });

  it("replaces the whole block, preserving the body", () => {
    const out = setRawFrontmatter(DOC, 'title: New\nkeywords: [a, b]');
    expect(out).toContain("title: New");
    expect(out).toContain("keywords: [a, b]");
    expect(out).not.toContain("bibliography"); // old keys replaced wholesale
    expect(out).toContain("motivated by a workshop question"); // body intact
    expect(readPanelProperties(out).title).toBe("New");
  });

  it("drops the block when the raw content is blank", () => {
    const out = setRawFrontmatter(DOC, "   \n  ");
    expect(out.startsWith("---")).toBe(false);
    expect(out).toContain("motivated by a workshop question");
  });

  it("round-trips read → set without changing the document", () => {
    expect(setRawFrontmatter(DOC, readRawFrontmatter(DOC))).toBe(DOC);
  });
});
