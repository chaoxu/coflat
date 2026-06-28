import { describe, expect, it } from "vitest";

import {
  hydrateRichReadonlyDocument,
  mountRichReadonlyDocument,
  renderFastRichReadonlyHtml,
  type RichReadonlyLifecyclePhase,
} from "./rich-readonly";

describe("@chaoxu/coflat/rich-readonly", () => {
  it("renders through the shared reader surface", () => {
    const result = renderFastRichReadonlyHtml("# Heading\n\n- item");

    expect(result.html).toContain('class="cf-doc-heading cf-doc-heading--h1"');
    expect(result.html).toContain('class="cf-doc-list cf-doc-list--unordered');
  });

  it("mounts visible HTML synchronously and reports lifecycle phases", async () => {
    const root = document.createElement("div");
    const phases: RichReadonlyLifecyclePhase[] = [];

    const mounted = mountRichReadonlyDocument({
      root,
      source: "# Intro\n\nbody $x$",
      renderOptions: { outline: true },
      hydration: { math: false },
      onLifecycle: (event) => phases.push(event.phase),
    });

    expect(root.innerHTML).toContain("Intro");
    expect(root.classList.contains("cf-reader")).toBe(true);
    expect(root.classList.contains("cf-doc-surface")).toBe(true);
    expect(root.classList.contains("cf-doc-flow")).toBe(true);

    await mounted.ready;

    expect(phases).toContain("first-document-pixels");
    expect(phases).toContain("outline-ready");
    expect(phases).toContain("rich-readonly-ready");
    expect(phases).not.toContain("math-ready");
  });

  it("cleans hover-preview hydration when disposed", async () => {
    const root = document.createElement("div");
    const removed: string[] = [];
    const originalRemove = root.removeEventListener.bind(root);
    root.removeEventListener = ((type, listener, options) => {
      removed.push(type);
      return originalRemove(type, listener, options);
    }) as typeof root.removeEventListener;

    const mounted = mountRichReadonlyDocument({
      root,
      source: "See [@x].",
      hydration: { hoverPreviews: true, math: false },
    });
    await mounted.ready;
    mounted.dispose();

    expect(removed).toContain("mouseover");
    expect(removed).toContain("mouseout");
  });

  it("hydrates server-rendered HTML without rerendering it", async () => {
    const root = document.createElement("div");
    const result = renderFastRichReadonlyHtml("::: {.theorem}\nbody\n:::");
    root.innerHTML = result.html;

    await hydrateRichReadonlyDocument({
      root,
      result,
      hydration: { math: false },
    });

    expect(root.querySelector(".cf-block-disclosure-toggle")).not.toBeNull();
    expect(root.textContent).toContain("Theorem 1");
  });
});
