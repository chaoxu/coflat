import { describe, expect, it } from "vitest";
import type { CitationFormatter, DocumentContext } from "../core/document-context-types";
import { renderToHtml } from "./reader";

// Numeric IEEE-ish fake: numbers assigned by registration order.
function fakeFormatter(): CitationFormatter {
  const order: string[] = [];
  const num = (id: string) => {
    let i = order.indexOf(id);
    if (i === -1) {
      order.push(id);
      i = order.length - 1;
    }
    return i + 1;
  };
  return {
    cite: (ids) => ids.map((id) => `[${num(id)}]`).join(", "),
    citeNarrative: (id) => `Ref ${num(id)} [${num(id)}]`,
    bibliographyEntries: (citedIds) => {
      for (const id of citedIds) num(id);
      return order.map((id) => ({ id, html: `<div class="csl-entry">[${num(id)}] <i>${id}</i> title.</div>` }));
    },
    registerCitations: (clusters) => {
      for (const c of clusters) for (const id of c.ids) num(id);
    },
    citationRegistrationKey: null,
    revision: 0,
  };
}

function ctxWith(keys: string[]): DocumentContext {
  return { citationFormatter: fakeFormatter(), citationKeys: new Set(keys) };
}

describe("reader citations", () => {
  it("resolves inline [@key] and emits a Bibliography section", () => {
    const { html } = renderToHtml("See [@cormen2009] here.", ctxWith(["cormen2009"]));
    expect(html).toContain('class="cf-citation"');
    expect(html).toContain('data-ref-key="cormen2009"');
    expect(html).toContain(">[1]<");
    expect(html).toContain('class="cf-bibliography"');
    expect(html).toContain("Bibliography");
    expect(html).toContain("<i>cormen2009</i>"); // italics survive sanitize (i added to allowlist)
  });

  it("numbers citations in document order and lists them in that order", () => {
    const src = "First [@knuth1997]. Then [@cormen2009]. Knuth again [@knuth1997].";
    const { html } = renderToHtml(src, ctxWith(["knuth1997", "cormen2009"]));
    // knuth cited first -> [1], cormen second -> [2]
    const knuth = html.match(/data-ref-key="knuth1997"[^>]*>\[(\d)\]/);
    const cormen = html.match(/data-ref-key="cormen2009"[^>]*>\[(\d)\]/);
    expect(knuth?.[1]).toBe("1");
    expect(cormen?.[1]).toBe("2");
    // bibliography order: knuth then cormen
    const bibKnuth = html.indexOf("bib-knuth1997");
    const bibCormen = html.indexOf("bib-cormen2009");
    expect(bibKnuth).toBeGreaterThan(-1);
    expect(bibCormen).toBeGreaterThan(bibKnuth);
  });

  it("does nothing without citationKeys (backward compatible)", () => {
    const { html } = renderToHtml("See [@cormen2009] here.", { citationFormatter: fakeFormatter() });
    expect(html).not.toContain("cf-bibliography");
    expect(html).toContain("See [@cormen2009] here.");
    expect(html).not.toContain("cf-crossref-unresolved");
  });

  it("a non-citation [@eq:gaussian] is left for the host refResolver", () => {
    let asked = "";
    const ctx: DocumentContext = {
      ...ctxWith(["cormen2009"]),
      refResolver: {
        resolve: (key) => {
          asked = key;
          return { content: "Eq. 1", className: "cf-crossref" };
        },
      },
    };
    const { html } = renderToHtml("See [@eq:gaussian].", ctx);
    expect(asked).toBe("eq:gaussian");
    expect(html).toContain("Eq. 1");
    expect(html).not.toContain("cf-bibliography"); // no citation cited
  });

  it("includes frontmatter nocite entries after the cited ones", () => {
    const src = [
      "---",
      "nocite: \"@knuth1997\"",
      "---",
      "",
      "See [@cormen2009].",
    ].join("\n");
    const { html } = renderToHtml(src, ctxWith(["knuth1997", "cormen2009"]));

    expect(html).toContain('class="cf-bibliography"');
    const bibCormen = html.indexOf("bib-cormen2009");
    const bibKnuth = html.indexOf("bib-knuth1997");
    expect(bibCormen).toBeGreaterThan(-1);
    // nocite entries number after every in-text citation.
    expect(bibKnuth).toBeGreaterThan(bibCormen);
    // No inline citation was emitted for the nocite-only key.
    expect(html).not.toContain('data-ref-key="knuth1997"');
  });

  it("renders a bibliography for a nocite @* wildcard with no in-text citations", () => {
    const src = [
      "---",
      "nocite: \"@*\"",
      "---",
      "",
      "No citations in the body.",
    ].join("\n");
    const { html } = renderToHtml(src, ctxWith(["knuth1997", "cormen2009"]));

    expect(html).toContain('class="cf-bibliography"');
    const bibKnuth = html.indexOf("bib-knuth1997");
    const bibCormen = html.indexOf("bib-cormen2009");
    expect(bibKnuth).toBeGreaterThan(-1);
    expect(bibCormen).toBeGreaterThan(bibKnuth);
  });

  it("ignores nocite without citationKeys (backward compatible)", () => {
    const src = "---\nnocite: \"@cormen2009\"\n---\n\nBody.";
    const { html } = renderToHtml(src, { citationFormatter: fakeFormatter() });
    expect(html).not.toContain("cf-bibliography");
  });

  it("excludes nocite keys that resolve to local reference targets", () => {
    const src = [
      "---",
      "nocite: \"@eq:gaussian\"",
      "---",
      "",
      "$$",
      "x^2",
      "$$ {#eq:gaussian}",
      "",
      "Body.",
    ].join("\n");
    const { html } = renderToHtml(src, ctxWith(["eq:gaussian"]), {
      resolveReferences: true,
    });
    expect(html).not.toContain("cf-bibliography");
  });

  it("prefers local reference targets over colliding citation keys for the bibliography", () => {
    const src = [
      "$$",
      "x^2",
      "$$ {#eq:gaussian}",
      "",
      "See [@eq:gaussian].",
    ].join("\n");
    const { html } = renderToHtml(src, ctxWith(["eq:gaussian"]), {
      resolveReferences: true,
    });

    expect(html).toContain("(1)");
    expect(html).not.toContain("cf-bibliography");
    expect(html).not.toContain("<i>eq:gaussian</i>");
  });
});
