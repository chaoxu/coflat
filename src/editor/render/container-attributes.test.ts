import { markdown } from "@codemirror/lang-markdown";
import * as language from "@codemirror/language";
import type { Decoration, DecorationSet } from "@codemirror/view";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { markdownExtensions } from "../../core/parser";
import { documentAnalysisField } from "../state/document-analysis";
import { createTestView, destroyAllTestViews } from "../test-utils";
import {
  containerAttributesPlugin,
  _containerAttributePendingDirtyRegionFieldForTest as pendingDirtyRegionField,
} from "./container-attributes";

/** Create an EditorView with the markdown parser and containerAttributesPlugin. */
function createView(doc: string): EditorView {
  return createTestView(doc, {
    extensions: [
      markdown({ extensions: markdownExtensions }),
      documentAnalysisField,
      containerAttributesPlugin,
    ],
  });
}

type DecorationWithSpec = Decoration & {
  spec?: { attributes?: Record<string, string>; class?: string };
};

function forEachDecoration(
  view: EditorView,
  visit: (from: number, deco: DecorationWithSpec) => void,
): void {
  for (const source of view.state.facet(EditorView.decorations)) {
    const set: DecorationSet = typeof source === "function" ? source(view) : source;
    const iter = set.iter();
    while (iter.value) {
      visit(iter.from, iter.value as DecorationWithSpec);
      iter.next();
    }
  }
}

/** Extract (lineStart, tagName) pairs from the plugin's decorations. */
function extractTags(view: EditorView): Array<{ pos: number; tag: string }> {
  const result: Array<{ pos: number; tag: string }> = [];
  forEachDecoration(view, (from, deco) => {
    const tag = deco.spec?.attributes?.["data-tag-name"];
    if (tag) {
      result.push({ pos: from, tag });
    }
  });
  return result;
}

function extractClasses(view: EditorView): Array<{ pos: number; className: string }> {
  const result: Array<{ pos: number; className: string }> = [];
  forEachDecoration(view, (from, deco) => {
    const className = deco.spec?.class;
    if (className) {
      result.push({ pos: from, className });
    }
  });
  return result;
}

function extractSourceRanges(view: EditorView): Array<{ pos: number; from: string; to: string }> {
  const result: Array<{ pos: number; from: string; to: string }> = [];
  forEachDecoration(view, (pos, deco) => {
    const from = deco.spec?.attributes?.["data-source-from"];
    const to = deco.spec?.attributes?.["data-source-to"];
    if (from && to) {
      result.push({ pos, from, to });
    }
  });
  return result;
}

function classNamesByLine(view: EditorView): string[][] {
  const byLine = new Map<number, Set<string>>();
  for (const line of extractClasses(view)) {
    let classes = byLine.get(line.pos);
    if (!classes) {
      classes = new Set();
      byLine.set(line.pos, classes);
    }
    for (const className of line.className.split(/\s+/)) {
      classes.add(className);
    }
  }
  return [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, classes]) => [...classes]);
}

/** Extract just the tag names in document order. */
function extractTagNames(view: EditorView): string[] {
  return extractTags(view).map((t) => t.tag);
}

