import { describe, expect, it, vi } from "vitest";
import { hydrateMath, renderToHtml } from "../../reader";

function makeRoot(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

function requireMathPlaceholder(root: HTMLElement): HTMLElement {
  const placeholder = root.querySelector<HTMLElement>("[data-math]");
  if (!placeholder) throw new Error("expected math placeholder");
  return placeholder;
}

describe("hydrateMath", () => {
  it("resolves immediately and does not load KaTeX when no math is present", async () => {
    const root = makeRoot("<p>plain paragraph, no math here</p>");
    // Sentinel: spy on dynamic import via global. We can't easily intercept
    // `import("katex")`, but we can assert that no DOM mutation happens and
    // the call resolves quickly.
    const before = root.innerHTML;
    await hydrateMath(root);
    expect(root.innerHTML).toBe(before);
  });

  it("hydrates an inline math placeholder", async () => {
    const { html, hasMath } = renderToHtml("hello $x+1$ world");
    expect(hasMath).toBe(true);
    const root = makeRoot(html);
    const placeholder = root.querySelector<HTMLElement>("[data-math]");
    expect(placeholder).not.toBeNull();
    expect(placeholder?.classList.contains("cf-doc-inline-math")).toBe(true);

    await hydrateMath(root);

    expect(placeholder?.getAttribute("data-math-hydrated")).toBe("true");
    // KaTeX emits a wrapper with class "katex".
    expect(placeholder?.innerHTML).toContain("katex");
    expect(placeholder?.innerHTML).not.toContain("katex-mathml");
    expect(placeholder?.classList.contains("cf-math-error")).toBe(false);
  });

  it("uses displayMode for cf-doc-display-math placeholders", async () => {
    const { html } = renderToHtml("$$y=mx+b$$");
    const root = makeRoot(html);
    const placeholder = root.querySelector<HTMLElement>("[data-math]");
    expect(placeholder?.classList.contains("cf-doc-display-math")).toBe(true);

    await hydrateMath(root);

    // KaTeX uses "katex-display" wrapper when displayMode is true.
    expect(placeholder?.innerHTML).toContain("katex-display");
    expect(placeholder?.innerHTML).toContain("katex-mathml");
    expect(placeholder?.getAttribute("data-math-hydrated")).toBe("true");
  });

  it("on invalid LaTeX, keeps original text and adds error markers", async () => {
    const root = makeRoot(
      `<p><span class="cf-doc-inline-math" data-math="\\invalidcmd{">$\\invalidcmd{$</span></p>`,
    );
    const placeholder = root.querySelector<HTMLElement>("[data-math]");
    const originalText = placeholder?.textContent;

    await hydrateMath(root);

    expect(placeholder?.classList.contains("cf-math-error")).toBe(true);
    expect(placeholder?.getAttribute("data-math-error")).toBeTruthy();
    expect(placeholder?.getAttribute("data-math-hydrated")).toBeNull();
    // Original placeholder text is retained as the user-visible fallback.
    expect(placeholder?.textContent).toBe(originalText);
  });

  it("is idempotent: a second call does not re-render", async () => {
    const { html } = renderToHtml("$a^2+b^2=c^2$");
    const root = makeRoot(html);
    const placeholder = requireMathPlaceholder(root);

    await hydrateMath(root);
    const afterFirst = placeholder.innerHTML;
    expect(placeholder.getAttribute("data-math-hydrated")).toBe("true");

    // Mutate to verify the second call doesn't touch hydrated placeholders.
    const marker = "<!-- hydrated -->";
    placeholder.innerHTML = afterFirst + marker;

    await hydrateMath(root);
    expect(placeholder.innerHTML).toBe(afterFirst + marker);
  });

  it("forwards mathMacros to KaTeX", async () => {
    // `\myfoo` is not a built-in KaTeX command. Without the macro it errors;
    // with the macro it expands to `\mathbb{R}` and renders successfully.
    const root = makeRoot(
      `<p><span class="cf-doc-inline-math" data-math="\\myfoo">$\\myfoo$</span></p>`,
    );
    const placeholder = requireMathPlaceholder(root);
    await hydrateMath(root);
    expect(placeholder.classList.contains("cf-math-error")).toBe(true);

    const root2 = makeRoot(
      `<div class="cf-doc-display-math" data-math="\\myfoo">$$\\myfoo$$</div>`,
    );
    const placeholder2 = requireMathPlaceholder(root2);
    await hydrateMath(root2, { mathMacros: { "\\myfoo": "\\mathbb{R}" } });
    expect(placeholder2.classList.contains("cf-math-error")).toBe(false);
    expect(placeholder2.getAttribute("data-math-hydrated")).toBe("true");
    // `\mathbb{R}` renders with a double-struck mathvariant in the MathML.
    expect(placeholder2.innerHTML).toContain("double-struck");
  });
});

describe("hydrateMath — KaTeX import laziness", () => {
  it("never references katex when the tree has no math", async () => {
    // Best-effort sentinel: dynamic import is cached. We can at least verify
    // the helper returns synchronously-fast for empty roots by checking it
    // doesn't await anything expensive. The real guarantee is bundle-level
    // (no static import of `katex` in dist/reader.mjs).
    const root = makeRoot("<p>nothing here</p>");
    const start = performance.now();
    await hydrateMath(root);
    const elapsed = performance.now() - start;
    // Generous bound — synchronous resolve should complete instantly.
    expect(elapsed).toBeLessThan(50);
  });
});

// Silence the noisy `vi` import when not used elsewhere.
void vi;
