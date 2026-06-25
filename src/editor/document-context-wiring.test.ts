import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  documentContextFacet,
} from "./document-context";
import type {
  CitationFormatter,
  LinkResolver,
  RefResolver,
} from "../core/document-context-types";
import { documentPathFacet } from "./lib/types";
import { isBareDocumentAnchor } from "./render/link-handler";
import { renderPreviewBlockContentToDom } from "./render/preview-block-renderer";
import {
  collectReferenceRanges,
  planReferenceRendering,
} from "./render/reference-render";
import {
  createView,
  store,
} from "./render/reference-render-test-utils";
import { bibDataEffect, bibDataField } from "./state/bib-data";
import { mountEditor } from "../../editor";

/**
 * DocumentContext wiring: with no host resolver, behavior is unchanged
 * (verified across the existing 2700+ tests). With a resolver, the
 * editor consults it with the documented carve-outs.
 */

function withResolver(view: EditorView, refResolver?: RefResolver): EditorView {
  view.dispatch({
    effects: StateEffect.appendConfig.of(
      documentContextFacet.of(refResolver ? { refResolver } : {}),
    ),
  });
  return view;
}

function fakeNumericFormatter(ids: readonly string[]): CitationFormatter {
  const numbers = new Map(ids.map((id, index) => [id, index + 1]));
  let citationRegistrationKey: string | null = null;
  return {
    cite(citedIds, locators) {
      if (!citationRegistrationKey) return "[unregistered]";
      return `[${citedIds.map((id, index) => {
        const label = String(numbers.get(id) ?? id);
        return locators[index] ? `${label}, ${locators[index]}` : label;
      }).join(", ")}]`;
    },
    citeNarrative(id) {
      return `${id} [${numbers.get(id) ?? id}]`;
    },
    bibliographyEntries() {
      return [];
    },
    registerCitations(clusters) {
      citationRegistrationKey = clusters
        .map((cluster) => cluster.ids.join(","))
        .join(";");
    },
    get citationRegistrationKey() {
      return citationRegistrationKey;
    },
    revision: 1,
  };
}

describe("documentContextFacet — LinkResolver wiring", () => {
  it("default facet has no linkResolver", () => {
    const state = EditorState.create({
      doc: "x",
      extensions: [documentPathFacet.of("posts/note.md")],
    });
    expect(state.facet(documentContextFacet).linkResolver).toBeUndefined();
  });

  it("bare same-document anchors are short-circuited before resolver is consulted", () => {
    expect(isBareDocumentAnchor("#eq:foo")).toBe(true);
    expect(isBareDocumentAnchor("./other.md")).toBe(false);
    expect(isBareDocumentAnchor("https://x.example/")).toBe(false);
  });

  it("resolver receives (href, text, { from: documentPath })", () => {
    const calls: Array<{ href: string; text: string; from?: string }> = [];
    const resolver: LinkResolver = {
      resolve(href, text, env) {
        calls.push({ href, text, from: env.from });
        return { className: "host-link", title: "tip" };
      },
    };
    const state = EditorState.create({
      doc: "",
      extensions: [
        documentPathFacet.of("posts/note.md"),
        documentContextFacet.of({ linkResolver: resolver }),
      ],
    });
    const ctx = state.facet(documentContextFacet);
    const from = state.facet(documentPathFacet) || undefined;
    const r = ctx.linkResolver?.resolve?.("./other.md", "docs", { from });
    expect(r?.className).toBe("host-link");
    expect(r?.title).toBe("tip");
    expect(calls[0]).toEqual({ href: "./other.md", text: "docs", from: "posts/note.md" });
  });
});

