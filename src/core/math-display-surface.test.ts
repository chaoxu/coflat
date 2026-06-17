import { describe, expect, it } from "vitest";
import { CSS } from "./constants/css-classes";
import {
  createDisplayMathContentElement,
  createDisplayMathSurfaceElement,
  displayMathSurfaceClassNames,
  replaceDisplayMathContent,
  renderDisplayMathPlaceholderHtml,
  syncDisplayMathEquationNumber,
} from "./math-display-surface";

describe("display math surface", () => {
  it("computes the canonical wrapper classes", () => {
    expect(displayMathSurfaceClassNames()).toBe("cf-doc-display-math cf-math-display");
    expect(displayMathSurfaceClassNames({ equationNumber: 2, hasQedMarker: true })).toBe(
      "cf-doc-display-math cf-math-display cf-math-display-numbered cf-block-qed",
    );
  });

  it("creates the accessible display math wrapper", () => {
    const el = createDisplayMathSurfaceElement(document, "x^2", {
      equationNumber: 4,
      id: "eq:main",
    });

    expect(el.tagName).toBe("DIV");
    expect(el.id).toBe("eq:main");
    expect(el.className).toBe("cf-doc-display-math cf-math-display cf-math-display-numbered");
    expect(el.getAttribute("role")).toBe("img");
    expect(el.getAttribute("aria-label")).toBe("x^2");
  });

  it("renders reader placeholder HTML with the same wrapper contract", () => {
    expect(
      renderDisplayMathPlaceholderHtml("x < y", "$$x < y$$", {
        equationNumber: 4,
        id: "eq:main",
        sourceAttrs: ' data-source-from="10" data-source-to="20"',
      }),
    ).toBe(
      '<div class="cf-doc-display-math cf-math-display cf-math-display-numbered" id="eq:main" data-math="x &lt; y" data-equation-number="4" data-source-from="10" data-source-to="20">$$x &lt; y$$</div>',
    );
  });

  it("replaces content and syncs equation numbers", () => {
    const el = createDisplayMathSurfaceElement(document, "x^2");
    const content = createDisplayMathContentElement(document);
    content.textContent = "rendered";

    replaceDisplayMathContent(el, content, 3);

    expect(el.firstElementChild?.className).toBe(CSS.mathDisplayContent);
    expect(el.querySelector(`.${CSS.mathDisplayNumber}`)?.textContent).toBe("(3)");

    syncDisplayMathEquationNumber(el, undefined);
    expect(el.classList.contains(CSS.mathDisplayNumbered)).toBe(false);
    expect(el.querySelector(`.${CSS.mathDisplayNumber}`)).toBeNull();
  });
});
