import { describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { markdownExtensions } from "../../core/parser";
import { createEditorState, ensureFullSyntaxTree } from "../../test-utils";
import { fenceAncestorUpgradeExtension } from "./fence-ancestor-upgrade";
import { fenceCountMirrorExtension } from "./fence-count-mirror";
import { fenceOperationAnnotation } from "./fence-protection";

function createState(doc: string) {
  const state = createEditorState(doc, {
    extensions: [
      markdown({ extensions: markdownExtensions }),
      fenceAncestorUpgradeExtension,
      fenceCountMirrorExtension,
    ],
  });
  ensureFullSyntaxTree(state);
  return state;
}

describe("fenceAncestorUpgradeExtension", () => {
  it("upgrades an enclosing :::  to ::::  when a ::: opener is pasted inside it", () => {
    const doc = "::: {.theorem}\nbody\n:::";
    const state = createState(doc);
    // Insert a nested div between "body\n" and ":::". Position 19 = after "body\n".
    const insertPos = "::: {.theorem}\nbody\n".length;
    const tr = state.update({
      changes: { from: insertPos, to: insertPos, insert: "::: {.proof}\ninner\n:::\n" },
    });
    const text = tr.state.doc.toString();
    const lines = text.split("\n");
    expect(lines[0]).toBe(":::: {.theorem}");
    expect(lines[2]).toBe("::: {.proof}");
    expect(lines[4]).toBe(":::");
    expect(lines[5]).toBe("::::");
  });

  it("upgrades two ancestor levels when needed", () => {
    const doc = ":::: {.outer}\n::: {.middle}\nstuff\n:::\n::::";
    const state = createState(doc);
    // Insert a nested ::: opener inside middle, between "stuff\n" and ":::".
    const insertPos = ":::: {.outer}\n::: {.middle}\nstuff\n".length;
    const tr = state.update({
      changes: { from: insertPos, to: insertPos, insert: "::: {.proof}\nx\n:::\n" },
    });
    const lines = tr.state.doc.toString().split("\n");
    expect(lines[0]).toBe("::::: {.outer}");
    expect(lines[1]).toBe(":::: {.middle}");
    expect(lines[3]).toBe("::: {.proof}");
    expect(lines[5]).toBe(":::");
    expect(lines[6]).toBe("::::");
    expect(lines[7]).toBe(":::::");
  });

  it("does not upgrade when the new opener already has fewer colons than parent", () => {
    const doc = "::::: {.outer}\nbody\n:::::";
    const state = createState(doc);
    const insertPos = "::::: {.outer}\nbody\n".length;
    const tr = state.update({
      changes: { from: insertPos, to: insertPos, insert: "::: {.proof}\nx\n:::\n" },
    });
    const lines = tr.state.doc.toString().split("\n");
    expect(lines[0]).toBe("::::: {.outer}"); // unchanged
    expect(lines[2]).toBe("::: {.proof}");
    expect(lines[4]).toBe(":::");
    expect(lines[5]).toBe(":::::");
  });

  it("ignores closer-only lines (`:::` alone) in inserted text", () => {
    const doc = "::: {.theorem}\nbody\n:::";
    const state = createState(doc);
    // Insert a stray closer-shaped line that isn't an opener.
    const insertPos = "::: {.theorem}\nbody\n".length;
    const tr = state.update({
      changes: { from: insertPos, to: insertPos, insert: ":::\n" },
    });
    const lines = tr.state.doc.toString().split("\n");
    // Parent should not be upgraded, since we didn't introduce a new opener.
    expect(lines[0]).toBe("::: {.theorem}");
  });

  it("does not fire when the insertion is outside any fenced div", () => {
    const doc = "Some prose.\n";
    const state = createState(doc);
    const tr = state.update({
      changes: {
        from: doc.length,
        to: doc.length,
        insert: "::: {.theorem}\nx\n:::\n",
      },
    });
    expect(tr.state.doc.toString()).toBe("Some prose.\n::: {.theorem}\nx\n:::\n");
  });

  it("respects fenceOperationAnnotation (no recursion with picker)", () => {
    const doc = "::: {.theorem}\nbody\n:::";
    const state = createState(doc);
    const insertPos = "::: {.theorem}\nbody\n".length;
    const tr = state.update({
      changes: { from: insertPos, to: insertPos, insert: "::: {.proof}\nx\n:::\n" },
      annotations: fenceOperationAnnotation.of(true),
    });
    const lines = tr.state.doc.toString().split("\n");
    // Parent is NOT upgraded because the annotation signals a programmatic
    // edit that already manages its own fences.
    expect(lines[0]).toBe("::: {.theorem}");
  });

  it("handles a class-shorthand opener (no braces)", () => {
    const doc = "::: {.theorem}\nbody\n:::";
    const state = createState(doc);
    const insertPos = "::: {.theorem}\nbody\n".length;
    const tr = state.update({
      changes: { from: insertPos, to: insertPos, insert: ":::proof\nx\n:::\n" },
    });
    const lines = tr.state.doc.toString().split("\n");
    expect(lines[0]).toBe(":::: {.theorem}");
    expect(lines[2]).toBe(":::proof");
    expect(lines[4]).toBe(":::");
    expect(lines[5]).toBe("::::");
  });
});
