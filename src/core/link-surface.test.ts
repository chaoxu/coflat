import { describe, expect, it } from "vitest";
import {
  applyLinkSurface,
  linkSurfaceClassNames,
  renderedLinkDecorationAttributes,
  renderLinkSurfaceHtml,
} from "./link-surface";

describe("link surface", () => {
  it("uses one canonical class list for reader and editor links", () => {
    expect(linkSurfaceClassNames()).toBe("cf-doc-link cf-link-rendered");
    expect(linkSurfaceClassNames("host-link cf-link-rendered")).toBe(
      "cf-doc-link cf-link-rendered host-link",
    );
  });

  it("renders HTML links with layout and optional host metadata", () => {
    expect(
      renderLinkSurfaceHtml("chapter.md", "Chapter", {
        className: "host-link",
        title: "Open chapter",
        sourceAttrs: ' data-source-from="1"',
      }),
    ).toBe(
      '<a class="cf-doc-link cf-link-rendered host-link" href="chapter.md" data-cf-link-layout="atomic" title="Open chapter" data-source-from="1">Chapter</a>',
    );
  });

  it("applies the same DOM link contract", () => {
    const anchor = document.createElement("a");
    applyLinkSurface(anchor, "https://example.com/path", { className: "host-link" });

    expect(anchor.className).toBe("cf-doc-link cf-link-rendered host-link");
    expect(anchor.getAttribute("href")).toBe("https://example.com/path");
    expect(anchor.getAttribute("data-cf-link-layout")).toBe("flow");
  });

  it("shares decoration attributes with DOM and HTML links", () => {
    expect(renderedLinkDecorationAttributes("chapter.md")).toEqual({
      "data-url": "chapter.md",
      "data-cf-link-layout": "atomic",
    });
  });
});
