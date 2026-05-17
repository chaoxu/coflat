import { describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { markdownExtensions } from "../../core/parser";
import { documentSemanticsField } from "../state/document-analysis";
import { createEditorState } from "../../test-utils";
import { openerTrailingProtection } from "./opener-trailing-protection";

function makeState(doc: string) {
  return createEditorState(doc, {
    extensions: [
      markdown({ extensions: markdownExtensions }),
      documentSemanticsField,
      openerTrailingProtection,
    ],
  });
}

describe("openerTrailingProtection", () => {
  it("blocks insertion of non-whitespace text after the attribute block on an opener line", () => {
    const doc = '::: {.theorem title="A"}\nbody\n:::\n';
    const state = makeState(doc);
    // Opener line ends at position 24 (right after `}`), which is openFenceTo.
    // Inserting "RR" at position 24 would corrupt the opener.
    const next = state.update({
      changes: { from: 24, to: 24, insert: "RR" },
    }).state;
    expect(next.doc.toString()).toBe(doc);
  });

  it("allows newline insertion at the trailing position (line splitting)", () => {
    const doc = '::: {.theorem title="A"}\nbody\n:::\n';
    const state = makeState(doc);
    const next = state.update({
      changes: { from: 24, to: 24, insert: "\n" },
    }).state;
    expect(next.doc.toString()).toBe('::: {.theorem title="A"}\n\nbody\n:::\n');
  });

  it("allows whitespace-only insertions at the trailing position", () => {
    const doc = '::: {.theorem title="A"}\nbody\n:::\n';
    const state = makeState(doc);
    const next = state.update({
      changes: { from: 24, to: 24, insert: "   " },
    }).state;
    expect(next.doc.toString()).toBe('::: {.theorem title="A"}   \nbody\n:::\n');
  });

  it("does not block edits inside the attribute block (title text changes)", () => {
    const doc = '::: {.theorem title="A"}\nbody\n:::\n';
    const state = makeState(doc);
    // Replace "A" with "BBB" inside the title quotes.
    const titleAFrom = doc.indexOf('"A"') + 1;
    const next = state.update({
      changes: { from: titleAFrom, to: titleAFrom + 1, insert: "BBB" },
    }).state;
    expect(next.doc.toString()).toBe('::: {.theorem title="BBB"}\nbody\n:::\n');
  });

  it("does not block body or closer edits", () => {
    const doc = '::: {.theorem title="A"}\nbody\n:::\n';
    const state = makeState(doc);
    const next = state.update({
      changes: { from: 29, to: 29, insert: " more" },
    }).state;
    expect(next.doc.toString()).toBe('::: {.theorem title="A"}\nbody more\n:::\n');
  });
});
