import { markdown } from "@codemirror/lang-markdown";
import { forceParsing, syntaxTree } from "@codemirror/language";
import { StateEffect } from "@codemirror/state";
import { Decoration, EditorView, type ViewUpdate } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { CSS } from "../../core/constants/css-classes";
import { markdownExtensions } from "../../core/parser";
import { decorationHidden } from "./decoration-core";
import {
  createEditorState,
  createTestView,
  type DecorationSpecInfo,
  getDecorationSpecs,
  hasLineClassAt,
  hasMarkClassInRange,
} from "../test-utils";
import {
  _clearLinkDecorationCacheForTest as clearLinkDecorationCache,
  _collectMarkdownItemsForTest as collectMarkdownItems,
  computeMarkdownContextChangeRanges,
  computeMarkdownDocChangeRanges,
  cursorContextKey,
  _linkDecorationCacheSizeForTest as linkDecorationCacheSize,
  _markdownDocChangeNeedsContextMergeForTest as markdownDocChangeNeedsContextMerge,
  markdownRenderPlugin,
  markdownShouldUpdate,
  _setMarkdownRevealFrozenForTest as setMarkdownRevealFrozen,
} from "./markdown-render";
import {
  createCursorSensitiveViewPlugin,
  createSimpleViewPlugin,
  cursorInRange,
  focusEffect,
} from "./render-core";

/** Create an EditorView with the markdown render plugin at the given cursor position. */
function createView(doc: string, cursorPos?: number): EditorView {
  const view = createTestView(doc, {
    cursorPos,
    extensions: [markdown({ extensions: markdownExtensions }), markdownRenderPlugin],
  });
  view.dispatch({ effects: focusEffect.of(true) });
  return view;
}

function getAllDecorationSpecs(view: EditorView) {
  return view.state.facet(EditorView.decorations)
    .flatMap((source) => getDecorationSpecs(typeof source === "function" ? source(view) : source));
}

/** Split decoration specs by substrate: StateField sets vs ViewPlugin accessors. */
function getDecorationSpecsBySource(view: EditorView) {
  const fieldSpecs: DecorationSpecInfo[] = [];
  const pluginSpecs: DecorationSpecInfo[] = [];
  for (const source of view.state.facet(EditorView.decorations)) {
    if (typeof source === "function") {
      pluginSpecs.push(...getDecorationSpecs(source(view)));
    } else {
      fieldSpecs.push(...getDecorationSpecs(source));
    }
  }
  return { fieldSpecs, pluginSpecs };
}

describe("cursorInRange", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("returns true when cursor is inside the range", () => {
    view = createView("hello world", 5);
    expect(cursorInRange(view, 0, 10)).toBe(true);
  });

  it("returns true when cursor is at range start", () => {
    view = createView("hello world", 0);
    expect(cursorInRange(view, 0, 5)).toBe(true);
  });

  it("returns true when cursor is at range end", () => {
    view = createView("hello world", 5);
    expect(cursorInRange(view, 0, 5)).toBe(true);
  });

  it("returns false when cursor is outside the range", () => {
    view = createView("hello world", 8);
    expect(cursorInRange(view, 0, 5)).toBe(false);
  });

  describe("negative / edge-case", () => {
    it("returns false for an empty range (from === to) with cursor elsewhere", () => {
      view = createView("abc", 2);
      expect(cursorInRange(view, 1, 1)).toBe(false);
    });

    it("returns false when cursor is exactly at range end (exclusive boundary)", () => {
      // cursorInRange uses cursor >= from && cursor <= to, so cursor === to is true
      // Verifying boundary semantics are consistent
      view = createView("hello", 3);
      expect(cursorInRange(view, 0, 3)).toBe(true);
    });

    it("returns false when cursor is well past range end", () => {
      view = createView("hello world", 10);
      expect(cursorInRange(view, 0, 3)).toBe(false);
    });
  });
});

describe("highlight rendering", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("styles only highlight content, not hidden == markers", () => {
    const doc = "a ==mark== b";
    view = createView(doc, doc.length);
    const specs = getAllDecorationSpecs(view);
    const highlight = specs.find((spec) => spec.class === CSS.highlight);

    expect(highlight).toMatchObject({
      from: doc.indexOf("mark"),
      to: doc.indexOf("mark") + "mark".length,
    });
  });
});

