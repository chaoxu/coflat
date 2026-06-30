import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { CSS } from "../../core/constants/css-classes";
import { CslProcessor } from "../citations/csl-processor";
import { bibDataEffect } from "../state/bib-data";
import { makeBibStore } from "../test-utils";
import { collectReferenceRanges } from "./reference-render";
import {
  createView,
  expectPresent,
  revealReferenceAt,
  store,
  widgetClass,
} from "./reference-render-test-utils";

describe("collectReferenceRanges edge-cases", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  describe("negative / edge-case", () => {
    it("returns empty array for plain text with no @ characters", () => {
      view = createView("No references here. Just text.", 0);
      expect(collectReferenceRanges(view, store)).toHaveLength(0);
    });

    it("returns empty array for empty store and unknown id", () => {
      const emptyStore = makeBibStore([]);
      view = createView("See [@totally-unknown].", 0);
      const ranges = collectReferenceRanges(view, emptyStore);
      // Unknown id with empty store → UnresolvedRefWidget
      const ref = ranges.find(
        (r) => view.state.sliceDoc(r.from, r.to) === "[@totally-unknown]",
      );
      expectPresent(ref, "reference range");
    expect(widgetClass(ref)).toBe("UnresolvedRefWidget");
    });

    it("applies source mark when focused cursor reveal starts at the token boundary", () => {
      const doc = "See [@karger2000].";
      const refStart = doc.indexOf("[@karger2000]");
      view = createView(doc, doc.length);
      revealReferenceAt(view, refStart);
      const ranges = collectReferenceRanges(view, store);
      const ref = ranges.find((r) => r.from === refStart);
      expectPresent(ref, "reference range");
      expect(ref?.value.spec.class).toBe(CSS.referenceSource);
    });

    it("handles document with only blank lines", () => {
      view = createView("\n\n\n", 0);
      expect(collectReferenceRanges(view, store)).toHaveLength(0);
    });
  });

  it("keeps bibliography ids on the default unresolved crossref route when only the processor is cleared", () => {
    const doc = "See [@karger2000].";
    view = createView(doc, doc.length);

    const before = collectReferenceRanges(view, store);
    const refBefore = before.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@karger2000]",
    );
    expectPresent(refBefore, "reference range before clearing processor");
    expect(widgetClass(refBefore)).toBe("UnresolvedRefWidget");

    view.dispatch({
      effects: bibDataEffect.of({
        store,
        formatter: CslProcessor.empty(),
      }),
    });

    const after = collectReferenceRanges(view, store);
    const refAfter = after.find(
      (r) => view.state.sliceDoc(r.from, r.to) === "[@karger2000]",
    );
    expectPresent(refAfter, "reference range after clearing processor");
    expect(widgetClass(refAfter)).toBe("UnresolvedRefWidget");
  });
});
