import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import type { Tree } from "@lezer/common";
import { describe, expect, it } from "vitest";

import { markdownExtensions } from "../../../core/parser";
import { editorStateTextSource } from "../../state/document-analysis";
import { ensureFullSyntaxTree } from "../../test-utils";
import type { DocumentAnalysis, TextSource } from "../document";
import { stringTextSource } from "../document-model";
import { markdownSemanticsParser } from "../markdown-parser";
import {
  computeAnalyzableFrontier,
  createDocumentAnalysisSnapshot,
  type DocumentAnalysisSnapshot,
  getDocumentAnalysisRevision,
  getDocumentAnalysisSliceRevision,
  updateDocumentAnalysisSnapshot,
} from "./engine";
import { buildSemanticDelta } from "./semantic-delta";
import type { SemanticDelta } from "./types";
import { backoffWindowStart } from "./window-extractor";

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: markdownExtensions })],
  });
}

function fullTree(state: EditorState) {
  return ensureFullSyntaxTree(state);
}

function analyze(state: EditorState) {
  return createDocumentAnalysisSnapshot(editorStateTextSource(state), fullTree(state));
}

/** Parse `text` stopping the block parser near `stopAt`, yielding a partial tree. */
function parsePartial(text: string, stopAt: number): Tree {
  const parse = markdownSemanticsParser.startParse(text);
  parse.stopAt(stopAt);
  let tree: Tree | null = null;
  while (!tree) tree = parse.advance();
  return tree;
}

function treeProgressDelta(): SemanticDelta {
  return {
    rawChangedRanges: [],
    dirtyWindows: [],
    docChanged: false,
    syntaxTreeChanged: true,
    globalInvalidation: false,
    plainInlineTextOnlyChange: false,
    mapOldToNew: (pos) => pos,
    mapNewToOld: (pos) => pos,
  };
}

function pendingDrainDelta(): SemanticDelta {
  return {
    rawChangedRanges: [],
    dirtyWindows: [],
    docChanged: false,
    syntaxTreeChanged: false,
    globalInvalidation: false,
    plainInlineTextOnlyChange: false,
    pendingDrain: true,
    mapOldToNew: (pos) => pos,
    mapNewToOld: (pos) => pos,
  };
}

function expectMatchesRebuild(
  after: DocumentAnalysis,
  rebuilt: DocumentAnalysis,
): void {
  expect(after.headings).toEqual(rebuilt.headings);
  expect(after.footnotes).toEqual(rebuilt.footnotes);
  expect(after.fencedDivs).toEqual(rebuilt.fencedDivs);
  expect(after.equations).toEqual(rebuilt.equations);
  expect(after.mathRegions).toEqual(rebuilt.mathRegions);
  expect(after.references).toEqual(rebuilt.references);
  expect(Array.from(after.referenceIndex.entries())).toEqual(
    Array.from(rebuilt.referenceIndex.entries()),
  );
}

function pendingOf(snapshot: DocumentAnalysisSnapshot) {
  return snapshot.incrementalState.pendingRegions;
}

const FRONTIER_FIXTURE = [
  "# Alpha {#sec:alpha}",
  "",
  "Intro with @alpha and $x$ inline.",
  "",
  "::: {.theorem #thm:cross} Crossing",
  "Body line one with [^note].",
  "STOP-ONE marker inside the div body.",
  "Body line two after the first frontier.",
  ":::",
  "",
  "$$",
  "y = z",
  "$$",
  "",
  "STOP-TWO marker between blocks.",
  "",
  "## Beta {#sec:beta}",
  "",
  "Tail prose with [@thm:cross] and @beta.",
  "",
  "### Gamma {#sec:alpha}",
  "",
  "[^note]: Footnote definition at the end.",
  "",
].join("\n");