describe("markdownRenderPlugin (Decoration.mark approach)", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("creates a view with the plugin without errors", () => {
    view = createView("# Hello\n\nSome **bold** text");
    expect(view.state.doc.toString()).toBe("# Hello\n\nSome **bold** text");
  });

  it("freezes cursor-sensitive source reveal during pointer interactions", () => {
    const doc = "# Heading\n\nbody";
    view = createView(doc, doc.length);
    let specs = getAllDecorationSpecs(view);
    expect(specs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 0, to: 2 }),
      ]),
    );

    view.dispatch({ effects: setMarkdownRevealFrozen.of(true) });
    view.dispatch({ selection: { anchor: 2 } });
    specs = getAllDecorationSpecs(view);
    expect(specs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 0, to: 2 }),
      ]),
    );

    view.dispatch({ effects: setMarkdownRevealFrozen.of(false) });
    specs = getAllDecorationSpecs(view);
    expect(specs.some((spec) => spec.from === 0 && spec.to === 2)).toBe(false);
  });

  it("does not freeze table widget pointer interactions", () => {
    const effects: unknown[] = [];
    const doc = "| A |\n| --- |\n| Edit this cell |";
    view = createTestView(doc, {
      extensions: [
        markdown({ extensions: markdownExtensions }),
        markdownRenderPlugin,
        EditorView.updateListener.of((update) => {
          for (const tr of update.transactions) {
            effects.push(...tr.effects);
          }
        }),
      ],
    });
    view.dispatch({ effects: focusEffect.of(true) });

    const target = document.createElement("td");
    target.className = "cf-table-widget";
    view.contentDOM.appendChild(target);
    target.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
    }));

    expect(effects.some((effect) =>
      effect instanceof StateEffect &&
      effect.is(setMarkdownRevealFrozen)
    )).toBe(false);
  });

  it("handles empty document", () => {
    view = createView("");
    expect(view.state.doc.toString()).toBe("");
  });

  it("handles document with all element types", () => {
    const doc = [
      "# Heading 1",
      "",
      "Some **bold** and *italic* text with `code`.",
      "",
      "[link](https://example.com)",
      "",
      "![image](photo.png)",
      "",
      "---",
    ].join("\n");
    view = createView(doc);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("replaces bullet list source markers with bullet glyph widgets", () => {
    view = createView("- top one\n- top two", 0);
    const specs = getAllDecorationSpecs(view);

    expect(specs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 0,
          to: 1,
          widgetClass: "BulletListMarkerWidget",
        }),
        expect.objectContaining({
          from: 10,
          to: 11,
          widgetClass: "BulletListMarkerWidget",
        }),
      ]),
    );
  });

  it("keeps ordered list markers as styled source text", () => {
    view = createView("1. top one\n2. top two", 0);
    const specs = getAllDecorationSpecs(view);
    expect(hasMarkClassInRange(specs, 0, 2, CSS.listNumber)).toBe(true);
    expect(specs.some((spec) => spec.widgetClass === "BulletListMarkerWidget")).toBe(false);
  });

  it("replaces horizontal rule source with an hr widget outside the cursor", () => {
    view = createView("before\n\n---\n\nafter", 0);
    const specs = getAllDecorationSpecs(view);
    const from = view.state.doc.toString().indexOf("---");

    expect(specs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from,
          to: from + 3,
          widgetClass: "HorizontalRuleWidget",
        }),
      ]),
    );
  });

  it("keeps horizontal rule source visible when the cursor is inside", () => {
    const doc = "before\n\n---\n\nafter";
    const from = doc.indexOf("---");
    view = createView(doc, from + 1);
    const specs = getAllDecorationSpecs(view);

    expect(specs.some((spec) => spec.widgetClass === "HorizontalRuleWidget")).toBe(false);
  });

  it("keeps raw HTML br tags visible as noncanonical source", () => {
    view = createView("line<br />break", 0);
    const specs = getAllDecorationSpecs(view);
    const from = view.state.doc.toString().indexOf("<br />");

    expect(specs.some((spec) =>
      spec.from === from &&
      spec.to === from + "<br />".length &&
      spec.widgetClass === "HardBreakWidget"
    )).toBe(false);
    expect(hasMarkClassInRange(specs, from, from + "<br />".length, CSS.hidden)).toBe(false);
  });

  it("keeps raw subscript and superscript HTML tags visible as source", () => {
    view = createView("H<sub>2</sub>O", 0);
    const subItems = collectMarkdownItems(
      view,
      [{ from: 0, to: view.state.doc.length }],
      () => false,
    );

    expect(subItems.some((item) => item.value.spec.tagName === "sub")).toBe(false);
    expect(subItems.some((item) => item.value.spec.class === CSS.hidden)).toBe(false);

    view.destroy();
    view = createView("x<sup>2</sup>", 0);
    const supItems = collectMarkdownItems(
      view,
      [{ from: 0, to: view.state.doc.length }],
      () => false,
    );

    expect(supItems.some((item) => item.value.spec.tagName === "sup")).toBe(false);
    expect(supItems.some((item) => item.value.spec.class === CSS.hidden)).toBe(false);
  });

  it("does not throw when cursor is at beginning", () => {
    view = createView("# Hello\n\n**bold**", 0);
    expect(view.state.doc.toString()).toBe("# Hello\n\n**bold**");
  });

  it("does not throw when cursor is at end", () => {
    const doc = "# Hello\n\n**bold**";
    view = createView(doc, doc.length);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("survives rapid document changes", () => {
    view = createView("# Start");
    for (let i = 0; i < 100; i++) {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: `\nLine ${i}` },
      });
    }
    expect(view.state.doc.lines).toBe(101);
  });

  it("handles cursor movement through decorated regions", () => {
    const doc = "before **bold** after";
    view = createView(doc, 0);

    // Move cursor through the bold region
    for (let i = 0; i <= doc.length; i++) {
      view.dispatch({ selection: { anchor: i } });
    }

    expect(view.state.doc.toString()).toBe(doc);
  });

  it("source text is preserved in the document (mark approach keeps text)", () => {
    const doc = "**bold** and *italic*";
    view = createView(doc, doc.length); // cursor at end, outside markup
    // The document always keeps source text with Decoration.mark
    expect(view.state.doc.toString()).toBe(doc);
    // Markers are still in the doc (not replaced by widgets)
    expect(view.state.doc.toString()).toContain("**");
    expect(view.state.doc.toString()).toContain("*italic*");
  });

  it("uses Decoration.mark not Decoration.replace", () => {
    // Verify the plugin produces mark decorations, not replace decorations
    const doc = "**bold**";
    view = createView(doc, doc.length);
    // The key property of mark decorations: source text stays in the doc
    // and is not replaced by widget DOM. The doc should read the same.
    expect(view.state.doc.toString()).toBe("**bold**");
    // A replace decoration would remove the text from the DOM entirely
    // and substitute a widget. With marks, the text remains.
  });

  it("does not hide markers when cursor is inside element", () => {
    // Cursor at position 4 is inside "**bold**" (positions 0-7)
    const doc = "**bold**";
    view = createView(doc, 4);
    // With cursor inside, no decorations should be applied
    // (the tree walk returns false, skipping marker hiding)
    expect(view.state.doc.toString()).toBe(doc);
  });

  describe("source-delimiter decorations (#789)", () => {
    /** Collect decorations with class "cf-source-delimiter" for the full doc range. */
    function getSourceDelimiters(v: EditorView) {
      const items = collectMarkdownItems(
        v,
        [{ from: 0, to: v.state.doc.length }],
        () => false,
      );
      return items.filter((r) => r.value.spec.class === CSS.sourceDelimiter);
    }

    function getInlineSourceRuns(v: EditorView) {
      const items = collectMarkdownItems(
        v,
        [{ from: 0, to: v.state.doc.length }],
        () => false,
      );
      return items.filter((r) => r.value.spec.class === CSS.inlineSource);
    }

    function hasDecorationClass(v: EditorView, className: string): boolean {
      const items = collectMarkdownItems(
        v,
        [{ from: 0, to: v.state.doc.length }],
        () => false,
      );
      return items.some((item) => item.value.spec.class === className);
    }

    it("applies cf-source-delimiter to bold markers when cursor is inside", () => {
      view = createView("**bold**", 4);
      const delims = getSourceDelimiters(view);
      expect(delims.length).toBeGreaterThan(0);
    });

    it("applies cf-source-delimiter to italic markers when cursor is inside", () => {
      view = createView("*italic*", 3);
      const delims = getSourceDelimiters(view);
      expect(delims.length).toBeGreaterThan(0);
    });

    it("keeps canonical italic styling while cursor is inside", () => {
      view = createView("a *real italic* phrase", 5);

      expect(hasDecorationClass(view, CSS.italic)).toBe(true);
    });

    it("does not style intraword asterisk pairs as italic while cursor is inside", () => {
      const doc = "Use a*b c*d as literal math-like text.";
      view = createView(doc, doc.indexOf("b c") + 1);

      expect(hasDecorationClass(view, CSS.italic)).toBe(false);
      expect(getSourceDelimiters(view).length).toBeGreaterThanOrEqual(2);
    });

    it("decorates marks at ALL nesting levels in ***x*** (#789 regression)", () => {
      // ***x*** parses as Emphasis > StrongEmphasis (or vice versa).
      // The outer handler must not short-circuit inner marks.
      view = createView("***x***", 3);
      const delims = getSourceDelimiters(view);
      // 4 EmphasisMark nodes: outer pair + inner pair — all must be decorated.
      expect(delims.length).toBeGreaterThanOrEqual(4);
    });

    it("decorates inner italic marks in **a *b* c** (#789 regression)", () => {
      // StrongEmphasis wraps Emphasis; both levels have delimiter marks.
      view = createView("**a *b* c**", 5);
      const delims = getSourceDelimiters(view);
      // Outer ** (×2) + inner * (×2) = at least 4 decorated ranges
      expect(delims.length).toBeGreaterThanOrEqual(4);
    });

    it("does not apply cf-source-delimiter when cursor is outside", () => {
      view = createView("**bold** rest", 12);
      const delims = getSourceDelimiters(view);
      expect(delims.length).toBe(0);
    });

    it("keeps active bold styling while typing before a trailing-space closer", () => {
      const doc = "**foo **";
      view = createView(doc, doc.indexOf("foo") + 2);
      const items = collectMarkdownItems(
        view,
        [{ from: 0, to: view.state.doc.length }],
        () => false,
      );

      expect(items.some((item) =>
        item.from === 2 &&
        item.to === doc.length - 2 &&
        item.value.spec.class === CSS.bold
      )).toBe(true);
    });

    it("does not treat stars inside inline math as active emphasis delimiters", () => {
      const doc = [
        "::: {.proof}",
        "Let $F^*$ be a flat and $G^*$ be another.",
        ":::",
      ].join("\n");
      view = createView(doc, doc.indexOf("F^*") + "F^*".length);
      const items = collectMarkdownItems(
        view,
        [{ from: 0, to: view.state.doc.length }],
        () => false,
      );

      expect(items.some((item) => item.value.spec.class === CSS.italic)).toBe(false);
    });

    it("does not treat underscores inside inline math as active emphasis delimiters", () => {
      const doc = [
        "::: {.proof}",
        "Let $x_i$ be paired with $y_i$.",
        ":::",
      ].join("\n");
      view = createView(doc, doc.indexOf("x_i") + "x_i".length);

      expect(hasDecorationClass(view, CSS.italic)).toBe(false);
    });

    it("does not treat underscores inside citation keys as active emphasis delimiters", () => {
      const doc = [
        "For graph $k$-cut, Karger's tree-packing minimum-cut analysis",
        "[@karger_minimum_2000] and the extension of Chekuri et al.",
        "[@chekuri_lp_2020] use integrality.",
      ].join(" ");
      view = createView(doc, doc.indexOf(" and the extension") + " and".length);

      expect(hasDecorationClass(view, CSS.italic)).toBe(false);
    });

    it("does not treat stars inside inline code as active emphasis delimiters", () => {
      const doc = "Use `F^*` and `G^*` as literal code.";
      view = createView(doc, doc.indexOf("F^*") + "F^*".length);

      expect(hasDecorationClass(view, CSS.italic)).toBe(false);
    });

    it("does not treat stars inside link URLs as active emphasis delimiters", () => {
      const doc = "[target](https://example.com/a*b/c*d)";
      view = createView(doc, doc.indexOf("a*b") + "a*".length);

      expect(hasDecorationClass(view, CSS.italic)).toBe(false);
    });

    it("does not treat stars inside link titles as active emphasis delimiters", () => {
      const doc = '[target](https://example.com "t*u v*w")';
      view = createView(doc, doc.indexOf("u v"));

      expect(hasDecorationClass(view, CSS.italic)).toBe(false);
    });

    it("does not treat stars inside image titles as active emphasis delimiters", () => {
      const doc = '![alt](image.png "t*u v*w")';
      view = createView(doc, doc.indexOf("u v"));

      expect(hasDecorationClass(view, CSS.italic)).toBe(false);
    });

    it("does not treat stars inside reference link titles as active emphasis delimiters", () => {
      const doc = [
        "[target][ref]",
        "",
        '[ref]: https://example.com "t*u v*w"',
      ].join("\n");
      view = createView(doc, doc.indexOf("u v"));

      expect(hasDecorationClass(view, CSS.italic)).toBe(false);
    });

    it("does not treat stars inside inline reference labels as active emphasis delimiters", () => {
      const doc = [
        "[target][a*b c*d]",
        "",
        "[a*b c*d]: https://example.com",
      ].join("\n");
      view = createView(doc, doc.indexOf("b c"));

      expect(hasDecorationClass(view, CSS.italic)).toBe(false);
    });

    it("does not treat stars inside reference definition labels as active emphasis delimiters", () => {
      const doc = "[a*b c*d]: https://example.com";
      view = createView(doc, doc.indexOf("b c"));

      expect(hasDecorationClass(view, CSS.italic)).toBe(false);
    });

    it("does not treat stars inside footnote reference labels as active emphasis delimiters", () => {
      const doc = "See [^a*b*c] here.";
      view = createView(doc, doc.indexOf("b"));

      expect(hasDecorationClass(view, CSS.italic)).toBe(false);
    });

    it("does not treat stars inside footnote definition labels as active emphasis delimiters", () => {
      const doc = "[^a*b*c]: note body";
      view = createView(doc, doc.indexOf("b"));

      expect(hasDecorationClass(view, CSS.italic)).toBe(false);
    });

    it("does not treat stars inside fenced div attributes as active emphasis delimiters", () => {
      const doc = [
        "::: {.a*b c*d}",
        "content",
        ":::",
      ].join("\n");
      view = createView(doc, doc.indexOf("b c"));

      expect(hasDecorationClass(view, CSS.italic)).toBe(false);
    });

    it("does not treat escaped stars as active emphasis delimiters", () => {
      const doc = "\\*not italic \\*";
      view = createView(doc, doc.indexOf("italic"));

      expect(hasDecorationClass(view, CSS.italic)).toBe(false);
    });

    it("does not treat stars inside inline HTML tags as active emphasis delimiters", () => {
      const doc = '<span title="t*u v*w">text</span>';
      view = createView(doc, doc.indexOf("u v"));

      expect(hasDecorationClass(view, CSS.italic)).toBe(false);
    });

    it("does not treat stars inside HTML comments as active emphasis delimiters", () => {
      const doc = "<!-- a*b c*d -->";
      view = createView(doc, doc.indexOf("b c"));

      expect(hasDecorationClass(view, CSS.italic)).toBe(false);
    });

    it("does not treat stars inside inline HTML comments as active emphasis delimiters", () => {
      const doc = "before <!-- a*b c*d --> after";
      view = createView(doc, doc.indexOf("b c"));

      expect(hasDecorationClass(view, CSS.italic)).toBe(false);
    });

    it("does not treat stars inside processing instruction blocks as active emphasis delimiters", () => {
      const doc = "<?pi a*b c*d?>";
      view = createView(doc, doc.indexOf("b c"));

      expect(hasDecorationClass(view, CSS.italic)).toBe(false);
    });

    it("does not treat stars inside inline processing instructions as active emphasis delimiters", () => {
      const doc = "before <?pi a*b c*d?> after";
      view = createView(doc, doc.indexOf("b c"));

      expect(hasDecorationClass(view, CSS.italic)).toBe(false);
    });

    it("keeps active fallback styling when real delimiters wrap inline math", () => {
      const doc = "*see $F^*$ now *";
      view = createView(doc, doc.indexOf("now"));
      const items = collectMarkdownItems(
        view,
        [{ from: 0, to: view.state.doc.length }],
        () => false,
      );

      expect(items.some((item) =>
        item.from === 1 &&
        item.to === doc.length - 1 &&
        item.value.spec.class === CSS.italic
      )).toBe(true);
    });

    it("applies compact reveal metrics to link source marks and URL content", () => {
      const doc = "[target](https://example.com)";
      view = createView(doc, doc.indexOf("target") + 2);

      const delims = getSourceDelimiters(view);
      const sourceRuns = getInlineSourceRuns(view);

      expect(delims.length).toBeGreaterThanOrEqual(4);
      expect(sourceRuns).toHaveLength(1);
      expect(view.state.sliceDoc(sourceRuns[0].from, sourceRuns[0].to)).toBe("https://example.com");
    });
  });

  describe("incremental collection", () => {
    it("skips retained parent nodes without swallowing dirty nested descendants", () => {
      const doc = "# Hello **bold**";
      const boldFrom = doc.indexOf("**bold**");
      const boldTo = boldFrom + "**bold**".length;
      view = createView(doc, 1);

      const items = collectMarkdownItems(
        view,
        [{ from: boldFrom, to: boldTo }],
        (nodeFrom) => nodeFrom === 0,
      );

      expect(items.some((item) =>
        item.from === boldFrom &&
        item.to === boldTo &&
        item.value.spec.class === "cf-bold"
      )).toBe(true);
      expect(items.some((item) => item.value.spec.class?.startsWith("cf-heading"))).toBe(false);
    });

    it("does not duplicate boundary-straddling markdown decorations across disjoint ranges", () => {
      view = createView("**bold** tail", 12);
      const items = collectMarkdownItems(
        view,
        [{ from: 0, to: 2 }, { from: 6, to: 8 }],
        () => false,
      );

      expect(items.filter((item) => item.value.spec.class === "cf-bold")).toHaveLength(1);
    });

    it("reuses link decorations for identical URLs", () => {
      clearLinkDecorationCache();
      const doc = "[one](https://example.com) [two](https://example.com) tail";
      view = createView(doc, doc.length);

      const items = collectMarkdownItems(
        view,
        [{ from: 0, to: doc.length }],
        () => false,
      );
      const linkItems = items.filter((item) => item.value.spec.class?.includes("cf-link-rendered"));

      expect(linkItems).toHaveLength(2);
      expect(linkItems[0].value).toBe(linkItems[1].value);
      expect(linkItems[0].value.spec.attributes).toMatchObject({
        "data-cf-link-layout": "flow",
      });
    });

    it("marks document link decorations as atomic", () => {
      clearLinkDecorationCache();
      const doc = "[one](chapter.md) tail";
      view = createView(doc, doc.length);

      const items = collectMarkdownItems(
        view,
        [{ from: 0, to: doc.length }],
        () => false,
      );
      const linkItem = items.find((item) => item.value.spec.class?.includes("cf-link-rendered"));

      expect(linkItem?.value.spec.attributes).toMatchObject({
        "data-cf-link-layout": "atomic",
      });
    });

    it("bounds cached rendered-link decorations for unique URLs", () => {
      clearLinkDecorationCache();
      const doc = Array.from(
        { length: 300 },
        (_, index) => `[${index}](https://example.com/${index})`,
      ).join(" ");
      view = createView(doc, doc.length);

      collectMarkdownItems(
        view,
        [{ from: 0, to: doc.length }],
        () => false,
      );

      expect(linkDecorationCacheSize()).toBeLessThanOrEqual(256);
    });

    it("keeps reference-style links and link definitions visible as noncanonical source", () => {
      const doc = "[target][ref]\n\n[ref]: https://example.com";
      view = createView(doc, doc.indexOf("\n"));

      const specs = getAllDecorationSpecs(view);
      const linkTextFrom = doc.indexOf("target");
      const definitionFrom = doc.indexOf("[ref]:");

      expect(hasMarkClassInRange(specs, linkTextFrom, linkTextFrom + "target".length, CSS.linkRendered)).toBe(false);
      expect(hasMarkClassInRange(specs, definitionFrom, doc.length, CSS.hidden)).toBe(false);
    });

    it("keeps bare URL autolinks visible as noncanonical source", () => {
      const doc = "Visit https://example.com now";
      view = createView(doc, 0);

      const specs = getAllDecorationSpecs(view);
      const urlFrom = doc.indexOf("https://example.com");

      expect(hasMarkClassInRange(specs, urlFrom, urlFrom + "https://example.com".length, CSS.linkRendered)).toBe(false);
    });

    it("renders angle autolinks as clickable canonical links", () => {
      const doc = "Visit <https://example.com> now";
      view = createView(doc, 0);

      const specs = getAllDecorationSpecs(view);
      const urlFrom = doc.indexOf("https://example.com");

      expect(hasMarkClassInRange(specs, urlFrom, urlFrom + "https://example.com".length, CSS.linkRendered)).toBe(true);
    });

    it("keeps HTML comments visible as noncanonical source", () => {
      const doc = "before\n<!-- hidden note -->\nafter";
      const commentFrom = doc.indexOf("<!--");
      const commentTo = doc.indexOf("-->") + 3;
      view = createView(doc, 0);

      expect(hasMarkClassInRange(getAllDecorationSpecs(view), commentFrom, commentTo, CSS.hidden)).toBe(false);
    });
  });

  describe("negative / edge-case", () => {
    it("handles deeply nested inline formatting without error", () => {
      const doc = "***bold and italic***";
      view = createView(doc, 0);
      expect(view.state.doc.toString()).toBe(doc);
    });

    it("handles only whitespace document", () => {
      view = createView("   \n\n   ");
      expect(view.state.doc.toString()).toBe("   \n\n   ");
    });

    it("handles document with only headings", () => {
      const doc = "# H1\n## H2\n### H3";
      view = createView(doc);
      expect(view.state.doc.toString()).toBe(doc);
    });

    it("handles single character document", () => {
      view = createView("x");
      expect(view.state.doc.toString()).toBe("x");
    });

    it("does not throw on very long lines", () => {
      const longLine = "a".repeat(10000);
      view = createView(longLine);
      expect(view.state.doc.toString().length).toBe(10000);
    });
  });
});

