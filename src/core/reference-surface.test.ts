import { describe, expect, it } from "vitest";
import {
  appendReferenceListSurfaceDom,
  applyReferenceSurface,
  renderReferenceListSurfaceHtml,
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

  it("renders reference lists with per-item hover metadata", () => {
    expect(
      renderReferenceListSurfaceHtml({
        className: "cf-citation-cluster",
        refMode: "bracketed",
        items: [
          { id: "thm:a", innerHtml: "<a>Theorem 1</a>", className: "cf-crossref" },
          { id: "eq:b", text: "Eq. (2)", className: "cf-crossref" },
        ],
        separatorText: "; ",
        sourceAttrs: ' data-source-from="1"',
      }),
    ).toBe(
      '<span class="cf-citation-cluster" data-ref-mode="bracketed" data-source-from="1"><span data-ref-id="thm:a" data-ref-key="thm:a" class="cf-crossref"><a>Theorem 1</a></span>; <span data-ref-id="eq:b" data-ref-key="eq:b" class="cf-crossref">Eq. (2)</span></span>',
    );
  });

  it("applies reference list items to DOM surfaces", () => {
    const container = document.createElement("span");
    appendReferenceListSurfaceDom(container, {
      className: "cf-crossref",
      items: [
        { id: "thm:a", text: "Theorem 1" },
        { id: "thm:b", text: "Theorem 2", className: "cf-crossref-unresolved" },
      ],
      separatorText: "; ",
    });

    expect(container.textContent).toBe("Theorem 1; Theorem 2");
    const items = container.querySelectorAll("span[data-ref-id]");
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute("data-ref-key")).toBe("thm:a");
    expect(items[1].className).toBe("cf-crossref-unresolved");
  });
});
