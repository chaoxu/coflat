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
  });

  it("shows multiple ids in aria-label", () => {
    const widget = new CitationWidget("(Karger, 2000; Stein, 2001)", [
      "karger2000",
      "stein2001",
    ]);
    const el = widget.toDOM();
    expect(el.getAttribute("aria-label")).toBe("karger2000; stein2001");
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