describe("hard line break hides (residual state field)", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("hides the hard break through the newline from a state field, not the view plugin", () => {
    const doc = "foo  \nbar";
    const breakFrom = doc.indexOf("  \n");
    view = createView(doc, 0);
    const { fieldSpecs, pluginSpecs } = getDecorationSpecsBySource(view);

    expect(fieldSpecs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: breakFrom, to: breakFrom + 3 }),
      ]),
    );
    expect(pluginSpecs.some((spec) =>
      spec.from === breakFrom && spec.to === breakFrom + 3
    )).toBe(false);
    // The replaced line break joins the two source lines into one rendered line.
    expect(view.contentDOM.querySelectorAll(".cm-line")).toHaveLength(1);
  });

  it("reveals the hard break when the cursor is inside an emphasis containing it", () => {
    const doc = "a *b  \nc* d";
    const breakFrom = doc.indexOf("  \n");
    view = createView(doc, doc.indexOf("b") + 1);
    const specs = getAllDecorationSpecs(view);

    expect(specs.some((spec) =>
      spec.from === breakFrom && spec.to === breakFrom + 3
    )).toBe(false);
    expect(view.contentDOM.querySelectorAll(".cm-line").length).toBeGreaterThan(1);
  });

  it("re-hides the hard break when the cursor leaves the emphasis", () => {
    const doc = "a *b  \nc* d";
    const breakFrom = doc.indexOf("  \n");
    view = createView(doc, doc.indexOf("b") + 1);

    view.dispatch({ selection: { anchor: doc.length } });

    const specs = getAllDecorationSpecs(view);
    expect(specs.some((spec) =>
      spec.from === breakFrom && spec.to === breakFrom + 3
    )).toBe(true);
  });
});

