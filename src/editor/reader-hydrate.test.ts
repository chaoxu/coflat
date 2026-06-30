import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hydrateBlockDisclosures,
  hydrateMath,
  hydrateMedia,
  hydrateReaderDisclosures,
  hydrateReaderHoverPreviews,
  type ReaderReferencePreviewIndex,
  renderToHtml,
} from "../../reader";
import {
  destroyHoverPreviewTooltipForTest,
  ensureHoverPreviewTooltipForTest,
} from "../core/hover-tooltip";
import { KATEX_TEXTSC_CLASS } from "../core/lib/katex-options";

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

describe("hydrateMedia", () => {
  it("syncs inline reader images to their natural size", () => {
    const root = makeRoot('<p><span class="cf-image-wrapper"><img class="cf-image" src="figure.svg" alt="Figure"></span></p>');
    const img = root.querySelector<HTMLImageElement>("img.cf-image");
    expect(img).not.toBeNull();
    Object.defineProperties(img, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 257 },
      naturalHeight: { configurable: true, value: 150 },
    });

    hydrateMedia(root);

    const wrapper = root.querySelector<HTMLElement>("span.cf-image-wrapper");
    expect(wrapper?.getAttribute("style")).toBe("width: 257px; height: 150px;");
    expect(img?.getAttribute("style")).toBe("width: 100%; height: 100%;");
  });
});

