import { describe, expect, it } from "vitest";
import {
  applyReferenceSurface,
  renderReferenceSurfaceHtml,
} from "./reference-surface";

describe("reference surface", () => {
  it("renders the shared reference root attributes for HTML surfaces", () => {
    expect(
      renderReferenceSurfaceHtml("<em>Theorem 4</em>", {
        className: "cf-crossref",
        refKey: "thm:target",
        refMode: "bracketed",
        sourceAttrs: ' data-source-from="1"',
      }),
    ).toBe(
      '<span class="cf-crossref" data-ref-key="thm:target" data-ref-mode="bracketed" data-source-from="1"><em>Theorem 4</em></span>',
    );
  });

  it("escapes reference metadata without escaping trusted inner HTML", () => {
    expect(
      renderReferenceSurfaceHtml("<strong>label</strong>", {
        className: 'cf-crossref" host',
        refKey: 'a"b',
        refMode: "narrative",
      }),
    ).toBe(
      '<span class="cf-crossref&quot; host" data-ref-key="a&quot;b" data-ref-mode="narrative"><strong>label</strong></span>',
    );
  });

  it("applies the same reference root attributes to DOM surfaces", () => {
    const el = document.createElement("span");
    applyReferenceSurface(el, {
      className: "cf-crossref host-ref",
      refKey: "external:page",
      refMode: "bracketed",
    });

    expect(el.className).toBe("cf-crossref host-ref");
    expect(el.dataset.refKey).toBe("external:page");
    expect(el.dataset.refMode).toBe("bracketed");
  });
});