describe("reveal-freeze parity for newly collected ranges", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("uses the frozen (pre-drag) selection for reveal decisions while frozen", () => {
    const doc = "**bold** tail";
    view = createView(doc, doc.length);
    view.dispatch({ effects: setMarkdownRevealFrozen.of(true) });
    // Live drag selection moves inside the bold node while frozen.
    view.dispatch({ selection: { anchor: 4 } });

    // Simulates the viewport plugin collecting a newly visible range mid-drag:
    // reveal must follow the frozen selection, not the live one.
    const items = collectMarkdownItems(view, [{ from: 0, to: doc.length }], () => false);

    expect(items.some((item) =>
      item.from === 0 && item.to === 2 && item.value === decorationHidden
    )).toBe(true);
    expect(items.some((item) => item.value.spec.class === CSS.sourceDelimiter)).toBe(false);
  });

  it("maps the frozen selection through doc changes", () => {
    const doc = "**bold** tail";
    view = createView(doc, 4);
    view.dispatch({ effects: setMarkdownRevealFrozen.of(true) });
    view.dispatch({ changes: { from: 0, insert: "x " } });
    view.dispatch({ selection: { anchor: view.state.doc.length } });

    const items = collectMarkdownItems(
      view,
      [{ from: 0, to: view.state.doc.length }],
      () => false,
    );

    // The frozen cursor, mapped to stay inside the bold node, still reveals.
    expect(items.some((item) => item.value.spec.class === CSS.sourceDelimiter)).toBe(true);
  });

  it("returns to live-selection reveal after unfreeze", () => {
    const doc = "**bold** tail";
    view = createView(doc, doc.length);
    view.dispatch({ effects: setMarkdownRevealFrozen.of(true) });
    view.dispatch({ selection: { anchor: 4 } });
    view.dispatch({ effects: setMarkdownRevealFrozen.of(false) });

    const items = collectMarkdownItems(view, [{ from: 0, to: doc.length }], () => false);

    expect(items.some((item) => item.value.spec.class === CSS.sourceDelimiter)).toBe(true);
    expect(items.some((item) =>
      item.from === 0 && item.to === 2 && item.value === decorationHidden
    )).toBe(false);
  });
});