afterEach(() => {
  destroyAllTestViews();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("containerAttributesPlugin", () => {
  describe("headings", () => {
    it("decorates h1 through h6", () => {
      const doc = [
        "# H1",
        "## H2",
        "### H3",
        "#### H4",
        "##### H5",
        "###### H6",
      ].join("\n");
      expect(extractTagNames(createView(doc))).toEqual([
        "h1", "h2", "h3", "h4", "h5", "h6",
      ]);
    });

    it("places decoration at line start for a heading", () => {
      const doc = "# Title";
      const tags = extractTags(createView(doc));
      expect(tags).toEqual([{ pos: 0, tag: "h1" }]);
    });

    it("places h2 decoration at correct offset", () => {
      const doc = "# First\n## Second";
      const tags = extractTags(createView(doc));
      expect(tags).toEqual([
        { pos: 0, tag: "h1" },
        { pos: 8, tag: "h2" },
      ]);
    });
  });

  describe("paragraphs", () => {
    it("decorates a single paragraph", () => {
      const doc = "Hello world";
      expect(extractTagNames(createView(doc))).toEqual(["p"]);
    });

    it("decorates multiple paragraphs separated by blank lines", () => {
      const doc = "First paragraph.\n\nSecond paragraph.";
      expect(extractTagNames(createView(doc))).toEqual(["p", "p"]);
    });

    it("decorates each line of a multi-line paragraph as p", () => {
      const doc = "Line one\nLine two\nLine three";
      const tags = extractTags(createView(doc));
      expect(tags).toEqual([
        { pos: 0, tag: "p" },
        { pos: 9, tag: "p" },
        { pos: 18, tag: "p" },
      ]);
    });

    it("marks editor lines as source carriers for rendered-position anchoring", () => {
      const doc = "Line one\nLine two";
      expect(extractSourceRanges(createView(doc))).toEqual([
        { pos: 0, from: "0", to: "8" },
        { pos: 9, from: "9", to: "17" },
      ]);
    });

    it("does not leak hidden frontmatter tags onto the first visible paragraph", () => {
      const doc = [
        "---",
        "id: ztrcpji2",
        "---",
        "",
        "motivated by a workshop",
        "",
        "second paragraph",
      ].join("\n");
      const firstParagraphStart = doc.indexOf("motivated");

      expect(extractTags(createView(doc))).toEqual([
        { pos: firstParagraphStart, tag: "p" },
        { pos: doc.indexOf("second paragraph"), tag: "p" },
      ]);
    });
  });

  describe("lists", () => {
    it("tags bullet list lines as paragraph list items", () => {
      const doc = "- item one\n- item two";
      const view = createView(doc);
      expect(extractTagNames(view)).toEqual(["p", "p"]);
      const classes = classNamesByLine(view);
      expect(classes[0]).toEqual(expect.arrayContaining([
        "cf-doc-paragraph",
        "cf-doc-list",
        "cf-doc-list--unordered",
        "cf-doc-list-item",
      ]));
      expect(classes[1]).toEqual(expect.arrayContaining([
        "cf-doc-paragraph",
        "cf-doc-list",
        "cf-doc-list--unordered",
        "cf-doc-list-item",
      ]));
    });

    it("tags ordered list lines as paragraph list items", () => {
      const doc = "1. first\n2. second";
      const view = createView(doc);
      expect(extractTagNames(view)).toEqual(["p", "p"]);
      const classes = classNamesByLine(view);
      expect(classes[0]).toEqual(expect.arrayContaining([
        "cf-doc-paragraph",
        "cf-doc-list",
        "cf-doc-list--ordered",
        "cf-doc-list-item",
      ]));
      expect(classes[1]).toEqual(expect.arrayContaining([
        "cf-doc-paragraph",
        "cf-doc-list",
        "cf-doc-list--ordered",
        "cf-doc-list-item",
      ]));
    });

    it("tags task list lines with shared task item classes", () => {
      const doc = "- [x] done";
      const classes = classNamesByLine(createView(doc));
      expect(classes[0]).toEqual(expect.arrayContaining([
        "cf-doc-list--check",
        "cf-doc-list-item--check",
      ]));
    });
  });

  describe("mixed content", () => {
    it("decorates headings, paragraphs, and lists in a mixed document", () => {
      const doc = [
        "# Title",
        "",
        "A paragraph.",
        "",
        "- bullet",
      ].join("\n");
      const tags = extractTagNames(createView(doc));
      expect(tags).toEqual(["h1", "p", "p"]);
    });
  });

  describe("horizontal rule", () => {
    it("decorates a horizontal rule as hr", () => {
      const doc = "Above\n\n---\n\nBelow";
      const tags = extractTagNames(createView(doc));
      expect(tags).toContain("hr");
    });
  });

  describe("fenced code", () => {
    it("decorates fenced code block lines as code", () => {
      const doc = "```\nlet x = 1;\n```";
      const tags = extractTagNames(createView(doc));
      expect(tags).toContain("code");
    });
  });

  describe("empty document", () => {
    it("returns no decorations for an empty document", () => {
      expect(extractTags(createView(""))).toEqual([]);
    });
  });

  describe("rendered DOM", () => {
    it("applies attributes and classes to the rendered cm-line elements", () => {
      const view = createView("# Title\n\n- item");
      const lines = view.contentDOM.querySelectorAll(".cm-line");
      expect(lines.length).toBe(3);
      expect(lines[0].getAttribute("data-tag-name")).toBe("h1");
      expect(lines[0].getAttribute("data-source-from")).toBe("0");
      expect(lines[0].getAttribute("data-source-to")).toBe("7");
      expect(lines[2].className).toContain("cf-doc-list-item");
    });
  });

  describe("update on doc change", () => {
    it("recomputes decorations when document changes", () => {
      const view = createView("# Hello");
      expect(extractTagNames(view)).toEqual(["h1"]);

      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "Plain text" },
      });
      expect(extractTagNames(view)).toEqual(["p"]);
    });
  });

  describe("mapOnDocChanged (#718)", () => {
    it("decoration positions remain correct after text insertion", () => {
      const view = createView("# Title\n\nParagraph text");
      const before = extractTags(view);
      expect(before).toEqual([
        { pos: 0, tag: "h1" },
        { pos: 9, tag: "p" },
      ]);

      // Insert text within the paragraph — shifts paragraph content
      // but doesn't change block structure
      view.dispatch({
        changes: { from: 9, insert: "More " },
      });
      const after = extractTags(view);

      expect(after[0]).toEqual({ pos: 0, tag: "h1" });
      expect(after[1].tag).toBe("p");
      expect(after[1].pos).toBe(9); // paragraph starts at same line
    });

    it("decoration positions remain correct after text deletion", () => {
      const view = createView("# Title\n\nParagraph");
      const before = extractTags(view);
      expect(before.length).toBe(2);

      // Delete the blank line between heading and paragraph
      view.dispatch({
        changes: { from: 8, to: 9 },
      });
      const after = extractTags(view);

      // All decorations should reference valid line positions
      for (const t of after) {
        const line = view.state.doc.lineAt(t.pos);
        expect(line.from).toBe(t.pos);
      }
    });
  });

  describe("viewport scoping", () => {
    it("only decorates lines inside the current viewport", () => {
      const doc = Array.from({ length: 800 }, (_, index) => `para ${index}`).join("\n\n");
      const view = createView(doc);
      // The jsdom viewport must be smaller than the document for this test
      // to exercise viewport scoping at all.
      expect(view.viewport.to).toBeLessThan(view.state.doc.length);

      const ranges = extractSourceRanges(view);
      expect(ranges.length).toBeGreaterThan(0);
      expect(ranges[0].pos).toBe(0);
      const viewportLastLineStart = view.state.doc.lineAt(view.viewport.to).from;
      expect(ranges.at(-1)?.pos).toBeLessThanOrEqual(viewportLastLineStart);

      const tags = extractTags(view);
      expect(tags.at(-1)?.pos).toBeLessThanOrEqual(viewportLastLineStart);
    });
  });

  describe("incremental invalidation", () => {
    it("retags lines past the literal edit when a closing fence is inserted", () => {
      const view = createView([
        "```",
        "code line",
        "still code",
        "plain text",
      ].join("\n"));
      expect(extractTagNames(view)).toEqual(["code", "code", "code", "code"]);

      const insertPos = view.state.doc.toString().indexOf("plain text");
      view.dispatch({
        changes: { from: insertPos, insert: "```\n" },
      });

      expect(extractTags(view)).toEqual([
        { pos: view.state.doc.line(1).from, tag: "code" },
        { pos: view.state.doc.line(2).from, tag: "code" },
        { pos: view.state.doc.line(3).from, tag: "code" },
        { pos: view.state.doc.line(4).from, tag: "code" },
        { pos: view.state.doc.line(5).from, tag: "p" },
      ]);
    });

    it("clears the pending parse region once the idle parser catches up", async () => {
      const doc = [
        "```",
        ...Array.from({ length: 800 }, (_, index) => `code ${index}`),
        "plain text",
      ].join("\n");
      const view = createView(doc);

      language.forceParsing(view, view.viewport.to, 5);

      const insertPos = view.state.doc.toString().lastIndexOf("plain text");
      view.dispatch({
        changes: { from: insertPos, insert: "```\n" },
      });

      await vi.waitFor(() => {
        expect(view.state.field(pendingDirtyRegionField)).toBeNull();
      }, { timeout: 3000 });

      // Viewport lines rendered from the partial tree stay correctly tagged.
      expect(extractTags(view).at(0)).toEqual({ pos: 0, tag: "code" });
    });

    it("ignores a queued parse retry after the plugin is destroyed", () => {
      vi.useFakeTimers();
      const pendingTimeouts: Array<() => void> = [];
      let nextTimerId = 1;
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation((handler) => {
        if (typeof handler !== "function") {
          throw new Error("expected function timeout handler");
        }
        if (handler.toString().includes("forceParsing")) {
          pendingTimeouts.push(() => {
            handler();
          });
        }
        return nextTimerId++ as unknown as ReturnType<typeof setTimeout>;
      });
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

      const doc = [
        "```",
        ...Array.from({ length: 800 }, (_, index) => `code ${index}`),
        "plain text",
      ].join("\n");
      const view = createView(doc);

      try {
        language.forceParsing(view, view.viewport.to, 5);

        const insertPos = view.state.doc.toString().lastIndexOf("plain text");
        view.dispatch({
          changes: { from: insertPos, insert: "```\n" },
        });

        view.destroy();
        if (pendingTimeouts.length > 0) {
          const stateSpy = vi.spyOn(view, "state", "get").mockImplementation(() => {
            throw new Error("stale timeout accessed destroyed view state");
          });

          expect(() => pendingTimeouts[0]()).not.toThrow();
          expect(clearTimeoutSpy).toHaveBeenCalled();
          stateSpy.mockRestore();
        }
      } finally {
        setTimeoutSpy.mockRestore();
        clearTimeoutSpy.mockRestore();
      }
    });
  });
});
