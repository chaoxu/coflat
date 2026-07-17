import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  isMutedLinesActive,
  mutedLinesExtension,
  toggleMutedLines,
} from "./muted-lines";
import { createTestView } from "./test-utils";

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

/** Create a view with the muted lines extension and the given document. */
function setup(doc: string, cursorPos = 0): EditorView {
  view = createTestView(doc, {
    cursorPos,
    extensions: mutedLinesExtension,
  });
  return view;
}

/** Extract muted line numbers from all active decorations in the view. */
function getMutedLineNumbers(v: EditorView): number[] {
  const lineNumbers: number[] = [];
  const allDecos = v.state.facet(EditorView.decorations);
  for (const decoSource of allDecos) {
    const decoSet = typeof decoSource === "function" ? decoSource(v) : decoSource;
    const iter = decoSet.iter();
    while (iter.value) {
      if (iter.value.spec?.class === "cf-muted-line") {
        lineNumbers.push(v.state.doc.lineAt(iter.from).number);
      }
      iter.next();
    }
  }
  return lineNumbers;
}

describe("muted lines", () => {
  describe("toggle", () => {
    it("starts inactive — no muting", () => {
      const v = setup("one\ntwo\nthree");
      expect(isMutedLinesActive(v.state)).toBe(false);
      expect(getMutedLineNumbers(v)).toEqual([]);
    });

    it("toggles on with toggleMutedLines command", () => {
      const v = setup("one\ntwo\nthree");
      toggleMutedLines(v);
      expect(isMutedLinesActive(v.state)).toBe(true);
      expect(getMutedLineNumbers(v).length).toBeGreaterThan(0);
    });

    it("toggles off when called twice", () => {
      const v = setup("one\ntwo\nthree");
      toggleMutedLines(v);
      toggleMutedLines(v);
      expect(isMutedLinesActive(v.state)).toBe(false);
      expect(getMutedLineNumbers(v)).toEqual([]);
    });

    it("returns true (consumed command)", () => {
      const v = setup("one");
      expect(toggleMutedLines(v)).toBe(true);
    });
  });

  describe("active line exclusion", () => {
    it("mutes every line except the active one", () => {
      const v = setup("one\ntwo\nthree", 0);
      toggleMutedLines(v);
      expect(getMutedLineNumbers(v)).toEqual([2, 3]);
    });

    it("excludes the active line with the cursor mid-line", () => {
      const doc = "one\ntwo\nthree";
      const v = setup(doc, doc.indexOf("wo"));
      toggleMutedLines(v);
      expect(getMutedLineNumbers(v)).toEqual([1, 3]);
    });

    it("mutes blank lines too (line-granular, unlike paragraph focus mode)", () => {
      const doc = "alpha\n\nbeta";
      const v = setup(doc, doc.indexOf("beta"));
      toggleMutedLines(v);
      expect(getMutedLineNumbers(v)).toEqual([1, 2]);
    });

    it("mutes nothing extra on a single-line document", () => {
      const v = setup("only line");
      toggleMutedLines(v);
      expect(getMutedLineNumbers(v)).toEqual([]);
    });

    it("handles the empty document", () => {
      const v = setup("");
      toggleMutedLines(v);
      expect(getMutedLineNumbers(v)).toEqual([]);
    });
  });

  describe("updates", () => {
    it("updates muting when the caret moves", () => {
      const doc = "one\ntwo\nthree";
      const v = setup(doc, 0);
      toggleMutedLines(v);
      expect(getMutedLineNumbers(v)).toEqual([2, 3]);

      v.dispatch({ selection: { anchor: doc.indexOf("three") } });
      expect(getMutedLineNumbers(v)).toEqual([1, 2]);
    });

    it("updates muting on doc changes", () => {
      const doc = "one\ntwo";
      const v = setup(doc, 0);
      toggleMutedLines(v);
      expect(getMutedLineNumbers(v)).toEqual([2]);

      // Split line 1: caret stays on the first line, old content shifts down.
      v.dispatch({
        changes: { from: 0, insert: "zero\n" },
        selection: { anchor: 0 },
      });
      expect(getMutedLineNumbers(v)).toEqual([2, 3]);
    });

    it("follows the caret when typing creates a new line", () => {
      const doc = "one\ntwo";
      const v = setup(doc, doc.length);
      toggleMutedLines(v);
      expect(getMutedLineNumbers(v)).toEqual([1]);

      v.dispatch({
        changes: { from: doc.length, insert: "\nthree" },
        selection: { anchor: doc.length + 6 },
        userEvent: "input.type",
      });
      expect(getMutedLineNumbers(v)).toEqual([1, 2]);
    });
  });
});