describe("mountEditor document context bibliography bridge", () => {
  it("renders editor References from host citation context", () => {
    const parent = document.body.appendChild(document.createElement("div"));
    const formatter = fakeNumericFormatter(["karger2000"]);
    const editor = mountEditor({
      parent,
      doc: [
        "Body with a note[^n].",
        "",
        "[^n]: Footnote cites [@karger2000].",
      ].join("\n"),
      context: {
        citationKeys: new Set(["karger2000"]),
        citationFormatter: {
          ...formatter,
          bibliographyEntries: () => [{
            id: "karger2000",
            html: "<div>Karger paper.</div>",
          }],
        },
      },
      sidenotesCollapsed: true,
    });

    expect(parent.querySelector(".cf-bibliography")?.textContent).toContain("References");
    expect(parent.querySelector(".cf-bibliography")?.textContent).toContain("Karger paper.");
    editor.unmount();
  });
});

describe("documentContextFacet — RefResolver wiring through planReferenceRendering", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  function plan(doc: string, resolver?: RefResolver) {
    view = createView(doc, doc.length);
    if (resolver) withResolver(view, resolver);
    const { formatter } = view.state.field(bibDataField);
    return planReferenceRendering(view, store, formatter);
  }

  function findAt(items: ReturnType<typeof plan>, raw: string) {
    return items.find((it) => view?.state.sliceDoc(it.from, it.to) === raw);
  }

  it("no resolver: bracketed bibliography key stays on unresolved crossref path", () => {
    const items = plan("See [@karger2000].");
    expect(findAt(items, "[@karger2000]")?.kind).toBe("unresolved");
  });

  it("bracketed single-key reference routes through host resolver", () => {
    const calls: Array<{ key: string; mode: string }> = [];
    const resolver: RefResolver = {
      resolve(key, mode) {
        calls.push({ key, mode });
        return {
          content: `<i>${key}</i>`,
          href: `/page/${key}`,
          className: "page-ref",
        };
      },
    };
    const items = plan("See [@some-page].", resolver);
    const item = findAt(items, "[@some-page]");
    expect(item?.kind).toBe("host-ref");
    if (item?.kind !== "host-ref") return;
    expect(item.key).toBe("some-page");
    expect(item.mode).toBe("bracketed");
    expect(item.href).toBe("/page/some-page");
    expect(item.className).toBe("page-ref");
    expect(item.html).toContain("<i>");
    expect(calls).toEqual([{ key: "some-page", mode: "bracketed" }]);
  });

  it("narrative @key calls resolver with mode=\"narrative\"", () => {
    const resolver: RefResolver = {
      resolve: (key, mode) => (mode === "narrative" ? { content: key } : null),
    };
    const items = plan("See @some-page here.", resolver);
    const item = findAt(items, "@some-page");
    expect(item?.kind).toBe("host-ref");
    if (item?.kind === "host-ref") expect(item.mode).toBe("narrative");
  });

  it("cross-ref shapes never reach the host resolver", () => {
    let called = false;
    const resolver: RefResolver = {
      resolve() {
        called = true;
        return { content: "should not appear" };
      },
    };
    const doc = [
      "::: {.theorem #thm-main}",
      "Statement.",
      ":::",
      "",
      "See [@thm-main].",
    ].join("\n");
    const items = plan(doc, resolver);
    expect(findAt(items, "[@thm-main]")?.kind).toBe("crossref");
    expect(called).toBe(false);
  });

  it("resolver returning null falls through to unresolved crossref path", () => {
    const resolver: RefResolver = { resolve: () => null };
    const items = plan("See [@karger2000].", resolver);
    expect(findAt(items, "[@karger2000]")?.kind).toBe("unresolved");
  });

  it("multi-key clusters and locator-bearing refs receive resolver metadata", () => {
    const calls: Array<{
      key: string;
      locator?: string;
      ids?: readonly string[];
      index?: number;
      raw?: string;
      sourceRange?: { from: number; to: number };
      surface?: string;
    }> = [];
    const resolver: RefResolver = {
      resolve(key, _mode, env) {
        calls.push({
          key,
          locator: env?.locator,
          ids: env?.cluster?.ids,
          index: env?.cluster?.index,
          raw: env?.raw,
          sourceRange: env?.sourceRange,
          surface: env?.surface,
        });
        return { content: `<span>${key}</span>` };
      },
    };
    const items = plan("See [@some-page, p. 3; @other-page].", resolver);
    const item = findAt(items, "[@some-page, p. 3; @other-page]");
    expect(item?.kind).toBe("host-ref");
    expect(calls).toEqual([
      {
        key: "some-page",
        locator: "p. 3",
        ids: ["some-page", "other-page"],
        index: 0,
        raw: "[@some-page, p. 3; @other-page]",
        sourceRange: { from: 4, to: 35 },
        surface: "editor",
      },
      {
        key: "other-page",
        locator: undefined,
        ids: ["some-page", "other-page"],
        index: 1,
        raw: "[@some-page, p. 3; @other-page]",
        sourceRange: { from: 4, to: 35 },
        surface: "editor",
      },
    ]);
  });

  it("all-citation clusters use DocumentContext citation keys before the host resolver", () => {
    const doc = "See [@deKosterLR07; @BoysenKW19].";
    view = createView(doc, doc.length);
    const formatter = fakeNumericFormatter(["deKosterLR07", "BoysenKW19"]);
    let resolverCalls = 0;

    view.dispatch({
      effects: [
        bibDataEffect.of({ store, formatter: null }),
        StateEffect.appendConfig.of(
          documentContextFacet.of({
            citationFormatter: formatter,
            citationKeys: new Set(["deKosterLR07", "BoysenKW19"]),
            refResolver: {
              resolve(key) {
                resolverCalls += 1;
                return { content: formatter.cite([key], []) };
              },
            },
          }),
        ),
      ],
    });

    const { formatter: fieldFormatter } = view.state.field(bibDataField);
    const ranges = collectReferenceRanges(view, store, fieldFormatter);
    const range = ranges.find(
      (it) => view?.state.sliceDoc(it.from, it.to) === "[@deKosterLR07; @BoysenKW19]",
    );
    const widget = range?.value.spec.widget;

    expect(widget?.constructor.name).toBe("CitationWidget");
    expect((widget?.toDOM() as HTMLElement | undefined)?.textContent).toBe("[1, 2]");
    expect(formatter.citationRegistrationKey).not.toBeNull();
    expect(resolverCalls).toBe(0);
  });

  it("mixed local crossref and host refs render through one supported cluster path", () => {
    const resolver: RefResolver = {
      resolve(key) {
        return key === "host-page" ? { content: "Host Page" } : null;
      },
    };
    const doc = [
      "::: {.theorem #thm-main}",
      "Statement.",
      ":::",
      "",
      "See [@thm-main; @host-page].",
    ].join("\n");
    const items = plan(doc, resolver);
    const item = findAt(items, "[@thm-main; @host-page]");
    expect(item?.kind).toBe("host-ref");
    if (item?.kind !== "host-ref") return;
    expect(item.html).toContain("Theorem 1");
    expect(item.html).toContain("Host Page");
  });

  it("sanitizer strips dangerous content from resolver HTML", () => {
    const resolver: RefResolver = {
      resolve: () => ({
        content: `<i>ok</i><script>alert(1)</script><a href="javascript:bad()">x</a>`,
      }),
    };
    const items = plan("See [@safe].", resolver);
    const item = findAt(items, "[@safe]");
    expect(item?.kind).toBe("host-ref");
    if (item?.kind !== "host-ref") return;
    expect(item.html).toContain("<i>ok</i>");
    expect(item.html).not.toContain("<script");
    expect(item.html).not.toContain("javascript:");
  });
});

