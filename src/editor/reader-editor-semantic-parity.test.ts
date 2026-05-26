import { StateEffect } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { buildReferenceCatalog } from "../../parse";
import { renderToHtml } from "../../reader";
import { documentContextFacet } from "./document-context";
import { planReferenceRendering } from "./render/reference-render";
import {
  createView,
  store,
} from "./render/reference-render-test-utils";
import { bibDataField } from "./state/bib-data";

const source = [
  "# Intro {#sec:intro}",
  "",
  "::: {.theorem #thm:main title=\"Main\"}",
  "A theorem.",
  ":::",
  "",
  "$$",
  "x = 1",
  "$$ {#eq:one}",
  "",
  "See [@thm:main].",
  "See [@eq:one].",
  "See [@karger2000].",
  "See [@external].",
].join("\n");

function stripTags(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container.textContent ?? "";
}

describe("reader/editor semantic parity fixtures", () => {
  it("normalizes references to the same labels across reader and rich editor", () => {
    const catalog = buildReferenceCatalog(source);
    const refResolver = {
      resolve(key: string) {
        const target = catalog.uniqueTargetById.get(key);
        if (target) return { content: target.displayLabel };
        if (key === "karger2000") return { content: "[1]" };
        if (key === "external") return { content: "External Page" };
        return null;
      },
    };

    const readerRoot = document.createElement("div");
    readerRoot.innerHTML = renderToHtml(source, { refResolver }).html;
    const readerLabels = Array.from(readerRoot.querySelectorAll("[data-ref-key]"))
      .map((el) => el.textContent);

    const view = createView(source, source.length, false);
    view.dispatch({
      effects: StateEffect.appendConfig.of(
        documentContextFacet.of({ refResolver }),
      ),
    });
    const { formatter } = view.state.field(bibDataField);
    const editorLabels = planReferenceRendering(view, store, formatter)
      .filter((item) => item.kind !== "source-mark")
      .map((item) => {
        switch (item.kind) {
          case "crossref":
            return item.resolved.label;
          case "citation":
            return item.rendered;
          case "host-ref":
            return stripTags(item.html);
          case "mixed-cluster":
          case "clustered-crossref":
            return item.raw;
          case "unresolved":
            return item.raw;
        }
      });

    expect(readerLabels).toEqual(editorLabels);
    view.destroy();
  });

  it("keeps the package-owned catalog API pure enough for Node import paths", async () => {
    const parseModule = await import("../../parse");
    expect(parseModule.buildReferenceCatalog(source).targets.length).toBe(3);
  });
});
