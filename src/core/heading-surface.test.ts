import { describe, expect, it } from "vitest";
import {
  createHeadingSurfaceElement,
  headingNumberingHtmlAttrs,
  headingSurfaceClassNames,
  renderHeadingSurfaceHtml,
  setHeadingNumberingAttrs,
} from "./heading-surface";

describe("heading surface", () => {
  it("builds shared heading classes", () => {
    expect(headingSurfaceClassNames(2)).toBe("cf-doc-heading cf-doc-heading--h2");
    expect(headingSurfaceClassNames(3, true)).toBe(
      "cf-doc-heading cf-doc-heading--h3 cf-doc-heading--unnumbered",
    );
  });

  it("builds shared heading numbering attributes", () => {
    expect(headingNumberingHtmlAttrs("2.1", false)).toBe(' data-section-number="2.1"');
    expect(headingNumberingHtmlAttrs(undefined, true)).toBe(' data-heading-numbering="none"');

    const element = document.createElement("h2");
    setHeadingNumberingAttrs(element, "2.1", false);
    expect(element.dataset.sectionNumber).toBe("2.1");
    expect(element.dataset.headingNumbering).toBeUndefined();

    setHeadingNumberingAttrs(element, undefined, true);
    expect(element.dataset.headingNumbering).toBe("none");
    expect(element.dataset.sectionNumber).toBeUndefined();
  });

  it("renders heading HTML with canonical classes, id, and numbering", () => {
    expect(
      renderHeadingSurfaceHtml("<em>Title</em>", {
        level: 2,
        id: "sec:intro",
        sectionNumber: "2.1",
        unnumbered: false,
      }, ' data-source-from="4"'),
    ).toBe(
      '<h2 class="cf-doc-heading cf-doc-heading--h2" id="sec:intro" data-section-number="2.1" data-source-from="4"><em>Title</em></h2>',
    );
  });

  it("creates heading DOM with the same surface attributes", () => {
    const heading = createHeadingSurfaceElement(
      document,
      {
        level: 3,
        id: "sec:intro",
        sectionNumber: undefined,
        unnumbered: true,
      },
      (target) => {
        const em = target.ownerDocument.createElement("em");
        em.textContent = "Title";
        target.appendChild(em);
      },
    );

    expect(heading.outerHTML).toBe(
      '<h3 class="cf-doc-heading cf-doc-heading--h3 cf-doc-heading--unnumbered" data-heading-numbering="none" id="sec:intro"><em>Title</em></h3>',
    );
  });
});
