import { markdown } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";
import { markdownExtensions } from "../../core/parser";
import { createEditorState } from "../test-utils";
import {
  documentAnalysisField,
  documentAnalysisFromSnapshot,
} from "./document-analysis";

describe("document analysis state contract", () => {
  it("publishes the shared semantic slices needed by renderers and crossrefs", () => {
    const doc = [
      "# Intro {#sec:intro}",
      "",
      "$$x^2$$ {#eq:one}",
      "",
      "See @sec:intro and [@eq:one].",
      "",
      "[^n]: note",
    ].join("\n");
    const state = createEditorState(doc, {
      extensions: [
        markdown({ extensions: markdownExtensions }),
        documentAnalysisField,
      ],
    });
    const snapshot = state.field(documentAnalysisField);

    expect(documentAnalysisFromSnapshot(snapshot)).toBe(snapshot.analysis);
    expect(snapshot.headings).toHaveLength(1);
    expect(snapshot.equationById.get("eq:one")).toMatchObject({ number: 1 });
    expect(snapshot.referenceIndex.get("sec:intro")).toMatchObject({
      targetKind: "heading",
    });
    expect(snapshot.referenceIndex.get("eq:one")).toMatchObject({
      targetKind: "equation",
    });
    expect(snapshot.footnotes.defs.get("n")?.content).toBe("note");
  });
});
