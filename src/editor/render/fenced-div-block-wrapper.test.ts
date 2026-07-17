import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { markdownExtensions } from "../../core/parser";
import { createTestView, destroyAllTestViews } from "../test-utils";
import { containerAttributesPlugin } from "./container-attributes";
import {
  FENCED_DIV_WRAPPER_TAG,
  fencedDivBlockWrapper,
} from "./fenced-div-block-wrapper";

function createView(doc: string, extraExtensions: unknown[] = []): EditorView {
  return createTestView(doc, {
    extensions: [
      markdown({ extensions: markdownExtensions }),
      fencedDivBlockWrapper,
      ...(extraExtensions as import("@codemirror/state").Extension[]),
    ],
  });
}

interface WrapperInfo {
  readonly from: number;
  readonly to: number;
  readonly tagName: string;
  readonly attributes: Record<string, string>;
  readonly rank: number;
}

/** Read all block wrappers the view currently provides via the facet. */
function collectWrappers(view: EditorView): WrapperInfo[] {
  const result: WrapperInfo[] = [];
  for (const source of view.state.facet(EditorView.blockWrappers)) {
    const set = typeof source === "function" ? source(view) : source;
    const iter = set.iter();
    while (iter.value) {
      const value = iter.value as unknown as {
        tagName: string;
        attributes: Record<string, string>;
        rank: number;
      };
      result.push({
        from: iter.from,
        to: iter.to,
        tagName: value.tagName,
        attributes: value.attributes,
        rank: value.rank,
      });
      iter.next();
    }
  }
  return result.sort((a, b) => a.from - b.from || a.to - b.to);
}

afterEach(() => {
  destroyAllTestViews();
  document.body.innerHTML = "";
});

