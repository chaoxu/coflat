import { describe, expect, it } from "vitest";
import { CitationWidget, HostRefWidget } from "./citation-widget";
import {
  ClusteredCrossrefWidget,
  CrossrefWidget,
  MixedClusterWidget,
  UnresolvedRefWidget,
} from "./crossref-render";
import {
  findReferenceWidgetContainer,
  isReferenceWidgetTarget,
  REFERENCE_WIDGET_SELECTOR,
} from "./reference-widget";

describe("ReferenceWidget shared DOM contract", () => {
  it("marks single-node reference widgets as shared reference roots", () => {
    const widgets = [
      new CitationWidget("(Karger, 2000)", ["karger2000"]).toDOM(),
      new CrossrefWidget(
        { kind: "block", label: "Theorem 1", number: 1 },
        "[@thm:main]",
      ).toDOM(),
      new UnresolvedRefWidget("[@missing]").toDOM(),
    ];

    for (const el of widgets) {
      expect(el.matches(REFERENCE_WIDGET_SELECTOR)).toBe(true);
      expect(el.dataset.referenceWidget).toBe("true");
      expect(isReferenceWidgetTarget(el)).toBe(true);
    }
  });

  it("finds the shared container from a nested cluster item descendant", () => {
    const widgetEl = new ClusteredCrossrefWidget(
      [
        { id: "thm:a", text: "Theorem 1" },
        { id: "thm:b", text: "Theorem 2" },
      ],
      "[@thm:a; @thm:b]",
    ).toDOM();
    const firstItem = widgetEl.querySelector<HTMLElement>("span[data-ref-id]");
    expect(firstItem).not.toBeNull();
    if (!firstItem) {
      throw new Error("expected clustered crossref item");
    }

    const nested = document.createElement("strong");
    nested.textContent = firstItem.textContent ?? "";
    firstItem.replaceChildren(nested);

    expect(findReferenceWidgetContainer(nested)).toBe(widgetEl);
    expect(isReferenceWidgetTarget(nested)).toBe(true);
  });

  it("marks mixed clusters for shared selector consumers", () => {
    const widgetEl = new MixedClusterWidget(
      [
        { kind: "crossref", id: "eq:alpha", text: "Eq. (1)" },
        { kind: "citation", id: "karger2000", text: "Karger, 2000" },
      ],
      "[@eq:alpha; @karger2000]",
    ).toDOM();

    expect(widgetEl.matches(REFERENCE_WIDGET_SELECTOR)).toBe(true);
    expect(isReferenceWidgetTarget(widgetEl)).toBe(true);
  });

  it("routes host references through shared reference and link surfaces", () => {
    const widgetEl = new HostRefWidget(
      "<em>Remote theorem</em>",
      "external:thm",
      "bracketed",
      "/owner/repo/src/branch/main/theory.md#external%3Athm",
      "host-ref cf-crossref",
      true,
    ).toDOM();

    expect(widgetEl.matches(REFERENCE_WIDGET_SELECTOR)).toBe(true);
    expect(widgetEl.className).toBe("cf-crossref host-ref");
    expect(widgetEl.dataset.refKey).toBe("external:thm");
    expect(widgetEl.dataset.refMode).toBe("bracketed");
    expect(widgetEl.dataset.refResolver).toBe("1");

    const anchor = widgetEl.querySelector("a");
    expect(anchor?.className).toBe("cf-doc-link cf-link-rendered");
    expect(anchor?.getAttribute("href")).toBe(
      "/owner/repo/src/branch/main/theory.md#external%3Athm",
    );
    expect(anchor?.getAttribute("data-cf-link-layout")).toBe("atomic");
    expect(anchor?.innerHTML).toBe("<em>Remote theorem</em>");
  });
});