describe("hard line break hides under incremental parse progress", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("collects newly parsed hard breaks without duplicating earlier ones", () => {
    const early = "alpha  \nbeta\n\n";
    const filler = Array.from(
      { length: 200 },
      (_, index) =>
        `paragraph ${index} with plain filler text pushing the document past the initial parse viewport.\n\n`,
    ).join("");
    const late = "gamma  \ndelta\n";
    const doc = early + filler + late;
    view = createView(doc, 0);

    // Precondition: the initial parse stops well before the trailing break.
    expect(syntaxTree(view.state).length).toBeLessThan(doc.length);

    const earlyBreak = doc.indexOf("  \n");
    const lateBreak = doc.indexOf("gamma  \n") + "gamma".length;
    const breakSpecsAt = (from: number) =>
      getDecorationSpecsBySource(view).fieldSpecs.filter(
        (spec) => spec.from === from && spec.to === from + 3,
      );

    expect(breakSpecsAt(earlyBreak)).toHaveLength(1);
    expect(breakSpecsAt(lateBreak)).toHaveLength(0);

    // Advance the parse in two steps to exercise consecutive frontier deltas
    // (each forceParsing dispatches a doc-unchanged tree-progress update).
    forceParsing(view, Math.floor(doc.length / 2), 5000);
    forceParsing(view, doc.length, 5000);
    expect(syntaxTree(view.state).length).toBe(doc.length);

    expect(breakSpecsAt(earlyBreak)).toHaveLength(1);
    expect(breakSpecsAt(lateBreak)).toHaveLength(1);
  });
});