describe("default unresolved reference rendering — no formatter, no resolver", () => {
  function planWithoutFormatter(doc: string, resolver?: RefResolver) {
    const view = createView(doc, doc.length);
    // Drop the test-utils-attached formatter; unresolved references should
    // stay on the crossref path by default.
    view.dispatch({
      effects: bibDataEffect.of({ store, formatter: null }),
    });
    if (resolver) {
      view.dispatch({
        effects: StateEffect.appendConfig.of(
          documentContextFacet.of({ refResolver: resolver }),
        ),
      });
    }
    const { formatter } = view.state.field(bibDataField);
    return {
      items: planReferenceRendering(view, store, formatter),
      view,
    };
  }

  it("bracketed single-key reference emits an unresolved crossref item", () => {
    const { items, view } = planWithoutFormatter("See [@karger2000].");
    const item = items.find(
      (it) => view.state.sliceDoc(it.from, it.to) === "[@karger2000]",
    );
    expect(item).toMatchObject({
      kind: "unresolved",
      raw: "[@karger2000]",
    });
    view.destroy();
  });

  it("narrative @key reference emits an unresolved crossref item", () => {
    const { items, view } = planWithoutFormatter("See @karger2000 here.");
    const item = items.find(
      (it) => view.state.sliceDoc(it.from, it.to) === "@karger2000",
    );
    expect(item).toMatchObject({
      kind: "unresolved",
      raw: "@karger2000",
    });
    view.destroy();
  });

  it("multi-key cluster stays on the clustered crossref path", () => {
    const { items, view } = planWithoutFormatter(
      "See [@karger2000; @stein2001].",
    );
    const item = items.find(
      (it) =>
        view.state.sliceDoc(it.from, it.to) === "[@karger2000; @stein2001]",
    );
    expect(item).toMatchObject({
      kind: "clustered-crossref",
      parts: [
        { id: "karger2000", text: "karger2000", unresolved: true },
        { id: "stein2001", text: "stein2001", unresolved: true },
      ],
    });
    view.destroy();
  });

  it("host RefResolver still wins over the degraded placeholder", () => {
    const resolver: RefResolver = {
      resolve: (key) => ({ content: `<i>${key}</i>`, className: "page-ref" }),
    };
    const { items, view } = planWithoutFormatter("See [@karger2000].", resolver);
    const item = items.find(
      (it) => view.state.sliceDoc(it.from, it.to) === "[@karger2000]",
    );
    expect(item?.kind).toBe("host-ref");
    if (item?.kind !== "host-ref") return;
    expect(item.className).toBe("page-ref");
    expect(item.html).toContain("<i>karger2000</i>");
    expect(item.html).not.toContain("cf-citation-unresolved");
    view.destroy();
  });
});

