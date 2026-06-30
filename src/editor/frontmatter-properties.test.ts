import { describe, expect, it } from "vitest";

import {
  editFrontmatter,
  readPanelProperties,
  removeMathMacro,
  renameMathMacro,
  setFrontmatterScalar,
  setMathMacro,
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