describe("computeAnalyzableFrontier", () => {
  it("falls back to the parsed prefix without a probe", () => {
    const state = createState("alpha\n\nbeta\n");
    const tree = fullTree(state);
    expect(computeAnalyzableFrontier(state.doc.length, tree)).toBe(
      Math.min(tree.length, state.doc.length),
    );
    expect(computeAnalyzableFrontier(state.doc.length, tree, () => true)).toBe(
      Math.min(tree.length, state.doc.length),
    );
  });

  it("binary-searches the largest available position in the gap case", () => {
    const state = createState("alpha\n\nbeta\n");
    const tree = fullTree(state);
    expect(computeAnalyzableFrontier(state.doc.length, tree, (to) => to <= 5)).toBe(5);
    expect(computeAnalyzableFrontier(state.doc.length, tree, () => false)).toBe(0);
  });
});

describe("backoffWindowStart", () => {
  const doc = "para one\n\npara two\n\npara three\n";

  function sourceAndTree(): { source: TextSource; tree: Tree } {
    return {
      source: stringTextSource(doc),
      tree: markdownSemanticsParser.parse(doc),
    };
  }

  it("stays local at clean block boundaries instead of resolving to the root", () => {
    const { source, tree } = sourceAndTree();
    const gap = doc.indexOf("\n\npara three") + 1;
    const paraTwoStart = doc.indexOf("para two");
    expect(backoffWindowStart(tree, source, gap)).toBe(paraTwoStart);
  });

  it("backs off to the enclosing block start inside a block", () => {
    const { source, tree } = sourceAndTree();
    const insideTwo = doc.indexOf("two");
    expect(backoffWindowStart(tree, source, insideTwo)).toBe(doc.indexOf("para two"));
  });

  it("backs off to the enclosing fenced div start", () => {
    const divDoc = "intro\n\n::: {.note}\nbody line\nmore body\n:::\n";
    const tree = markdownSemanticsParser.parse(divDoc);
    const source = stringTextSource(divDoc);
    const insideBody = divDoc.indexOf("more body");
    expect(backoffWindowStart(tree, source, insideBody)).toBe(divDoc.indexOf(":::"));
  });
});