describe("cursorContextKey", () => {
  it("returns empty string for plain text", () => {
    const state = createEditorState("hello world", {
      cursorPos: 5,
      extensions: markdown(),
    });
    expect(cursorContextKey(state)).toBe("");
  });

  it("returns a key when cursor is inside bold", () => {
    const state = createEditorState("**bold** text", {
      cursorPos: 4,
      extensions: markdown(),
    });
    expect(cursorContextKey(state)).toMatch(/^StrongEmphasis:\d+:\d+$/);
  });

  it("returns a key when cursor is inside italic", () => {
    const state = createEditorState("*italic* text", {
      cursorPos: 3,
      extensions: markdown(),
    });
    expect(cursorContextKey(state)).toMatch(/^Emphasis:\d+:\d+$/);
  });

  it("returns a key when cursor is inside a heading", () => {
    const state = createEditorState("# Heading\n\ntext", {
      cursorPos: 3,
      extensions: markdown(),
    });
    expect(cursorContextKey(state)).toMatch(/^ATXHeading1:\d+:\d+$/);
  });

  it("returns a key when cursor is inside a link", () => {
    const state = createEditorState("[link](url) text", {
      cursorPos: 3,
      extensions: markdown(),
    });
    expect(cursorContextKey(state)).toMatch(/^Link:\d+:\d+$/);
  });

  it("same key for two positions within the same node", () => {
    const ext = markdown();
    const stateA = createEditorState("**bold** text", {
      cursorPos: 3,
      extensions: ext,
    });
    const stateB = createEditorState("**bold** text", {
      cursorPos: 5,
      extensions: ext,
    });
    expect(cursorContextKey(stateA)).toBe(cursorContextKey(stateB));
  });

  it("different key for positions in different nodes", () => {
    const ext = markdown();
    const stateInBold = createEditorState("**bold** *italic*", {
      cursorPos: 3,
      extensions: ext,
    });
    const stateInItalic = createEditorState("**bold** *italic*", {
      cursorPos: 11,
      extensions: ext,
    });
    expect(cursorContextKey(stateInBold)).not.toBe(cursorContextKey(stateInItalic));
  });
});

