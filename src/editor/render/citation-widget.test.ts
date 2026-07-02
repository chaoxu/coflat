import { describe, expect, it } from "vitest";

import { CSS, hostReferenceClassNames } from "../../core/constants/css-classes";
import { CitationWidget, HostRefWidget } from "./citation-widget";

describe("CitationWidget", () => {
  it("creates a span with citation text", () => {
    const widget = new CitationWidget("(Karger, 2000)", ["karger2000"]);
    const el = widget.toDOM();
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toBe(CSS.citation);
    expect(el.textContent).toBe("(Karger, 2000)");
    expect(el.getAttribute("aria-label")).toBe("karger2000");
    expect(el.getAttribute("data-ref-key")).toBe("karger2000");
    expect(el.getAttribute("data-ref-mode")).toBe("bracketed");
  });

  it("shows multiple ids in aria-label", () => {
    const widget = new CitationWidget("(Karger, 2000; Stein, 2001)", [
      "karger2000",
      "stein2001",
    ]);
    const el = widget.toDOM();
    expect(el.getAttribute("aria-label")).toBe("karger2000; stein2001");
    expect(el.getAttribute("data-ref-key")).toBe("karger2000;stein2001");
  });

  it("marks narrative citations with narrative reference mode", () => {
    const widget = new CitationWidget("Karger (2000)", ["karger2000"], true);
    const el = widget.toDOM();
    expect(el.getAttribute("data-ref-key")).toBe("karger2000");
    expect(el.getAttribute("data-ref-mode")).toBe("narrative");
  });

  it("eq returns true for same text", () => {
    const a = new CitationWidget("(Karger, 2000)", ["karger2000"]);
    const b = new CitationWidget("(Karger, 2000)", ["karger2000"]);
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false for different text", () => {
    const a = new CitationWidget("(Karger, 2000)", ["karger2000"]);
    const b = new CitationWidget("(Stein, 2001)", ["stein2001"]);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false for same text with different ids", () => {
    const a = new CitationWidget("[1]", ["karger2000"]);
    const b = new CitationWidget("[1]", ["stein2001"]);
    expect(a.eq(b)).toBe(false);
  });
});

describe("HostRefWidget", () => {
  it("uses shared crossref classes by default", () => {
    expect(hostReferenceClassNames(undefined)).toBe(CSS.crossref);
    expect(hostReferenceClassNames("host-ref cf-crossref")).toBe(
      "cf-crossref host-ref",
    );

    const widget = new HostRefWidget("[1]", "karger2000", "bracketed", undefined, undefined, false);
    const el = widget.toDOM();
    expect(el.className).toBe(CSS.crossref);
    expect(el.getAttribute("aria-label")).toBe("karger2000");
  });

  it("does not reuse DOM when host reference classes change", () => {
    const base = new HostRefWidget("[1]", "karger2000", "bracketed", undefined, undefined, false);
    const themed = new HostRefWidget("[1]", "karger2000", "bracketed", undefined, "host-ref", false);
    expect(base.eq(themed)).toBe(false);
  });

  it("makes host-clickable references keyboard focusable", () => {
    const el = new HostRefWidget("local note", "local:la_aaaaaaaaaaaa", "bracketed", undefined, "cf-local-annotation", true).toDOM();
    expect(el.getAttribute("data-ref-resolver")).toBe("1");
    expect(el.getAttribute("tabindex")).toBe("0");
    expect(el.getAttribute("role")).toBe("button");
  });

  it("keeps host-clickable links focused through their anchor", () => {
    const el = new HostRefWidget("Chapter", "chapter", "bracketed", "chapter.md", "host-ref", true).toDOM();
    expect(el.getAttribute("data-ref-resolver")).toBe("1");
    expect(el.hasAttribute("tabindex")).toBe(false);
    expect(el.hasAttribute("role")).toBe(false);
    expect(el.querySelector("a")?.getAttribute("href")).toBe("chapter.md");
  });

  it("uses the shared link layout contract for host reference anchors", () => {
    const external = new HostRefWidget(
      "External",
      "host-page",
      "bracketed",
      "https://example.com/page",
      undefined,
      false,
    ).toDOM();
    expect(external.querySelector("a")?.getAttribute("data-cf-link-layout")).toBe("flow");

    const documentLink = new HostRefWidget(
      "Chapter",
      "chapter",
      "bracketed",
      "chapter.md",
      undefined,
      false,
    ).toDOM();
    expect(documentLink.querySelector("a")?.getAttribute("data-cf-link-layout")).toBe("atomic");
  });
});
