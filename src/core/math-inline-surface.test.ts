import { describe, expect, it } from "vitest";
import {
  createInlineMathSurfaceElement,
  inlineMathSurfaceClassNames,
  renderInlineMathErrorFallback,
  renderInlineMathPlaceholderHtml,
} from "./math-inline-surface";

describe("inline math surface", () => {
  it("shares inline math classes", () => {
    expect(inlineMathSurfaceClassNames()).toBe("cf-doc-inline-math cf-math-inline");
    expect(inlineMathSurfaceClassNames(true)).toBe("cf-doc-inline-math cf-math-inline cf-math-error");
  });

  it("renders reader placeholder HTML", () => {
    expect(
      renderInlineMathPlaceholderHtml("x < y", "$x < y$", {
        sourceAttrs: ' data-source-from="1" data-source-to="8"',
      }),
    ).toBe(
      '<span class="cf-doc-inline-math cf-math-inline" data-math="x &lt; y" data-source-from="1" data-source-to="8">$x &lt; y$</span>',
    );
  });

  it("creates editor inline math DOM", () => {
    const el = createInlineMathSurfaceElement(document, "x^2");
    expect(el.outerHTML).toBe(
      '<span class="cf-doc-inline-math cf-math-inline" role="img" aria-label="x^2"></span>',
    );
  });

  it("applies shared error fallback chrome", () => {
    const el = createInlineMathSurfaceElement(document, "x_");
    renderInlineMathErrorFallback(el, "$x_$", "KaTeX error", { role: "alert" });
    expect(el.outerHTML).toBe(
      '<span class="cf-doc-inline-math cf-math-inline cf-math-error" role="alert" aria-label="KaTeX error">$x_$</span>',
    );
  });
});
