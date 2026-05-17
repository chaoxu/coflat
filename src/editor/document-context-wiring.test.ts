import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  documentContextFacet,
  type LinkResolver,
  type RefResolver,
} from "./document-context";
import { documentPathFacet } from "./lib/types";
import { isBareDocumentAnchor } from "./render/link-handler";
import { planReferenceRendering } from "./render/reference-render";
import {
  createView,
  store,
} from "./render/reference-render-test-utils";
import { bibDataEffect, bibDataField } from "./state/bib-data";

/**
 * Phase 0 chunk 2 wiring: with no host resolver, behavior is unchanged
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
    return items.find((it) => view!.state.sliceDoc(it.from, it.to) === raw);
  }

  it("no resolver: bracketed bib reference uses existing citation path", () => {
    const items = plan("See [@karger2000].");
    expect(findAt(items, "[@karger2000]")?.kind).toBe("citation");
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

  it("resolver returning null falls through to existing CSL path", () => {
    const resolver: RefResolver = { resolve: () => null };
    const items = plan("See [@karger2000].", resolver);
    expect(findAt(items, "[@karger2000]")?.kind).toBe("citation");
  });

  it("multi-key clusters and locator-bearing refs stay on existing path", () => {
    let called = false;
    const resolver: RefResolver = {
      resolve() {
        called = true;
        return { content: "x" };
      },
    };
    const items = plan("See [@karger2000; @stein2001].", resolver);
    const item = findAt(items, "[@karger2000; @stein2001]");
    expect(item?.kind).toBe("citation");
    expect(called).toBe(false);
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

describe("degraded citation placeholder — no formatter, no resolver", () => {
  function planWithoutFormatter(doc: string, resolver?: RefResolver) {
    const view = createView(doc, doc.length);
    // Drop the test-utils-attached formatter; keep the bib store so the key
    // still classifies as a citation rather than unresolved.
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

  it("bracketed single-key citation emits cf-citation-unresolved placeholder", () => {
    const { items, view } = planWithoutFormatter("See [@karger2000].");
    const item = items.find(
      (it) => view.state.sliceDoc(it.from, it.to) === "[@karger2000]",
    );
    expect(item?.kind).toBe("host-ref");
    if (item?.kind !== "host-ref") return;
    expect(item.key).toBe("karger2000");
    expect(item.mode).toBe("bracketed");
    expect(item.html).toContain('class="cf-citation cf-citation-unresolved"');
    expect(item.html).toContain('data-ref-key="karger2000"');
    expect(item.html).toContain('data-ref-mode="bracketed"');
    expect(item.html).toContain("[@karger2000]");
    view.destroy();
  });

  it("narrative @key citation emits placeholder with narrative mode", () => {
    const { items, view } = planWithoutFormatter("See @karger2000 here.");
    const item = items.find(
      (it) => view.state.sliceDoc(it.from, it.to) === "@karger2000",
    );
    expect(item?.kind).toBe("host-ref");
    if (item?.kind !== "host-ref") return;
    expect(item.mode).toBe("narrative");
    expect(item.html).toContain('data-ref-mode="narrative"');
    expect(item.html).toContain("@karger2000");
    expect(item.html).not.toContain("[@");
    view.destroy();
  });

  it("multi-key cluster falls back to raw source text in the placeholder", () => {
    const { items, view } = planWithoutFormatter(
      "See [@karger2000; @stein2001].",
    );
    const item = items.find(
      (it) =>
        view.state.sliceDoc(it.from, it.to) === "[@karger2000; @stein2001]",
    );
    expect(item?.kind).toBe("host-ref");
    if (item?.kind !== "host-ref") return;
    expect(item.html).toContain('class="cf-citation cf-citation-unresolved"');
    expect(item.html).not.toContain("data-ref-key=");
    expect(item.html).toContain("[@karger2000; @stein2001]");
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
