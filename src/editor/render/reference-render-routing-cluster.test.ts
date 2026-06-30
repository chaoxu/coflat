import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { CSS } from "../../core/constants/css-classes";
import { renderPreviewBlockContentToDom } from "./preview-block-renderer";
import { collectReferenceRanges } from "./reference-render";
import {
  createView,
  expectPresent,
  store,
  widgetClass,
} from "./reference-render-test-utils";


describe("collectReferenceRanges (clusters)", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("routes clustered equation crossrefs to ClusteredCrossrefWidget", () => {
    const doc = [
      "$$a^2$$ {#eq:alpha}",
      "",
      "$$b^2$$ {#eq:beta}",
      "",
      "See [@eq:alpha; @eq:beta].",
    ].join("\n");
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@eq:alpha; @eq:beta]",
    );
    expectPresent(ref, "reference range");
    if (!ref) return;
    expect(widgetClass(ref)).toBe("ClusteredCrossrefWidget");
  });

  // Regression (#397): clustered crossrefs must render per-item spans
  // with data-ref-id attributes, not a flat text join.
  it("renders clustered equation crossrefs with per-item spans", () => {
    const doc = [
      "$$a^2$$ {#eq:alpha}",
      "",
      "$$b^2$$ {#eq:beta}",
      "",
      "See [@eq:alpha; @eq:beta].",
    ].join("\n");
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@eq:alpha; @eq:beta]",
    );
    expectPresent(ref, "reference range");
    if (!ref) return;
    const widget = ref.value.spec.widget;
    expect(widget).toBeDefined();
    if (!widget) return;
    const el = widget.toDOM() as HTMLElement;
    expect(el.textContent).toBe("Eq. (1); Eq. (2)");

    // Per-item spans with data-ref-id
    const spans = el.querySelectorAll("span[data-ref-id]");
    expect(spans.length).toBe(2);
    expect(spans[0].getAttribute("data-ref-id")).toBe("eq:alpha");
    expect(spans[1].getAttribute("data-ref-id")).toBe("eq:beta");
  });

  // Regression (#397): clustered block crossrefs must have per-item spans
  it("routes clustered block crossrefs to ClusteredCrossrefWidget with per-item spans", () => {
    const doc = [
      "::: {.theorem #thm-a}",
      "A.",
      ":::",
      "",
      "::: {.theorem #thm-b}",
      "B.",
      ":::",
      "",
      "See [@thm-a; @thm-b].",
    ].join("\n");
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@thm-a; @thm-b]",
    );
    expectPresent(ref, "reference range");
    if (!ref) return;
    expect(widgetClass(ref)).toBe("ClusteredCrossrefWidget");
    const widget = ref.value.spec.widget;
    expect(widget).toBeDefined();
    if (!widget) return;
    const el = widget.toDOM() as HTMLElement;
    expect(el.textContent).toBe("Theorem 1; Theorem 2");

    // Per-item spans with data-ref-id
    const spans = el.querySelectorAll("span[data-ref-id]");
    expect(spans.length).toBe(2);
    expect(spans[0].getAttribute("data-ref-id")).toBe("thm-a");
    expect(spans[1].getAttribute("data-ref-id")).toBe("thm-b");
  });

  it("routes clustered unknown crossrefs to ClusteredCrossrefWidget", () => {
    const doc = "See [@unknown-a; @unknown-b].";
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@unknown-a; @unknown-b]",
    );
    expectPresent(ref, "reference range");
    if (!ref) return;
    expect(widgetClass(ref)).toBe("ClusteredCrossrefWidget");
  });

  it("keeps partially resolved crossref clusters rendered in place", () => {
    const doc = [
      "::: {.theorem #thm-a}",
      "A.",
      ":::",
      "",
      "See [@thm-a; @missing].",
    ].join("\n");
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@thm-a; @missing]",
    );
    expectPresent(ref, "reference range");
    if (!ref) return;
    expect(widgetClass(ref)).toBe("ClusteredCrossrefWidget");
    const widget = ref.value.spec.widget;
    expect(widget).toBeDefined();
    if (!widget) return;
    const el = widget.toDOM() as HTMLElement;
    const spans = el.querySelectorAll("span[data-ref-id]");
    expect(spans.length).toBe(2);
    expect(spans[0].textContent).toBe("Theorem 1");
    expect(spans[1].textContent).toBe("missing");
    expect(spans[1].className).toBe(CSS.crossrefUnresolved);
  });

  it("routes resolved and unresolved ids to ClusteredCrossrefWidget", () => {
    const doc = [
      "$$a^2$$ {#eq:alpha}",
      "",
      "See [@eq:alpha; @karger2000].",
    ].join("\n");
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@eq:alpha; @karger2000]",
    );
    expectPresent(ref, "reference range");
    if (!ref) return;
    expect(widgetClass(ref)).toBe("ClusteredCrossrefWidget");
  });

  it("keeps formatter-backed state on the default crossref route", () => {
    const doc = "See [@karger2000] and [@stein2001].";
    view = createView(doc, doc.length);

    collectReferenceRanges(view, store);

    const preview = document.createElement("div");
    renderPreviewBlockContentToDom(preview, "Preview [@karger2000].");

    const ranges = collectReferenceRanges(view, store);
    const steinRange = ranges.find(
      (range) => view.state.sliceDoc(range.from, range.to) === "[@stein2001]",
    );
    expect(steinRange).toBeDefined();
    if (!steinRange) return;

    const widget = steinRange.value.spec.widget;
    expect(widget).toBeDefined();
    if (!widget) return;

    expect(widgetClass(steinRange)).toBe("UnresolvedRefWidget");
    expect((widget.toDOM() as HTMLElement).textContent).toBe("[@stein2001]");
    expect(preview.querySelector(`.${CSS.crossref}`)?.textContent)
      .toBe("[@karger2000]");
  });

  it("renders preview heading crossrefs as first-class crossrefs", () => {
    const preview = document.createElement("div");
    renderPreviewBlockContentToDom(
      preview,
      [
        "# Intro",
        "",
        "## Result Section {#sec:result}",
        "",
        "See [@sec:result].",
      ].join("\n"),
    );

    const crossref = preview.querySelector(`.${CSS.crossref}`);
    expect(crossref?.textContent).toBe("Section 1.1");
  });

  it("renders crossref clusters with per-item spans and data-ref-id", () => {
    const doc = [
      "$$a^2$$ {#eq:alpha}",
      "",
      "See [@eq:alpha; @karger2000].",
    ].join("\n");
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@eq:alpha; @karger2000]",
    );
    expectPresent(ref, "reference range");
    if (!ref) return;
    const widget = ref.value.spec.widget;
    expect(widget).toBeDefined();
    if (!widget) return;
    const el = widget.toDOM() as HTMLElement;
    expect(el.textContent).toContain("Eq. (1)");
    expect(el.textContent).toBe("Eq. (1); karger2000");
    expect(el.className).toBe(CSS.citationCluster);

    const spans = el.querySelectorAll("span[data-ref-id]");
    expect(spans.length).toBe(2);
    expect(spans[0].getAttribute("data-ref-id")).toBe("eq:alpha");
    expect(spans[0].className).toBe(CSS.crossref);
    expect(spans[1].getAttribute("data-ref-id")).toBe("karger2000");
    expect(spans[1].className).toBe(CSS.crossrefUnresolved);
  });

  it("renders block crossref plus unresolved id as a clustered crossref", () => {
    const doc = [
      "::: {.theorem #thm-main}",
      "Statement.",
      ":::",
      "",
      "See [@thm-main; @karger2000].",
    ].join("\n");
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@thm-main; @karger2000]",
    );
    expectPresent(ref, "reference range");
    if (!ref) return;
    expect(widgetClass(ref)).toBe("ClusteredCrossrefWidget");
    const widget = ref.value.spec.widget;
    expect(widget).toBeDefined();
    if (!widget) return;
    const el = widget.toDOM() as HTMLElement;
    expect(el.textContent).toContain("Theorem 1");
  });

  it("keeps CM6 widgets and block previews on the same presentation route", () => {
    const doc = [
      "$$a^2$$ {#eq:alpha}",
      "",
      "See [@eq:alpha; @karger2000].",
    ].join("\n");
    view = createView(doc, doc.length);

    const ref = collectReferenceRanges(view, store).find(
      (range) => view.state.sliceDoc(range.from, range.to) === "[@eq:alpha; @karger2000]",
    );
    expectPresent(ref, "reference range");
    const widget = ref.value.spec.widget;
    expect(widget).toBeDefined();
    if (!widget) return;
    const widgetText = (widget.toDOM() as HTMLElement).textContent;

    const preview = document.createElement("div");
    renderPreviewBlockContentToDom(preview, doc);
    const previewReference = preview.querySelector<HTMLElement>("[data-reference-widget]");

    expect(previewReference?.textContent).toBe(widgetText);
    expect(previewReference?.dataset.refMode).toBe("bracketed");
    expect(previewReference?.querySelectorAll("[data-ref-id]")).toHaveLength(2);
  });

  it("pure unresolved cluster routes to ClusteredCrossrefWidget", () => {
    const doc = "See [@karger2000; @stein2001].";
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@karger2000; @stein2001]",
    );
    expectPresent(ref, "reference range");
    if (!ref) return;
    expect(widgetClass(ref)).toBe("ClusteredCrossrefWidget");
  });

  it("pure crossref cluster still routes to ClusteredCrossrefWidget", () => {
    const doc = [
      "$$a^2$$ {#eq:alpha}",
      "",
      "$$b^2$$ {#eq:beta}",
      "",
      "See [@eq:alpha; @eq:beta].",
    ].join("\n");
    view = createView(doc, doc.length);
    const ranges = collectReferenceRanges(view, store);

    const ref = ranges.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@eq:alpha; @eq:beta]",
    );
    expectPresent(ref, "reference range");
    if (!ref) return;
    // Should be ClusteredCrossrefWidget, not MixedClusterWidget
    expect(widgetClass(ref)).toBe("ClusteredCrossrefWidget");
  });
});