describe("tree-progress incremental reconciliation", () => {
  it("returns the previous snapshot by identity when nothing is pending", () => {
    const state = createState("# One\n\nAlpha $x$ and [@ref].\n");
    const before = analyze(state);
    expect(pendingOf(before)).toEqual([]);

    const after = updateDocumentAnalysisSnapshot(
      before,
      editorStateTextSource(state),
      fullTree(state),
      treeProgressDelta(),
    );

    expect(after).toBe(before);
  });

  it("seeds the unparsed tail as pending and reconciles a single tick to rebuild equality", () => {
    const doc = FRONTIER_FIXTURE;
    const source = stringTextSource(doc);
    const partial = parsePartial(doc, doc.indexOf("STOP-ONE"));
    expect(partial.length).toBeLessThan(doc.length);

    const before = createDocumentAnalysisSnapshot(source, partial);
    expect(pendingOf(before)).toEqual([{ from: partial.length, to: doc.length }]);

    const full = markdownSemanticsParser.parse(doc);
    const after = updateDocumentAnalysisSnapshot(before, source, full, treeProgressDelta());
    const rebuilt = createDocumentAnalysisSnapshot(source, full);

    expectMatchesRebuild(after, rebuilt);
    expect(pendingOf(after)).toEqual([]);
  });

  it("streams disjoint slabs across multiple ticks and converges to the rebuild", () => {
    const doc = FRONTIER_FIXTURE;
    const source = stringTextSource(doc);
    const tree1 = parsePartial(doc, doc.indexOf("STOP-ONE"));
    const tree2 = parsePartial(doc, doc.indexOf("STOP-TWO"));
    const full = markdownSemanticsParser.parse(doc);
    expect(tree1.length).toBeLessThan(tree2.length);
    expect(tree2.length).toBeLessThan(full.length);

    const availableUpTo = (tree: Tree) => (to: number) => to <= tree.length;

    let snapshot = createDocumentAnalysisSnapshot(source, tree1);
    snapshot = updateDocumentAnalysisSnapshot(snapshot, source, tree2, treeProgressDelta(), {
      isSyntaxTreeAvailable: availableUpTo(tree2),
    });
    const midPending = pendingOf(snapshot);
    expect(midPending.length).toBeGreaterThan(0);
    // The first slab was consumed: pending progressed past the old frontier.
    expect(midPending[0].from).toBeGreaterThan(tree1.length);

    snapshot = updateDocumentAnalysisSnapshot(snapshot, source, full, treeProgressDelta(), {
      isSyntaxTreeAvailable: availableUpTo(full),
    });
    const rebuilt = createDocumentAnalysisSnapshot(source, full);
    expectMatchesRebuild(snapshot, rebuilt);
    expect(pendingOf(snapshot)).toEqual([]);
  });

  it("keeps analysis identity and revisions on ticks that only cover prose", () => {
    const doc = [
      "# Head {#sec:head}",
      "",
      "Alpha $m$ paragraph.",
      "",
      "Plain tail one without structures.",
      "",
      "Plain tail two without structures.",
      "",
    ].join("\n");
    const source = stringTextSource(doc);
    const partial = parsePartial(doc, doc.indexOf("Plain tail one"));
    expect(partial.length).toBeLessThan(doc.length);

    const before = createDocumentAnalysisSnapshot(source, partial);
    const full = markdownSemanticsParser.parse(doc);
    const after = updateDocumentAnalysisSnapshot(before, source, full, treeProgressDelta());

    expect(after.analysis).toBe(before.analysis);
    expect(getDocumentAnalysisRevision(after)).toBe(getDocumentAnalysisRevision(before));
    expect(pendingOf(after)).toEqual([]);

    const again = updateDocumentAnalysisSnapshot(after, source, full, treeProgressDelta());
    expect(again).toBe(after);
  });

  it("bumps only the affected slice revisions when a tick reveals new structure", () => {
    const doc = [
      "# One",
      "",
      "::: {.note}",
      "body",
      ":::",
      "",
      "Filler paragraph before the frontier.",
      "",
      "## Two",
      "",
      "Tail prose.",
      "",
    ].join("\n");
    const source = stringTextSource(doc);
    const partial = parsePartial(doc, doc.indexOf("Filler"));
    const before = createDocumentAnalysisSnapshot(source, partial);
    expect(before.headings).toHaveLength(1);

    const full = markdownSemanticsParser.parse(doc);
    const after = updateDocumentAnalysisSnapshot(before, source, full, treeProgressDelta());
    const rebuilt = createDocumentAnalysisSnapshot(source, full);
    expectMatchesRebuild(after, rebuilt);
    expect(after.headings).toHaveLength(2);
    expect(after.headings[0]).toBe(before.headings[0]);

    expect(getDocumentAnalysisSliceRevision(after, "headings")).toBe(
      getDocumentAnalysisSliceRevision(before, "headings") + 1,
    );
    for (const slice of [
      "footnotes",
      "fencedDivs",
      "equations",
      "mathRegions",
      "references",
    ] as const) {
      expect(getDocumentAnalysisSliceRevision(after, slice)).toBe(
        getDocumentAnalysisSliceRevision(before, slice),
      );
    }
  });

  it("reconciles windows dropped by the availability probe on a later tick", () => {
    const doc = [
      "# Intro",
      "",
      "## Methods",
      "",
      "## Results",
      "",
    ].join("\n");
    const beforeState = createState(doc);
    const before = analyze(beforeState);
    const from = doc.indexOf("Methods") + "Methods".length;
    const tr = beforeState.update({ changes: { from, insert: "\n" } });

    const dropped = updateDocumentAnalysisSnapshot(
      before,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      buildSemanticDelta(tr),
      { isSyntaxTreeAvailable: () => false },
    );
    expect(pendingOf(dropped).length).toBeGreaterThan(0);
    // Mapped headings survive the drop (pinned behavior).
    expect(dropped.headings.map((heading) => heading.number)).toEqual(["1", "1.1", "1.2"]);

    const reconciled = updateDocumentAnalysisSnapshot(
      dropped,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      treeProgressDelta(),
      { isSyntaxTreeAvailable: () => true },
    );
    const rebuilt = createDocumentAnalysisSnapshot(
      editorStateTextSource(tr.state),
      fullTree(tr.state),
    );
    expectMatchesRebuild(reconciled, rebuilt);
    expect(pendingOf(reconciled)).toEqual([]);
  });

  it("repairs content reinterpreted by a distant structural edit in the same transaction", () => {
    // A fence opener at the top turns everything below into code; the dirty
    // window never reaches the heading, so the reinterpretation guard plus
    // the doc-changed pending consumption must heal it.
    const doc = [
      "intro paragraph",
      "",
      "# Heading One",
      "",
      "tail paragraph",
      "",
    ].join("\n");
    const state = createState(doc);
    const before = analyze(state);
    expect(before.headings).toHaveLength(1);

    const tr = state.update({ changes: { from: 0, insert: "```\n" } });
    const after = updateDocumentAnalysisSnapshot(
      before,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      buildSemanticDelta(tr),
    );
    const rebuilt = createDocumentAnalysisSnapshot(
      editorStateTextSource(tr.state),
      fullTree(tr.state),
    );

    expect(rebuilt.headings).toEqual([]);
    expectMatchesRebuild(after, rebuilt);
  });

  it("drains large guard remainders via pending-drain ticks when no tree progress fires", () => {
    // A fence opener reinterprets a >2x-budget suffix. The incremental
    // reparse completes within the transaction, so no tree-progress tick
    // ever fires; only pending-drain ticks may consume the remainder.
    const head = "# Intro {#sec:intro}\n\nintro para with @sec:intro.\n\n";
    const filler = Array.from({ length: 1200 }, (_, index) =>
      index % 100 === 0
        ? `## Section ${index} {#sec:s${index}}`
        : `Filler prose line number ${index} with @sec:intro.`,
    );
    const doc = head + filler.flatMap((line) => [line, ""]).join("\n");
    expect(doc.length).toBeGreaterThan(16384 * 2);
    const state = createState(doc);
    const before = analyze(state);
    expect(before.headings.length).toBeGreaterThan(1);

    const tr = state.update({ changes: { from: head.length, insert: "```\n" } });
    const delta = { ...buildSemanticDelta(tr), syntaxTreeChanged: true };
    let snapshot = updateDocumentAnalysisSnapshot(
      before,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      delta,
    );
    expect(pendingOf(snapshot).length).toBeGreaterThan(0);

    let ticks = 0;
    while (pendingOf(snapshot).length > 0 && ticks < 32) {
      const next = updateDocumentAnalysisSnapshot(
        snapshot,
        editorStateTextSource(tr.state),
        fullTree(tr.state),
        pendingDrainDelta(),
      );
      // Every drain tick must make progress or the driver would spin.
      expect(next).not.toBe(snapshot);
      snapshot = next;
      ticks += 1;
    }
    expect(pendingOf(snapshot)).toEqual([]);
    expect(ticks).toBeGreaterThanOrEqual(2);

    const rebuilt = createDocumentAnalysisSnapshot(
      editorStateTextSource(tr.state),
      fullTree(tr.state),
    );
    expect(rebuilt.headings.map((heading) => heading.id)).toEqual(["sec:intro"]);
    expectMatchesRebuild(snapshot, rebuilt);
  });

  it("re-extracts the document prefix when an edit closes frontmatter opened earlier", () => {
    // Closing frontmatter reinterprets everything back to position 0 — far
    // past the enclosing paragraph of the change, and invisible to the
    // syntax tree (frontmatter exclusion is textual).
    const doc = [
      "---",
      "title: Draft",
      "",
      "# Inside Heading {#sec:inside}",
      "",
      "alpha paragraph with @sec:inside.",
      "",
      "tail paragraph",
      "",
    ].join("\n");
    const state = createState(doc);
    const before = analyze(state);
    expect(before.headings).toHaveLength(1);

    const insertAt = doc.indexOf("tail paragraph");
    const tr = state.update({ changes: { from: insertAt, insert: "---\n" } });
    let after = updateDocumentAnalysisSnapshot(
      before,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      { ...buildSemanticDelta(tr), syntaxTreeChanged: true },
    );
    for (let tick = 0; tick < 8 && pendingOf(after).length > 0; tick += 1) {
      after = updateDocumentAnalysisSnapshot(
        after,
        editorStateTextSource(tr.state),
        fullTree(tr.state),
        pendingDrainDelta(),
      );
    }

    const rebuilt = createDocumentAnalysisSnapshot(
      editorStateTextSource(tr.state),
      fullTree(tr.state),
    );
    expect(rebuilt.headings).toEqual([]);
    expectMatchesRebuild(after, rebuilt);
  });

  it("skips oversized backoff windows on the doc-changed path and leaves them pending", () => {
    // The pending region's backoff lands at the start of an enclosing
    // >budget fenced div: a keystroke must not extract it; the drain ticks
    // (one oversized atomic window per tick) converge instead.
    const bodyLines = Array.from(
      { length: 700 },
      (_, index) => `div body line ${index} with filler text.`,
    );
    const doc = [
      "# Top {#sec:top}",
      "",
      "intro para",
      "",
      "::: {.note}",
      ...bodyLines,
      ":::",
      "",
      "## Tail {#sec:tail}",
      "",
      "tail para",
      "",
    ].join("\n");
    const divStart = doc.indexOf("::: {.note}");
    const stopAt = doc.indexOf("div body line 650");
    const partial = parsePartial(doc, stopAt);
    expect(partial.length).toBeLessThan(doc.length);
    expect(partial.length - divStart).toBeGreaterThan(16384);

    const source = stringTextSource(doc);
    const before = createDocumentAnalysisSnapshot(source, partial);
    expect(pendingOf(before)).toEqual([{ from: partial.length, to: doc.length }]);

    const state = createState(doc);
    const tr = state.update({
      changes: { from: doc.indexOf("intro para") + 5, insert: "x" },
    });
    const after = updateDocumentAnalysisSnapshot(
      before,
      editorStateTextSource(tr.state),
      fullTree(tr.state),
      { ...buildSemanticDelta(tr), syntaxTreeChanged: true },
    );
    // Budget-honest skip: the whole expanded window exceeds the budget, so
    // nothing was extracted and the mapped region stays pending.
    expect(pendingOf(after)).toEqual([
      { from: partial.length + 1, to: tr.state.doc.length },
    ]);
    expect(after.headings.map((heading) => heading.id)).toEqual(["sec:top"]);

    let snapshot = after;
    let ticks = 0;
    while (pendingOf(snapshot).length > 0 && ticks < 8) {
      snapshot = updateDocumentAnalysisSnapshot(
        snapshot,
        editorStateTextSource(tr.state),
        fullTree(tr.state),
        pendingDrainDelta(),
      );
      ticks += 1;
    }
    expect(pendingOf(snapshot)).toEqual([]);
    const rebuilt = createDocumentAnalysisSnapshot(
      editorStateTextSource(tr.state),
      fullTree(tr.state),
    );
    expectMatchesRebuild(snapshot, rebuilt);
  });

  it("consumes large guard regions across bounded doc-changed steps", () => {
    const lines = Array.from(
      { length: 1500 },
      (_, index) => `Filler prose line number ${index}.`,
    );
    const doc = ["# Top", "", ...lines.flatMap((line) => [line, ""])].join("\n");
    const state = createState(doc);
    const before = analyze(state);

    // A structural edit near the top records the suffix pending; the budget
    // keeps this transaction bounded, so a remainder must stay pending.
    const tr1 = state.update({
      changes: { from: doc.indexOf("Filler"), insert: ": " },
    });
    let snapshot = updateDocumentAnalysisSnapshot(
      before,
      editorStateTextSource(tr1.state),
      fullTree(tr1.state),
      buildSemanticDelta(tr1),
    );
    expect(pendingOf(snapshot).length).toBeGreaterThan(0);

    // Subsequent plain keystrokes keep consuming the remainder.
    let currentState = tr1.state;
    for (let step = 0; step < 8 && pendingOf(snapshot).length > 0; step += 1) {
      const tr = currentState.update({
        changes: { from: currentState.doc.length - 1, insert: "x" },
      });
      snapshot = updateDocumentAnalysisSnapshot(
        snapshot,
        editorStateTextSource(tr.state),
        fullTree(tr.state),
        buildSemanticDelta(tr),
      );
      currentState = tr.state;
    }

    expect(pendingOf(snapshot)).toEqual([]);
    const rebuilt = createDocumentAnalysisSnapshot(
      editorStateTextSource(currentState),
      fullTree(currentState),
    );
    expectMatchesRebuild(snapshot, rebuilt);
  });
});
