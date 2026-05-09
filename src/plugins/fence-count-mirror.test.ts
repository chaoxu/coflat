import { describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { markdownExtensions } from "../parser";
import { createEditorState, ensureFullSyntaxTree } from "../test-utils";
import { fenceCountMirrorExtension } from "./fence-count-mirror";
import { fenceOperationAnnotation } from "./fence-protection";

function createState(doc: string) {
  const state = createEditorState(doc, {
    extensions: [
      markdown({ extensions: markdownExtensions }),
      fenceCountMirrorExtension,
    ],
  });
  ensureFullSyntaxTree(state);
  return state;
}

describe("fenceCountMirrorExtension", () => {
  it("mirrors a typed colon on the opener to the closer", () => {
    const doc = "::: {.theorem}\ncontent\n:::";
    const state = createState(doc);
    // Insert one ':' at end of opener colons (position 3, just after ":::").
    const tr = state.update({ changes: { from: 3, to: 3, insert: ":" } });
    expect(tr.state.doc.toString()).toBe("::::: {.theorem}\ncontent\n::::".replace("::::: ", ":::: "));
    // Sanity: opener and closer both have 4 colons now.
    const text = tr.state.doc.toString();
    expect(text.split("\n")[0]).toBe(":::: {.theorem}");
    expect(text.split("\n")[2]).toBe("::::");
  });

  it("mirrors a typed colon on the closer to the opener", () => {
    const doc = "::: {.theorem}\ncontent\n:::";
    const state = createState(doc);
    // Insert ':' at end of closer colons (closer starts at position 23, length 3).
    const closerEnd = doc.length;
    const tr = state.update({ changes: { from: closerEnd, to: closerEnd, insert: ":" } });
    const text = tr.state.doc.toString();
    expect(text.split("\n")[0]).toBe(":::: {.theorem}");
    expect(text.split("\n")[2]).toBe("::::");
  });

  it("mirrors a deletion on the opener to the closer", () => {
    const doc = ":::: {.theorem}\ncontent\n::::";
    const state = createState(doc);
    // Delete one ':' from opener (positions 0..1).
    const tr = state.update({ changes: { from: 0, to: 1, insert: "" } });
    const text = tr.state.doc.toString();
    expect(text.split("\n")[0]).toBe("::: {.theorem}");
    expect(text.split("\n")[2]).toBe(":::");
  });

  it("does nothing when both fences are edited in the same transaction", () => {
    const doc = "::: {.theorem}\ncontent\n:::";
    const state = createState(doc);
    const closerEnd = doc.length;
    const tr = state.update({
      changes: [
        { from: 3, to: 3, insert: ":" },
        { from: closerEnd, to: closerEnd, insert: ":" },
      ],
    });
    const text = tr.state.doc.toString();
    expect(text.split("\n")[0]).toBe(":::: {.theorem}");
    expect(text.split("\n")[2]).toBe("::::");
  });

  it("does not fire on edits inside the body", () => {
    const doc = "::: {.theorem}\ncontent\n:::";
    const state = createState(doc);
    // Replace 'content' with 'CONTENT'.
    const tr = state.update({ changes: { from: 15, to: 22, insert: "CONTENT" } });
    expect(tr.state.doc.toString()).toBe("::: {.theorem}\nCONTENT\n:::");
  });

  it("respects fenceOperationAnnotation (no recursion)", () => {
    const doc = "::: {.theorem}\ncontent\n:::";
    const state = createState(doc);
    const tr = state.update({
      changes: { from: 3, to: 3, insert: ":" },
      annotations: fenceOperationAnnotation.of(true),
    });
    // Annotated transactions are passed through unchanged.
    expect(tr.state.doc.toString()).toBe(":::: {.theorem}\ncontent\n:::");
  });

  it("skips unclosed divs", () => {
    const doc = "::: {.theorem}\ncontent\n";
    const state = createState(doc);
    const tr = state.update({ changes: { from: 3, to: 3, insert: ":" } });
    // No closer to mirror to — only the opener changes.
    expect(tr.state.doc.toString()).toBe(":::: {.theorem}\ncontent\n");
  });

  it("mirrors only the inner div when its own fence is edited", () => {
    const doc = ":::: {.theorem}\n::: {.proof}\nbody\n:::\n::::";
    const state = createState(doc);
    // Inner opener starts at 16 ("::: {.proof}"), append a colon at position 19.
    const innerOpenerEnd = 16 + 3;
    const tr = state.update({ changes: { from: innerOpenerEnd, to: innerOpenerEnd, insert: ":" } });
    const lines = tr.state.doc.toString().split("\n");
    expect(lines[0]).toBe(":::: {.theorem}");      // outer opener untouched
    expect(lines[1]).toBe(":::: {.proof}");        // inner opener: edited
    expect(lines[3]).toBe("::::");                 // inner closer: mirrored
    expect(lines[4]).toBe("::::");                 // outer closer untouched
  });
});