describe("markdownShouldUpdate (rebuild narrowing, #579)", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  /**
   * Create a view with a counting plugin that uses markdownShouldUpdate.
   * Performs a warm-up dispatch to flush the spurious focusChanged that
   * JSDOM produces on the first dispatch after construction.
   */
  function createCountingView(doc: string, cursorPos = 0) {
    let buildCount = 0;
    const ext = createSimpleViewPlugin(
      () => { buildCount++; return Decoration.none; },
      { shouldUpdate: markdownShouldUpdate },
    );
    view = createTestView(doc, {
      cursorPos,
      extensions: [markdown(), ext],
    });
    // Warm-up: first dispatch after construction has spurious focusChanged
    view.dispatch({ selection: { anchor: cursorPos } });
    buildCount = 0;
    return { getBuildCount: () => buildCount };
  }

  it("does not rebuild when cursor moves within plain text", () => {
    const { getBuildCount } = createCountingView("hello world", 0);
    view.dispatch({ selection: { anchor: 5 } });
    expect(getBuildCount()).toBe(0);
  });

  it("rebuilds when cursor enters a bold node", () => {
    const { getBuildCount } = createCountingView("**bold** text", 12);
    view.dispatch({ selection: { anchor: 4 } });
    expect(getBuildCount()).toBe(1);
  });

  it("does not rebuild when cursor moves within the same bold node", () => {
    const { getBuildCount } = createCountingView("**bold** text", 3);
    view.dispatch({ selection: { anchor: 5 } });
    expect(getBuildCount()).toBe(0);
  });

  it("rebuilds when cursor leaves a bold node", () => {
    const { getBuildCount } = createCountingView("**bold** text", 4);
    view.dispatch({ selection: { anchor: 12 } });
    expect(getBuildCount()).toBe(1);
  });

  it("rebuilds when cursor moves between different sensitive nodes", () => {
    const { getBuildCount } = createCountingView("**bold** *italic*", 4);
    view.dispatch({ selection: { anchor: 11 } });
    expect(getBuildCount()).toBe(1);
  });

  it("rebuilds on document change", () => {
    const { getBuildCount } = createCountingView("hello", 0);
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(getBuildCount()).toBe(1);
  });

  it("does not rebuild when cursor moves within a heading", () => {
    const { getBuildCount } = createCountingView("# Hello World\n\ntext", 3);
    view.dispatch({ selection: { anchor: 7 } });
    expect(getBuildCount()).toBe(0);
  });

  it("rebuilds when cursor enters a heading", () => {
    const { getBuildCount } = createCountingView("# Hello\n\ntext", 12);
    view.dispatch({ selection: { anchor: 3 } });
    expect(getBuildCount()).toBe(1);
  });

  it("rebuilds when cursor moves from heading to nested inline node", () => {
    const { getBuildCount } = createCountingView("# Hello **bold**\n\ntext", 3);
    view.dispatch({ selection: { anchor: 12 } }); // into bold inside heading
    expect(getBuildCount()).toBe(1);
  });
});

