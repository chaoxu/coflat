import { describe, expect, it } from "vitest";
import {
  headingNumberingHtmlAttrs,
  headingSurfaceClassNames,
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
});
