import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { markdownExtensions } from "../../core/parser";
import { documentAnalysisField } from "./document-analysis";
import { pendingAnalysisDrainPlugin } from "./pending-analysis-drain";

function createView(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        markdown({ extensions: markdownExtensions }),
        documentAnalysisField,
        pendingAnalysisDrainPlugin,
      ],
    }),
    parent,
  });
}

function pendingRegions(view: EditorView) {
  return view.state.field(documentAnalysisField).incrementalState.pendingRegions;
}

describe("pending analysis drain plugin", () => {
  it("drains pending regions the doc-changed budget leaves behind", () => {
    const head = "# Intro {#sec:intro}\n\nintro para.\n\n";
    const tail = Array.from({ length: 1200 }, (_, index) =>
      index % 100 === 0
        ? `## Section ${index} {#sec:s${index}}`
        : `Filler prose line number ${index}.`,
    ).flatMap((line) => [line, ""]).join("\n");
    const doc = head + tail;
    expect(doc.length).toBeGreaterThan(16384 * 2);

    const view = createView(doc);
    try {
      expect(
        view.state.field(documentAnalysisField).headings.length,
      ).toBeGreaterThan(1);

      // Fence opener: the whole suffix is reinterpreted as code, recorded
      // pending, and only partially reconciled by the doc-changed budget.
      view.dispatch({ changes: { from: head.length, insert: "```\n" } });
      expect(pendingRegions(view).length).toBeGreaterThan(0);

      const plugin = view.plugin(pendingAnalysisDrainPlugin);
      expect(plugin).not.toBeNull();
      // Drive the idle callback synchronously; jsdom has no real idle time.
      let steps = 0;
      while (pendingRegions(view).length > 0 && steps < 64) {
        plugin?.drainStep();
        steps += 1;
      }

      expect(pendingRegions(view)).toEqual([]);
      expect(
        view.state
          .field(documentAnalysisField)
          .headings.map((heading) => heading.id),
      ).toEqual(["sec:intro"]);
    } finally {
      view.destroy();
    }
  });

  it("does nothing when analysis has no pending regions", () => {
    const view = createView("# Title\n\nBody.\n");
    try {
      expect(pendingRegions(view)).toEqual([]);
      const plugin = view.plugin(pendingAnalysisDrainPlugin);
      const before = view.state.field(documentAnalysisField);
      plugin?.drainStep();
      expect(view.state.field(documentAnalysisField)).toBe(before);
    } finally {
      view.destroy();
    }
  });
});
