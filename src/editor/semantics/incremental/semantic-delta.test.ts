import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { strikethroughExtension } from "../../../core/parser";
import {
  buildSemanticDelta,
  semanticGlobalInvalidationAnnotation,
  semanticPendingDrainAnnotation,
} from "./semantic-delta";

function createMarkdownState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown()],
  });
}

describe("buildSemanticDelta", () => {
  it("captures exact old and new coordinates for a single insert", () => {
    const state = createMarkdownState("abcd");
    const tr = state.update({
      changes: { from: 2, insert: "XY" },
    });

    const delta = buildSemanticDelta(tr);

    expect(delta.rawChangedRanges).toEqual([
      { fromOld: 2, toOld: 2, fromNew: 2, toNew: 4 },
    ]);
    expect(delta.dirtyWindows).toEqual([
      { fromOld: 2, toOld: 2, fromNew: 2, toNew: 4 },
    ]);
    expect(delta.mapOldToNew(3)).toBe(5);
    expect(delta.mapNewToOld(5)).toBe(3);
    expect(delta.plainInlineTextOnlyChange).toBe(true);
  });

  it("preserves CM6 assoc behavior at the single-insert boundary", () => {
    const state = createMarkdownState("abcd");
    const tr = state.update({
      changes: { from: 2, insert: "XY" },
    });

    const delta = buildSemanticDelta(tr);

    expect(delta.mapOldToNew(2, -1)).toBe(2);
    expect(delta.mapOldToNew(2, 1)).toBe(4);
    expect(delta.mapNewToOld(2, -1)).toBe(2);
    expect(delta.mapNewToOld(4, 1)).toBe(2);
    expect(delta.mapNewToOld(3)).toBe(2);
  });

  it("captures exact old and new coordinates for a delete", () => {
    const state = createMarkdownState("abcdef");
    const tr = state.update({
      changes: { from: 1, to: 4 },
    });

    const delta = buildSemanticDelta(tr);

    expect(delta.rawChangedRanges).toEqual([
      { fromOld: 1, toOld: 4, fromNew: 1, toNew: 1 },
    ]);
    expect(delta.plainInlineTextOnlyChange).toBe(true);
  });

  it("preserves multiple changed ranges before dirty-window coalescing", () => {
    const state = createMarkdownState("a".repeat(96));
    const tr = state.update({
      changes: [
        { from: 1, insert: "X" },
        { from: 70, to: 72, insert: "YZ" },
      ],
    });

    const delta = buildSemanticDelta(tr);

    expect(delta.rawChangedRanges).toEqual([
      { fromOld: 1, toOld: 1, fromNew: 1, toNew: 2 },
      { fromOld: 70, toOld: 72, fromNew: 71, toNew: 73 },
    ]);
    expect(delta.dirtyWindows).toEqual(delta.rawChangedRanges);
  });

  it("marks syntax-tree-only invalidation on parser reconfigure", () => {
    const language = new Compartment();
    const state = EditorState.create({
      doc: "~~strike~~",
      extensions: [language.of(markdown())],
    });
    const tr = state.update({
      effects: language.reconfigure(markdown({ extensions: [strikethroughExtension] })),
    });

    const delta = buildSemanticDelta(tr);

    expect(delta.docChanged).toBe(false);
    expect(delta.rawChangedRanges).toEqual([]);
    expect(delta.dirtyWindows).toEqual([]);
    expect(delta.syntaxTreeChanged).toBe(true);
    expect(delta.plainInlineTextOnlyChange).toBe(false);
  });

  it("does not mark markdown-trigger inserts as plain inline text only", () => {
    const state = createMarkdownState("alpha");
    const tr = state.update({
      changes: { from: 0, insert: "@" },
    });

    expect(buildSemanticDelta(tr).plainInlineTextOnlyChange).toBe(false);
  });

  it("does not mark newline inserts as plain inline text only", () => {
    const state = createMarkdownState("alpha");
    const tr = state.update({
      changes: { from: state.doc.length, insert: "\n" },
    });

    expect(buildSemanticDelta(tr).plainInlineTextOnlyChange).toBe(false);
  });

  it("does not mark a '-' that completes a '---' delimiter line as plain inline", () => {
    const doc = "alpha paragraph\n\n--\nbeta paragraph";
    const state = createMarkdownState(doc);
    const tr = state.update({
      changes: { from: doc.indexOf("--") + 2, insert: "-" },
    });

    expect(buildSemanticDelta(tr).plainInlineTextOnlyChange).toBe(false);
  });

  it("does not mark a '_' that completes a '___' thematic break as plain inline", () => {
    const doc = "alpha paragraph\n\n__\nbeta paragraph";
    const state = createMarkdownState(doc);
    const tr = state.update({
      changes: { from: doc.indexOf("__") + 2, insert: "_" },
    });

    expect(buildSemanticDelta(tr).plainInlineTextOnlyChange).toBe(false);
  });

  it("does not mark a deletion that reveals a delimiter line as plain inline", () => {
    // Removing the safe `x` turns the line into a setext underline: the
    // removed text alone looks plain, only the resulting line shape gives
    // the reinterpretation away.
    const doc = "title text\nx---";
    const state = createMarkdownState(doc);
    const from = doc.indexOf("x---");
    const tr = state.update({ changes: { from, to: from + 1 } });

    expect(buildSemanticDelta(tr).plainInlineTextOnlyChange).toBe(false);
  });

  it("does not mark an insertion that destroys a delimiter line as plain inline", () => {
    const doc = "alpha paragraph\n\n---\n\nbeta paragraph";
    const state = createMarkdownState(doc);
    const tr = state.update({
      changes: { from: doc.indexOf("---"), insert: "x" },
    });

    expect(buildSemanticDelta(tr).plainInlineTextOnlyChange).toBe(false);
  });

  it("keeps a hyphen typed inside prose on the plain-inline fast path", () => {
    const doc = "a well known issue in prose";
    const state = createMarkdownState(doc);
    const from = doc.indexOf(" known");
    const tr = state.update({
      changes: { from, to: from + 1, insert: "-" },
    });

    expect(buildSemanticDelta(tr).plainInlineTextOnlyChange).toBe(true);
  });

  it("keeps a hyphen typed at the end of a prose line on the fast path", () => {
    const doc = "first line re\nsecond line";
    const state = createMarkdownState(doc);
    const tr = state.update({
      changes: { from: doc.indexOf("re\n") + 2, insert: "-" },
    });

    expect(buildSemanticDelta(tr).plainInlineTextOnlyChange).toBe(true);
  });

  it("marks explicit global invalidation annotations", () => {
    const state = createMarkdownState("body");
    const tr = state.update({
      annotations: semanticGlobalInvalidationAnnotation.of(true),
    });

    const delta = buildSemanticDelta(tr);

    expect(delta.docChanged).toBe(false);
    expect(delta.globalInvalidation).toBe(true);
    expect(delta.rawChangedRanges).toEqual([]);
  });

  it("marks pending-drain annotated empty transactions", () => {
    const state = createMarkdownState("body");
    const tr = state.update({
      annotations: semanticPendingDrainAnnotation.of(true),
    });

    const delta = buildSemanticDelta(tr);

    expect(delta.docChanged).toBe(false);
    expect(delta.pendingDrain).toBe(true);
    expect(buildSemanticDelta(state.update({})).pendingDrain).toBe(false);
  });
});