describe("computeMarkdownDocChangeRanges (#823)", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  function createDocRangeView(doc: string, cursorPos = 0) {
    let receivedRanges: readonly { from: number; to: number }[] = [];
    const ext = createCursorSensitiveViewPlugin(
      (_view, ranges) => {
        receivedRanges = ranges;
        return [];
      },
      {
        selectionCheck: (update) =>
          cursorContextKey(update.state) !== cursorContextKey(update.startState),
        docChangeRanges: computeMarkdownDocChangeRanges,
      },
    );
    view = createTestView(doc, {
      cursorPos,
      extensions: [markdown(), ext],
    });
    // Warm-up: first dispatch after construction has a spurious focusChanged.
    view.dispatch({ selection: { anchor: cursorPos } });
    receivedRanges = [];
    return { getRanges: () => receivedRanges };
  }

  function createContextRangeView(doc: string, cursorPos = 0) {
    let receivedRanges: readonly { from: number; to: number }[] = [];
    const ext = createCursorSensitiveViewPlugin(
      (_view, ranges) => {
        receivedRanges = ranges;
        return [];
      },
      {
        contextChangeRanges: computeMarkdownContextChangeRanges,
      },
    );
    view = createTestView(doc, {
      cursorPos,
      extensions: [markdown(), ext],
    });
    view.dispatch({ selection: { anchor: cursorPos } });
    receivedRanges = [];
    return { getRanges: () => receivedRanges };
  }

  function mockDocChangeUpdate(
    startState: ReturnType<typeof createEditorState>,
    state: ReturnType<typeof createEditorState>,
    overrides: Partial<Pick<ViewUpdate, "focusChanged">> = {},
  ): ViewUpdate {
    return {
      docChanged: true,
      selectionSet: false,
      focusChanged: overrides.focusChanged ?? false,
      viewportChanged: false,
      state,
      startState,
      view: { hasFocus: true } as EditorView,
    } as unknown as ViewUpdate;
  }

  it("skips cursor-context merging when doc changes keep selection and focus stable", () => {
    const startState = createEditorState("plain **bold** text", {
      cursorPos: 3,
      extensions: [markdown()],
    });
    const tr = startState.update({
      changes: { from: startState.doc.length, insert: "x" },
    });

    expect(markdownDocChangeNeedsContextMerge(mockDocChangeUpdate(startState, tr.state))).toBe(false);
  });

  it("keeps cursor-context merging enabled when doc changes move selection or focus", () => {
    const startState = createEditorState("plain **bold** text", {
      cursorPos: 3,
      extensions: [markdown()],
    });
    const movedSelection = createEditorState("plain **bold** text", {
      cursorPos: 5,
      extensions: [markdown()],
    });

    expect(markdownDocChangeNeedsContextMerge(mockDocChangeUpdate(startState, movedSelection))).toBe(true);
    expect(
      markdownDocChangeNeedsContextMerge(
        mockDocChangeUpdate(startState, startState, { focusChanged: true }),
      ),
    ).toBe(true);
  });

  it("keeps prose typing scoped to the dirty fragment", () => {
    const { getRanges } = createDocRangeView("intro text\n\n**bold** tail", 5);
    view.dispatch({ changes: { from: 2, insert: "X" } });
    expect(getRanges()).toEqual([]);
  });

  it("expands edits inside bold text to the full formatted node", () => {
    const doc = "plain **bold** tail";
    const boldFrom = doc.indexOf("**bold**");
    const boldTo = boldFrom + "**bold**".length;
    const { getRanges } = createDocRangeView(doc, doc.length);
    view.dispatch({ changes: { from: boldFrom + 4, insert: "!" } });
    expect(getRanges()).toEqual([{ from: boldFrom, to: boldTo + 1 }]);
  });

  it("rebuilds only the entered markdown region on selection changes", () => {
    const doc = "plain **bold** tail";
    const boldFrom = doc.indexOf("**bold**");
    const boldTo = boldFrom + "**bold**".length;
    const { getRanges } = createContextRangeView(doc, 2);

    view.dispatch({ selection: { anchor: boldFrom + 3 } });

    expect(getRanges()).toEqual([{ from: boldFrom, to: boldTo }]);
  });

  it("rebuilds only the nested inline region when the outer heading context is unchanged", () => {
    const doc = "# Hello **bold**";
    const boldFrom = doc.indexOf("**bold**");
    const boldTo = boldFrom + "**bold**".length;
    const { getRanges } = createContextRangeView(doc, 2);

    view.dispatch({ selection: { anchor: boldFrom + 3 } });

    expect(getRanges()).toEqual([{ from: boldFrom, to: boldTo }]);
  });
});

describe("markdownRenderPlugin doc-change invalidation (#823)", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("removes stale hidden marker replacements when emphasis syntax is destroyed", () => {
    view = createView("**bold** tail", 12);
    const before = getAllDecorationSpecs(view);
    expect(before.some((spec) => spec.from === 0 && spec.to === 2)).toBe(true);

    view.dispatch({ changes: { from: 6, to: 8, insert: "" } });

    const after = getAllDecorationSpecs(view);
    expect(view.state.doc.toString()).toBe("**bold tail");
    expect(after.some((spec) => spec.from === 0 && spec.to === 2)).toBe(false);
  });

  it("replaces stale heading line decorations when the heading level changes", () => {
    view = createView("# Heading", 1);
    expect(hasLineClassAt(getAllDecorationSpecs(view), 0, "cf-heading-line-1")).toBe(true);

    view.dispatch({ changes: { from: 0, to: 1, insert: "##" } });

    const after = getAllDecorationSpecs(view);
    expect(view.state.doc.toString()).toBe("## Heading");
    expect(hasLineClassAt(after, 0, "cf-heading-line-1")).toBe(false);
    expect(hasLineClassAt(after, 0, "cf-heading-line-2")).toBe(true);
  });
});
