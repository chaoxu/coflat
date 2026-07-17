import { moveLineUp } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import type { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { moveListItemUp } from "./list-outliner-commands";
import { listOutlinerExtension } from "./list-outliner";
import {
  listRenumberExtension,
  type RenumberRange,
  renumberListsInRanges,
  withListRenumber,
} from "./list-renumber";
import {
  createEditorState,
  createTestView,
  ensureFullSyntaxTree,
} from "./test-utils";

function parsedState(doc: string): EditorState {
  const state = createEditorState(doc, { extensions: [markdown()] });
  ensureFullSyntaxTree(state);
  return state;
}

function wholeDoc(state: EditorState): RenumberRange[] {
  return [{ from: 0, to: state.doc.length }];
}

function applyRenumber(state: EditorState): string {
  const changes = renumberListsInRanges(state, wholeDoc(state));
  return state.update({ changes }).state.doc.toString();
}

describe("renumberListsInRanges", () => {
  it("renumbers a 2. that sits above a 1. after a swap", () => {
    const state = parsedState("2. b\n1. a");
    expect(applyRenumber(state)).toBe("1. b\n2. a");
  });

  it("preserves the ) delimiter while renumbering", () => {
    const state = parsedState("2) b\n1) a");
    expect(applyRenumber(state)).toBe("1) b\n2) a");
  });

  it("restarts numbering on an indented fresh sublevel", () => {
    const state = parsedState("1. a\n   2. b\n3. c");
    expect(applyRenumber(state)).toBe("1. a\n   1. b\n2. c");
  });

  it("renumbers a nested ordered level without touching the bullet level", () => {
    const state = parsedState("- x\n  1. a\n  1. c\n- y");
    expect(applyRenumber(state)).toBe("- x\n  1. a\n  2. c\n- y");
  });

  it("normalizes split bullet markers on the same level", () => {
    const state = parsedState("1. p\n   - a\n   * b");
    expect(applyRenumber(state)).toBe("1. p\n   - a\n   - b");
  });

  it("merges delimiter-split ordered fragments on the same level", () => {
    const state = parsedState("1. p\n   1. a\n   1) b");
    expect(applyRenumber(state)).toBe("1. p\n   1. a\n   2. b");
  });

  it("returns no changes outside lists", () => {
    const state = parsedState("alpha\n\nbeta");
    expect(renumberListsInRanges(state, wholeDoc(state))).toEqual([]);
  });

  it("is idempotent: a renumbered document needs no further changes", () => {
    const state = parsedState("2. b\n1. a\n   * n\n   - m");
    const changes = renumberListsInRanges(state, wholeDoc(state));
    expect(changes.length).toBeGreaterThan(0);

    const next = state.update({ changes }).state;
    ensureFullSyntaxTree(next);
    expect(renumberListsInRanges(next, wholeDoc(next))).toEqual([]);
  });
});

describe("listRenumberExtension", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("appends fix-ups to a move.line transaction in the same dispatch", () => {
    const doc = "1. a\n2. b";
    let docUpdates = 0;
    view = createTestView(doc, {
      cursorPos: doc.length,
      extensions: [
        markdown(),
        listRenumberExtension,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) docUpdates++;
        }),
      ],
    });
    ensureFullSyntaxTree(view.state);

    expect(moveLineUp(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("1. b\n2. a");
    expect(docUpdates).toBe(1);
  });

  it("leaves untagged edits alone even when numbering is wrong", () => {
    const doc = "1. a\n2. b";
    view = createTestView(doc, {
      cursorPos: 0,
      extensions: [markdown(), listRenumberExtension],
    });
    ensureFullSyntaxTree(view.state);

    view.dispatch({ changes: { from: 0, to: 1, insert: "5" } });
    expect(view.state.doc.toString()).toBe("5. a\n2. b");
  });

  it("ignores move.line transactions outside lists", () => {
    const doc = "alpha\nbeta";
    view = createTestView(doc, {
      cursorPos: doc.length,
      extensions: [markdown(), listRenumberExtension],
    });
    ensureFullSyntaxTree(view.state);

    expect(moveLineUp(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("beta\nalpha");
  });
});

describe("withListRenumber", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("renumbers after a wrapped move-item command", () => {
    const doc = "1. a\n2. b";
    view = createTestView(doc, {
      cursorPos: doc.length,
      extensions: [markdown()],
    });
    ensureFullSyntaxTree(view.state);

    expect(withListRenumber(moveListItemUp)(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("1. b\n2. a");
  });

  it("passes through the wrapped command's failure without dispatching", () => {
    const doc = "plain paragraph";
    view = createTestView(doc, {
      cursorPos: 0,
      extensions: [markdown()],
    });
    ensureFullSyntaxTree(view.state);

    expect(withListRenumber(moveListItemUp)(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
  });
});

describe("list-outliner integration", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("renumbers after Mod-Shift-ArrowUp moves an ordered item", () => {
    const doc = "1. a\n2. b";
    view = createTestView(doc, {
      cursorPos: doc.length,
      extensions: [markdown(), listOutlinerExtension],
    });
    ensureFullSyntaxTree(view.state);

    const event = new KeyboardEvent("keydown", {
      key: "ArrowUp",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(runScopeHandlers(view, event, "editor")).toBe(true);
    expect(view.state.doc.toString()).toBe("1. b\n2. a");
  });
});
