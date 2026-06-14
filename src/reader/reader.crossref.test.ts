import { describe, expect, it } from "vitest";
import type { DocumentContext } from "../core/document-context-types";
import { renderToHtml } from "./reader";

const OPTS = { resolveReferences: true } as const;

describe("reader in-document crossref resolution", () => {
  it("resolves a labeled equation reference to its number + #id link", () => {
    const src = "$$x^2$$ {#eq:main}\n\nSee [@eq:main].";
    const { html } = renderToHtml(src, undefined, OPTS);
    expect(html).toContain('class="cf-crossref"');
    expect(html).toContain('data-ref-key="eq:main"');
    expect(html).toContain('href="#eq%3Amain"');
    expect(html).toContain("Eq. (1)");
  });

  it("resolves a heading reference to its section number", () => {
    const src = "# Intro {#sec:intro}\n\n## Background {#sec:bg}\n\nSee [@sec:bg].";
    const { html } = renderToHtml(src, undefined, OPTS);
    expect(html).toContain('data-ref-key="sec:bg"');
    expect(html).toContain("Section 1.1");
  });

  it("resolves a theorem block reference; numbers increment", () => {
    const src =
      "::: {.theorem #thm:a}\nFirst.\n:::\n\n::: {.theorem #thm:b}\nSecond.\n:::\n\nSee [@thm:a] and [@thm:b].";
    const { html } = renderToHtml(src, undefined, OPTS);
    expect(html).toContain("Theorem 1");
    expect(html).toContain("Theorem 2");
    const a = html.match(/data-ref-key="thm:a"[\s\S]*?>Theorem (\d)</);
    const b = html.match(/data-ref-key="thm:b"[\s\S]*?>Theorem (\d)</);
    expect(a?.[1]).toBe("1");
    expect(b?.[1]).toBe("2");
  });

  it("resolves a FORWARD reference (ref before its target)", () => {
    const src = "See [@thm:later].\n\n::: {.theorem #thm:later}\nBody.\n:::";
    const { html } = renderToHtml(src, undefined, OPTS);
    expect(html).toContain('data-ref-key="thm:later"');
    expect(html).toMatch(/data-ref-key="thm:later"[\s\S]*?>Theorem 1</);
    expect(html).not.toContain("cf-crossref-unresolved");
  });

  it("does not resolve a crossref to a target truncated away (catalog rollback)", () => {
    // The ref is in the first (kept) block; its target theorem is in the second
    // block, dropped by the line budget. The catalog entry for the dropped block
    // must be rolled back so the ref does not show a phantom "Theorem 1".
    const src = "See [@thm:later].\n\n::: {.theorem #thm:later}\nBody.\n:::";
    const { html } = renderToHtml(src, undefined, { resolveReferences: true, truncate: { lines: 1 } });
    expect(html).not.toContain("Theorem 1");
  });

  it("without resolveReferences, defers to the host refResolver (backward compatible)", () => {
    let asked = false;
    const ctx: DocumentContext = {
      refResolver: {
        resolve: (key) => {
          asked = true;
          return { content: `host:${key}`, className: "cf-crossref" };
        },
      },
    };
    const src = "$$x^2$$ {#eq:main}\n\nSee [@eq:main].";
    const { html } = renderToHtml(src, ctx); // no resolveReferences
    expect(asked).toBe(true);
    expect(html).toContain("host:eq:main");
  });

  it("falls back to the host for ids the document doesn't define", () => {
    let askedKey = "";
    const ctx: DocumentContext = {
      refResolver: {
        resolve: (key) => {
          askedKey = key;
          return { content: "Other page", href: "/other", className: "cf-crossref" };
        },
      },
    };
    const src = "# Intro {#sec:intro}\n\nSee [@sec:intro] and [@external:page].";
    const { html } = renderToHtml(src, ctx, OPTS);
    expect(html).toContain("Section 1"); // in-doc, reader-resolved
    expect(askedKey).toBe("external:page"); // unknown id -> host fallback
    expect(html).toContain("Other page");
  });
});
