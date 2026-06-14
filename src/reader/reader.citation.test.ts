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
  it("resolves inline [@key] and emits a References section", () => {
    const { html } = renderToHtml("See [@cormen2009] here.", ctxWith(["cormen2009"]));
    expect(html).toContain('class="cf-citation"');
    expect(html).toContain('data-ref-key="cormen2009"');
    expect(html).toContain(">[1]<");
    expect(html).toContain('class="cf-bibliography"');
    expect(html).toContain("References");
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
    expect(html).toContain("cf-crossref-unresolved"); // falls through to unresolved
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
});
