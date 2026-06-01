import { describe, expect, it, vi } from "vitest";
import { hydrateBlockDisclosures, hydrateMath, renderToHtml } from "../../reader";

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
    expect(placeholder?.classList.contains("cf-math-inline")).toBe(true);

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
    expect(placeholder?.classList.contains("cf-math-display")).toBe(true);

    await hydrateMath(root);

    expect(placeholder?.querySelector(".cf-math-display-content")).not.toBeNull();
    // KaTeX uses "katex-display" wrapper when displayMode is true.
    expect(placeholder?.innerHTML).toContain("katex-display");
    expect(placeholder?.innerHTML).toContain("katex-mathml");
    expect(placeholder?.getAttribute("data-math-hydrated")).toBe("true");
  });

  it("preserves reader equation numbers while hydrating display math", async () => {
    const { html } = renderToHtml("$$y=mx+b$$ {#eq:line}");
    const root = makeRoot(html);
    const placeholder = requireMathPlaceholder(root);
    expect(placeholder.classList.contains("cf-math-display-numbered")).toBe(true);

    await hydrateMath(root);

    expect(placeholder.querySelector(".cf-math-display-content")).not.toBeNull();
    expect(placeholder.querySelector(".cf-math-display-number")?.textContent).toBe("(1)");
    expect(placeholder.getAttribute("data-math-hydrated")).toBe("true");
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

describe("hydrateBlockDisclosures", () => {
  it("adds section disclosures without making heading text a toggle", () => {
    const { html } = renderToHtml([
      "# Intro",
      "",
      "intro body",
      "",
      "## Nested",
      "",
      "nested body",
      "",
      "# Next",
    ].join("\n"));
    const root = makeRoot(html);

    hydrateBlockDisclosures(root);

    const headings = root.querySelectorAll<HTMLElement>(".cf-doc-section-heading-collapsible");
    expect(headings).toHaveLength(2);

    const introHeading = headings[0];
    const introButton = introHeading?.querySelector<HTMLButtonElement>(":scope > .cf-section-disclosure-toggle");
    const introBody = introHeading?.nextElementSibling as HTMLElement | null;
    expect(introButton).not.toBeNull();
    expect(introButton?.textContent).toBe("▼");
    expect(introButton?.getAttribute("aria-expanded")).toBe("true");
    expect(introBody?.classList.contains("cf-section-disclosure-body")).toBe(true);
    expect(introBody?.textContent).toContain("intro body");
    expect(introBody?.querySelector(".cf-doc-heading--h2")).not.toBeNull();
    expect(introBody?.textContent).not.toContain("Next");

    introHeading?.click();
    expect(introHeading?.getAttribute("data-cf-section-open")).toBe("true");
    expect(introBody?.hidden).toBe(false);

    introButton?.click();
    expect(introHeading?.getAttribute("data-cf-section-open")).toBe("false");
    expect(introButton?.textContent).toBe("▶");
    expect(introButton?.getAttribute("aria-expanded")).toBe("false");
    expect(introBody?.hidden).toBe(true);
  });

  it("hydrates section disclosures idempotently", () => {
    const { html } = renderToHtml("# Intro\n\nbody");
    const root = makeRoot(html);

    hydrateBlockDisclosures(root);
    hydrateBlockDisclosures(root);

    expect(root.querySelectorAll(".cf-section-disclosure-toggle")).toHaveLength(1);
  });

  it("toggles only from the disclosure triangle, not the block header text", () => {
    const { html } = renderToHtml("::: {.theorem title=\"Readable column\"}\nbody\n:::");
    const root = makeRoot(html);
    const block = root.querySelector<HTMLElement>(".cf-doc-block-collapsible");
    const button = root.querySelector<HTMLButtonElement>(".cf-block-disclosure-toggle");
    const headingText = root.querySelector<HTMLElement>(".cf-block-heading-content");
    const body = root.querySelector<HTMLElement>(".cf-block-disclosure-body");
    expect(block).not.toBeNull();
    expect(button).not.toBeNull();
    expect(headingText).not.toBeNull();
    expect(body).not.toBeNull();

    hydrateBlockDisclosures(root);

    expect(block?.getAttribute("data-cf-block-open")).toBe("true");
    expect(button?.textContent).toBe("▼");
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(body?.hidden).toBe(false);

    headingText?.click();
    expect(block?.getAttribute("data-cf-block-open")).toBe("true");
    expect(body?.hidden).toBe(false);

    button?.click();
    expect(block?.getAttribute("data-cf-block-open")).toBe("false");
    expect(button?.textContent).toBe("▶");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(body?.hidden).toBe(true);

    button?.click();
    expect(block?.getAttribute("data-cf-block-open")).toBe("true");
    expect(button?.textContent).toBe("▼");
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(body?.hidden).toBe(false);
  });

  it("is idempotent across repeated hydration calls", () => {
    const { html } = renderToHtml("::: {.definition}\nbody\n:::");
    const root = makeRoot(html);
    const button = root.querySelector<HTMLButtonElement>(".cf-block-disclosure-toggle");
    const block = root.querySelector<HTMLElement>(".cf-doc-block-collapsible");
    expect(button).not.toBeNull();
    expect(block).not.toBeNull();

    hydrateBlockDisclosures(root);
    hydrateBlockDisclosures(root);

    button?.click();
    expect(block?.getAttribute("data-cf-block-open")).toBe("false");
  });
});

// Silence the noisy `vi` import when not used elsewhere.
void vi;