describe("DocumentContext wiring through rich preview widgets", () => {
  it("preview citation clusters use DocumentContext citation keys before the host resolver", () => {
    const formatter = fakeNumericFormatter(["deKosterLR07", "BoysenKW19"]);
    let resolverCalls = 0;
    const container = document.createElement("div");

    renderPreviewBlockContentToDom(
      container,
      "See [@deKosterLR07; @BoysenKW19].",
      {
        documentContext: {
          citationFormatter: formatter,
          citationKeys: new Set(["deKosterLR07", "BoysenKW19"]),
          refResolver: {
            resolve(key) {
              resolverCalls += 1;
              return { content: formatter.cite([key], []) };
            },
          },
        },
      },
    );

    expect(container.textContent).toContain("See [1, 2].");
    expect(container.textContent).not.toContain("[1]; [2]");
    expect(resolverCalls).toBe(0);
  });

  it("table cell preview rendering consumes host RefResolver and LinkResolver", () => {
    const container = document.createElement("div");
    renderPreviewBlockContentToDom(
      container,
      "| Ref | Link |\n| --- | --- |\n| [@host-page] | [docs](./docs.md) |",
      {
        documentPath: "notes/current.md",
        documentContext: {
          refResolver: {
            resolve: (key, _mode, env) => ({
              content: `<strong>${key}:${env?.surface}</strong>`,
            }),
          },
          linkResolver: {
            resolve: (href, _text, env) => ({
              href: `/resolved/${href}`,
              className: `from-${env.from?.replace(/[/.]/g, "-")}`,
            }),
          },
        },
      },
    );

    expect(container.querySelector("td")?.innerHTML).toContain("host-page:editor-widget");
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/resolved/./docs.md");
    expect(link?.className).toContain("from-notes-current-md");
  });
});