async function hoverReference(
  root: HTMLElement,
  key: string,
  options: { referencePreviewIndex?: ReaderReferencePreviewIndex } = {},
): Promise<HTMLElement> {
  document.body.appendChild(root);
  hydrateReaderHoverPreviews(root, {
    source: root.dataset.source ?? "",
    hoverDelayMs: 0,
    referencePreviewIndex: options.referencePreviewIndex,
  });
  const target = root.querySelector<HTMLElement>(`[data-ref-key="${CSS.escape(key)}"]`);
  if (!target) throw new Error(`expected reference ${key}`);
  target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  return ensureHoverPreviewTooltipForTest();
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

  it("on invalid LaTeX, renders KaTeX error markup and adds error markers", async () => {
    const root = makeRoot(
      `<p><span class="cf-doc-inline-math" data-math="\\invalidcmd{">$\\invalidcmd{$</span></p>`,
    );
    const placeholder = root.querySelector<HTMLElement>("[data-math]");

    await hydrateMath(root);

    expect(placeholder?.classList.contains("cf-math-error")).toBe(true);
    expect(placeholder?.getAttribute("data-math-error")).toBeTruthy();
    expect(placeholder?.getAttribute("data-math-hydrated")).toBe("true");
    expect(placeholder?.querySelector(".katex-error")).not.toBeNull();
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
    // `\myfoo` is not a built-in KaTeX command. Without the macro KaTeX still
    // hydrates a non-throwing error surface; with the macro it expands to
    // `\mathbb{R}` and renders successfully.
    const root = makeRoot(
      `<p><span class="cf-doc-inline-math" data-math="\\myfoo">$\\myfoo$</span></p>`,
    );
    const placeholder = requireMathPlaceholder(root);
    await hydrateMath(root);
    expect(placeholder.getAttribute("data-math-hydrated")).toBe("true");
    expect(placeholder.classList.contains("cf-math-error")).toBe(false);
    expect(placeholder.innerHTML).toContain("katex");
    expect(placeholder.textContent).toContain("\\myfoo");

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

  it("hydrates \\textsc using the built-in KaTeX small-caps fallback", async () => {
    const { html } = renderToHtml("Problem $\\textsc{Minimum Vertex Cover}$.");
    const root = makeRoot(html);
    const placeholder = requireMathPlaceholder(root);

    await hydrateMath(root);

    expect(placeholder.classList.contains("cf-math-error")).toBe(false);
    expect(placeholder.getAttribute("data-math-hydrated")).toBe("true");
    expect(placeholder.innerHTML).toContain(KATEX_TEXTSC_CLASS);
    expect(placeholder.textContent).toContain("Minimum");
    expect(placeholder.textContent).not.toContain("\\textsc");
  });
  // `\myfoo` is a custom macro defined only in the frontmatter preamble and
  // used in both the title and the body — the case the macro fix exists for.
  const MACRO_DOC = [
    "---",
    'title: "Title $\\\\myfoo$"',
    "math:",
    '  \\myfoo: "\\\\mathbb{R}"',
    "---",
    "",
    "Body $\\myfoo$.",
  ].join("\n");

  it("renders title + body macro math end-to-end via result.mathMacros", async () => {
    // Forwarding result.mathMacros is what makes both the title and the body
    // render (regression: reader previously dropped frontmatter macros).
    const result = renderToHtml(MACRO_DOC);
    expect(result.mathMacros).toEqual({ "\\myfoo": "\\mathbb{R}" });

    const root = makeRoot(result.html);
    const titleDiv = root.querySelector(".cf-doc-title");
    const placeholders = Array.from(root.querySelectorAll<HTMLElement>("[data-math]"));
    expect(placeholders).toHaveLength(2);
    // One placeholder is inside the title, one in the body.
    expect(placeholders.some((p) => titleDiv?.contains(p))).toBe(true);

    await hydrateMath(root, result.mathMacros ? { mathMacros: result.mathMacros } : undefined);

    for (const p of placeholders) {
      expect(p.classList.contains("cf-math-error")).toBe(false);
      expect(p.getAttribute("data-math-hydrated")).toBe("true");
    }
  });

  it("without forwarding macros, frontmatter-defined title/body math remains hydrated", async () => {
    // Even when the caller forgets to forward result.mathMacros, reader output
    // should stay on the KaTeX surface instead of falling back to raw dollar
    // math. The macro expansion itself still requires the forwarded macros.
    const root = makeRoot(renderToHtml(MACRO_DOC).html);
    await hydrateMath(root); // forgot to forward result.mathMacros
    const placeholders = Array.from(root.querySelectorAll<HTMLElement>("[data-math]"));
    expect(placeholders).toHaveLength(2);
    for (const p of placeholders) {
      expect(p.getAttribute("data-math-hydrated")).toBe("true");
      expect(p.classList.contains("cf-math-error")).toBe(false);
      expect(p.innerHTML).toContain("katex");
    }
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

describe("hydrateReaderHoverPreviews", () => {
  afterEach(() => {
    destroyHoverPreviewTooltipForTest();
    document.body.replaceChildren();
  });

  it("previews heading references without restarting section numbering", async () => {
    const source = [
      "# First {#sec:first}",
      "",
      "first body",
      "",
      "# Second {#sec:second}",
      "",
      "second body",
      "",
      "See [@sec:second].",
    ].join("\n");
    const root = makeRoot(renderToHtml(source, undefined, { resolveReferences: true }).html);
    root.dataset.source = source;

    const tooltip = await hoverReference(root, "sec:second");

    expect(tooltip.textContent).toContain("Section 2");
    expect(tooltip.textContent).toContain("Second");
    expect(tooltip.textContent).not.toContain("Section 1Second");
  });

  it("uses editor-style heading preview headers from the render-time index", async () => {
    const source = [
      "# First {#sec:first}",
      "",
      "first body",
      "",
      "# Second {#sec:second}",
      "",
      "second body",
      "",
      "See [@sec:second].",
    ].join("\n");
    const result = renderToHtml(source, undefined, {
      referencePreviews: true,
      resolveReferences: true,
    });
    const root = makeRoot(result.html);
    root.dataset.source = source;

    const tooltip = await hoverReference(root, "sec:second", {
      referencePreviewIndex: result.referencePreviewIndex,
    });

    expect(tooltip.querySelector(".cf-hover-preview-header")?.textContent)
      .toBe("Section 2 Second");
    expect(tooltip.querySelector(".cf-doc-heading")).toBeNull();
    expect(tooltip.textContent).not.toContain("second body");
  });

  it("uses titled block preview headers from the render-time index", async () => {
    const source = [
      ':::: {#thm:hover-preview .theorem title="Hover Preview Stress Test"}',
      "Body.",
      "::::",
      "",
      "See [@thm:hover-preview].",
    ].join("\n");
    const result = renderToHtml(source, undefined, {
      referencePreviews: true,
      resolveReferences: true,
    });
    const root = makeRoot(result.html);
    root.dataset.source = source;

    const tooltip = await hoverReference(root, "thm:hover-preview", {
      referencePreviewIndex: result.referencePreviewIndex,
    });

    expect(tooltip.querySelector(".cf-hover-preview-header")?.textContent)
      .toBe("Theorem 1 Hover Preview Stress Test");
    expect(tooltip.textContent).toContain("Body.");
  });

  it("does not use preceding display math as a heading reference preview", async () => {
    const source = [
      "# First",
      "",
      "$$",
      "\\frac{\\lambda_1(M)}{\\lambda_1^*(M)}=1,\\qquad \\frac{\\lambda_2(M)}{\\lambda_2^*(M)}=\\frac54.",
      "$$",
      "",
      "# Second {#sec:second}",
      "",
      "See [@sec:second].",
    ].join("\n");
    const root = makeRoot(renderToHtml(source, undefined, { resolveReferences: true }).html);
    root.dataset.source = source;

    const tooltip = await hoverReference(root, "sec:second");

    expect(tooltip.textContent).toContain("Section 2");
    expect(tooltip.textContent).toContain("Second");
    expect(tooltip.textContent).not.toContain("lambda");
    expect(tooltip.querySelector(".cf-doc-display-math")).toBeNull();
  });

  it("uses render-time preview index entries before raw source scans", async () => {
    const source = [
      "$$",
      "x+1",
      "$$ {#eq:actual}",
      "",
      "See [@eq:actual].",
    ].join("\n");
    const result = renderToHtml(source, undefined, {
      referencePreviews: true,
      resolveReferences: true,
    });
    const root = makeRoot(result.html);
    // If hydration ignored the index and scanned this source, the tooltip would
    // render y+1 instead. The index entry carries the Lezer-owned equation body.
    root.dataset.source = "$$\ny+1\n$$ {#eq:actual}";

    const tooltip = await hoverReference(root, "eq:actual", {
      referencePreviewIndex: result.referencePreviewIndex,
    });

    expect(tooltip.textContent).toContain("Eq. (1)");
    expect(tooltip.textContent).toContain("x+1");
    expect(tooltip.textContent).not.toContain("y+1");
  });

  it("lets host previews override render-time preview index entries", async () => {
    const source = "# Indexed {#sec:indexed}\n\nSee [@sec:indexed].";
    const result = renderToHtml(source, undefined, {
      referencePreviews: true,
      resolveReferences: true,
    });
    const root = makeRoot(result.html);
    document.body.appendChild(root);
    hydrateReaderHoverPreviews(root, {
      hoverDelayMs: 0,
      referencePreviewIndex: result.referencePreviewIndex,
      source,
      previewForReference: () => "host override",
    });

    const target = root.querySelector<HTMLElement>('[data-ref-key="sec:indexed"]');
    if (!target) throw new Error("expected reference sec:indexed");
    target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const tooltip = ensureHoverPreviewTooltipForTest();

    expect(tooltip.textContent).toContain("host override");
    expect(tooltip.textContent).not.toContain("Section 1");
  });

  it("previews block references without restarting theorem numbering", async () => {
    const source = [
      "::: {.theorem #thm:first}",
      "first body",
      ":::",
      "",
      "::: {.theorem #thm:second}",
      "second body",
      ":::",
      "",
      "See [@thm:second].",
    ].join("\n");
    const root = makeRoot(renderToHtml(source, undefined, { resolveReferences: true }).html);
    root.dataset.source = source;

    const tooltip = await hoverReference(root, "thm:second");

    expect(tooltip.textContent).toContain("Theorem 2");
    expect(tooltip.textContent).toContain("second body");
    expect(tooltip.textContent).not.toContain("Theorem 1");
  });
});

describe("hydrateReaderDisclosures", () => {
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

    hydrateReaderDisclosures(root);

    const headings = root.querySelectorAll<HTMLElement>(".cf-doc-section-heading-collapsible");
    expect(headings).toHaveLength(2);

    const introHeading = headings[0];
    const introButton = introHeading?.querySelector<HTMLButtonElement>(":scope > .cf-section-disclosure-toggle");
    const introBody = introHeading?.nextElementSibling as HTMLElement | null;
    expect(introButton).not.toBeNull();
    expect(introButton?.querySelector(".lucide-chevron-down")).not.toBeNull();
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
    expect(introButton?.querySelector(".lucide-chevron-right")).not.toBeNull();
    expect(introButton?.getAttribute("aria-expanded")).toBe("false");
    expect(introBody?.hidden).toBe(true);
  });

  it("hydrates section disclosures idempotently", () => {
    const { html } = renderToHtml("# Intro\n\nbody");
    const root = makeRoot(html);

    hydrateReaderDisclosures(root);
    hydrateReaderDisclosures(root);

    expect(root.querySelectorAll(".cf-section-disclosure-toggle")).toHaveLength(1);
  });

  it("keeps the block disclosure hydrator as a compatibility alias", () => {
    const { html } = renderToHtml("# Intro\n\nbody");
    const root = makeRoot(html);

    hydrateBlockDisclosures(root);

    expect(root.querySelectorAll(".cf-section-disclosure-toggle")).toHaveLength(1);
  });

  it("toggles only from the disclosure triangle, not the block header text", () => {
    const { html } = renderToHtml("::: {.theorem title=\"Readable column\"}\nbody\n:::");
    const root = makeRoot(html);
    const block = root.querySelector<HTMLElement>(".cf-doc-block-collapsible");
    const headingText = root.querySelector<HTMLElement>(".cf-block-heading-content");
    const body = root.querySelector<HTMLElement>(".cf-block-disclosure-body");
    expect(block).not.toBeNull();
    expect(headingText).not.toBeNull();
    expect(body).not.toBeNull();
    // #43: no toggle in the static render — it is created during hydration.
    expect(root.querySelector(".cf-block-disclosure-toggle")).toBeNull();

    hydrateReaderDisclosures(root);

    const button = root.querySelector<HTMLButtonElement>(".cf-block-disclosure-toggle");
    expect(button).not.toBeNull();
    expect(block?.getAttribute("data-cf-block-open")).toBe("true");
    expect(button?.querySelector(".lucide-chevron-down")).not.toBeNull();
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(body?.hidden).toBe(false);

    headingText?.click();
    expect(block?.getAttribute("data-cf-block-open")).toBe("true");
    expect(body?.hidden).toBe(false);

    button?.click();
    expect(block?.getAttribute("data-cf-block-open")).toBe("false");
    expect(button?.querySelector(".lucide-chevron-right")).not.toBeNull();
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(body?.hidden).toBe(true);

    button?.click();
    expect(block?.getAttribute("data-cf-block-open")).toBe("true");
    expect(button?.querySelector(".lucide-chevron-down")).not.toBeNull();
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(body?.hidden).toBe(false);
  });

  it("is idempotent across repeated hydration calls", () => {
    const { html } = renderToHtml("::: {.definition}\nbody\n:::");
    const root = makeRoot(html);
    const block = root.querySelector<HTMLElement>(".cf-doc-block-collapsible");
    expect(block).not.toBeNull();

    hydrateReaderDisclosures(root);
    hydrateReaderDisclosures(root);

    // Idempotent: exactly one toggle even after repeated hydration.
    expect(root.querySelectorAll(".cf-block-disclosure-toggle")).toHaveLength(1);
    const button = root.querySelector<HTMLButtonElement>(".cf-block-disclosure-toggle");
    button?.click();
    expect(block?.getAttribute("data-cf-block-open")).toBe("false");
  });

  it("keeps the static block header clean — no inert toggle, no glyph in text (#43)", () => {
    const { html } = renderToHtml("::: {.theorem title=\"Pythagoras\"}\nbody\n:::");
    // No baked control or triangle glyph anywhere in the static render.
    expect(html).not.toContain("<button");
    expect(html).not.toMatch(/[▼▶]/);
    // Heading textContent is just the title — clean for TOC scraping / a11y.
    const heading = makeRoot(html).querySelector<HTMLElement>(".cf-doc-block-heading");
    expect(heading?.textContent).not.toMatch(/[▼▶]/);
    expect(heading?.textContent).toContain("Theorem 1");
    expect(heading?.textContent).toContain("Pythagoras");
  });
});

// Silence the noisy `vi` import when not used elsewhere.
void vi;