describe("fencedDivBlockWrapper", () => {
  describe("content-only wrapping", () => {
    it("wraps only the content lines, keeping fence marker lines outside", () => {
      const doc = "::: theorem\nbody line\n:::";
      const view = createView(doc);
      const wrappers = collectWrappers(view);

      expect(wrappers).toHaveLength(1);
      const [wrapper] = wrappers;
      expect(wrapper.tagName).toBe(FENCED_DIV_WRAPPER_TAG);
      // Content starts on the line after the opening fence...
      expect(wrapper.from).toBe(doc.indexOf("body line"));
      // ...and ends at the end of the last content line, before the
      // closing fence line (which starts at wrapper.to + 1).
      expect(wrapper.to).toBe(doc.indexOf("body line") + "body line".length);
      expect(view.state.doc.lineAt(doc.lastIndexOf(":::")).from)
        .toBe(wrapper.to + 1);
    });

    it("carries cf-div, cf-div-<name>, and the user classes", () => {
      const view = createView("::: {.theorem .fancy}\nbody\n:::");
      const [wrapper] = collectWrappers(view);
      const classes = wrapper.attributes.class.split(" ");
      expect(classes).toEqual(
        expect.arrayContaining(["cf-div", "cf-div-theorem", "theorem", "fancy"]),
      );
      expect(classes[0]).toBe("cf-div");
    });

    it("emits no wrapper for a div without content lines", () => {
      const view = createView("::: theorem\n:::");
      expect(collectWrappers(view)).toEqual([]);
    });

    it("wraps a multi-line content body as one range", () => {
      const doc = "::: note\nalpha\n\nbeta\n:::";
      const view = createView(doc);
      const [wrapper] = collectWrappers(view);
      expect(wrapper.from).toBe(doc.indexOf("alpha"));
      expect(wrapper.to).toBe(doc.indexOf("beta") + "beta".length);
    });

    it("wraps an unclosed div through the end of its last line", () => {
      const doc = "::: theorem\nbody";
      const view = createView(doc);
      const [wrapper] = collectWrappers(view);
      expect(wrapper.from).toBe(doc.indexOf("body"));
      expect(wrapper.to).toBe(doc.length);
    });
  });

  describe("attribute passthrough", () => {
    it("passes id and key/values as data-* attributes", () => {
      const view = createView(
        '::: {.theorem #thm:main key="value" title="Main"}\nbody\n:::',
      );
      const [wrapper] = collectWrappers(view);
      expect(wrapper.attributes.id).toBe("thm:main");
      expect(wrapper.attributes["data-key"]).toBe("value");
      expect(wrapper.attributes["data-title"]).toBe("Main");
    });

    it("never emits style or event handler attribute names", () => {
      const view = createView(
        '::: {.theorem style="color:red" onclick="alert(1)"}\nbody\n:::',
      );
      const [wrapper] = collectWrappers(view);
      expect(wrapper.attributes.style).toBeUndefined();
      expect(wrapper.attributes.onclick).toBeUndefined();
      // Invariant: only id, class, and data-* names reach the DOM.
      for (const name of Object.keys(wrapper.attributes)) {
        expect(name).toMatch(/^(id|class|data-[a-z0-9_-]+)$/);
      }
    });

    it("keeps user-authored data-* keys un-double-prefixed", () => {
      const view = createView('::: {.note data-kind="warn"}\nbody\n:::');
      const [wrapper] = collectWrappers(view);
      expect(wrapper.attributes["data-kind"]).toBe("warn");
      expect(wrapper.attributes["data-data-kind"]).toBeUndefined();
    });
  });

  describe("nested divs", () => {
    const doc = [
      ":::: {.theorem #thm:outer}",
      "Setup.",
      "::: {.proof}",
      "Proof content.",
      ":::",
      "After.",
      "::::",
    ].join("\n");

    it("emits one wrapper per div with the inner range inside the outer", () => {
      const view = createView(doc);
      const wrappers = collectWrappers(view);
      expect(wrappers).toHaveLength(2);
      const [outer, inner] = wrappers;
      expect(outer.attributes.id).toBe("thm:outer");
      expect(inner.attributes.class).toContain("cf-div-proof");
      expect(outer.from).toBe(doc.indexOf("Setup."));
      expect(outer.to).toBe(doc.indexOf("After.") + "After.".length);
      expect(inner.from).toBe(doc.indexOf("Proof content."));
      expect(inner.to).toBe(doc.indexOf("Proof content.") + "Proof content.".length);
      expect(inner.from).toBeGreaterThan(outer.from);
      expect(inner.to).toBeLessThan(outer.to);
    });

    it("ranks wrappers deterministically by depth (outer higher)", () => {
      const view = createView(doc);
      const [outer, inner] = collectWrappers(view);
      expect(outer.rank).toBe(100);
      expect(inner.rank).toBe(99);
      expect(inner.rank).toBeLessThan(outer.rank);
    });
  });

  describe("viewport scoping", () => {
    it("skips divs entirely outside the viewport", () => {
      const filler = Array.from({ length: 800 }, (_, i) => `para ${i}`).join("\n\n");
      const doc = `${filler}\n\n::: theorem\nfar body\n:::`;
      const view = createView(doc);
      // The jsdom viewport must be smaller than the document for this test
      // to exercise viewport scoping at all.
      expect(view.viewport.to).toBeLessThan(doc.indexOf("::: theorem"));
      expect(collectWrappers(view)).toEqual([]);
    });

    it("wraps divs that overlap the viewport", () => {
      const filler = Array.from({ length: 800 }, (_, i) => `para ${i}`).join("\n\n");
      const doc = `::: theorem\nnear body\n:::\n\n${filler}`;
      const view = createView(doc);
      expect(view.viewport.to).toBeLessThan(view.state.doc.length);
      const wrappers = collectWrappers(view);
      expect(wrappers).toHaveLength(1);
      expect(wrappers[0].from).toBe(doc.indexOf("near body"));
    });
  });

  describe("editing persistence (no selection-based skipping)", () => {
    it("keeps the wrapper while the selection is inside the div", () => {
      const doc = "::: theorem\nbody\n:::";
      const view = createView(doc);
      view.dispatch({ selection: { anchor: doc.indexOf("body") + 2 } });
      expect(collectWrappers(view)).toHaveLength(1);
    });

    it("rebuilds ranges when text is typed inside the content", () => {
      const doc = "::: theorem\nbody\n:::";
      const view = createView(doc);
      const insertAt = doc.indexOf("body") + "body".length;
      view.dispatch({
        selection: { anchor: insertAt },
        changes: { from: insertAt, insert: " grows" },
      });
      const [wrapper] = collectWrappers(view);
      expect(wrapper.from).toBe(doc.indexOf("body"));
      expect(wrapper.to).toBe(insertAt + " grows".length);
    });

    it("drops the wrapper when the div is deleted", () => {
      const doc = "::: theorem\nbody\n:::";
      const view = createView(doc);
      view.dispatch({
        changes: { from: 0, to: doc.length, insert: "plain paragraph" },
      });
      expect(collectWrappers(view)).toEqual([]);
    });
  });

  describe("rendered DOM", () => {
    it("renders a cf-div-wrapper element around the content lines only", () => {
      const view = createView("::: theorem\nbody line\n:::");
      const wrapperEl = view.contentDOM.querySelector(FENCED_DIV_WRAPPER_TAG);
      expect(wrapperEl).not.toBeNull();
      expect(wrapperEl?.className).toContain("cf-div");
      expect(wrapperEl?.className).toContain("cf-div-theorem");
      expect(wrapperEl?.textContent).toContain("body line");
      expect(wrapperEl?.textContent).not.toContain(":::");
    });

    it("nests the inner div wrapper inside the outer one", () => {
      const view = createView([
        ":::: {.theorem}",
        "Setup.",
        "::: {.proof}",
        "Proof content.",
        ":::",
        "::::",
      ].join("\n"));
      const outerEl = view.contentDOM.querySelector(".cf-div-theorem");
      expect(outerEl).not.toBeNull();
      const innerEl = outerEl?.querySelector(".cf-div-proof");
      expect(innerEl).not.toBeNull();
      expect(innerEl?.textContent).toContain("Proof content.");
    });
  });

  describe("coexistence with container-attributes line styling", () => {
    it("keeps data-tag-name line attributes alongside the wrapper", () => {
      const doc = "::: theorem\nbody\n:::";
      const view = createView(doc, [containerAttributesPlugin]);
      expect(collectWrappers(view)).toHaveLength(1);
      // Fence lines stay outside the wrapper and keep their existing
      // "div" line tag; content lines keep their own tag ("p").
      const lines = [...view.contentDOM.querySelectorAll(".cm-line")];
      expect(lines.map((line) => line.getAttribute("data-tag-name")))
        .toEqual(["div", "p", "div"]);
      const contentLine = view.contentDOM.querySelector(
        `${FENCED_DIV_WRAPPER_TAG} .cm-line`,
      );
      expect(contentLine?.getAttribute("data-tag-name")).toBe("p");
      expect(contentLine?.textContent).toBe("body");
    });
  });
});
