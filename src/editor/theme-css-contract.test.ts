import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { baseThemeStyles } from "./base-theme";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

function cssRuleBody(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|})\\s*${escapedSelector}\\s*\\{([^}]*)\\}`, "m"));
  if (!match?.[1]) {
    throw new Error(`expected CSS rule for ${selector}`);
  }
  return match[1];
}

function cssCustomProperties(ruleBody: string): string[] {
  return [...ruleBody.matchAll(/--cf-[\w-]+\s*:/g)].map((match) =>
    match[0].slice(0, -1).trim()
  );
}

describe("theme CSS contract", () => {
  it("keeps dark mode as a complete token set", () => {
    const css = readRepoFile("editor/editor-theme.css");
    const rootTokens = cssCustomProperties(cssRuleBody(css, ":root"));
    const darkTokens = new Set(cssCustomProperties(cssRuleBody(css, "[data-theme=\"dark\"]")));

    expect(rootTokens.filter((token) => !darkTokens.has(token))).toEqual([]);
  });

  it("keeps preview and citation hover surfaces on shared foreground tokens", () => {
    const css = readRepoFile("editor/editor-theme.css");

    expect(cssRuleBody(css, ".cf-preview-surface-body")).toContain(
      "color: var(--cf-fg);",
    );
    expect(cssRuleBody(css, ".cf-hover-preview-citation")).toContain(
      "color: var(--cf-fg);",
    );
    expect(cssRuleBody(css, ".cf-hover-preview-unresolved")).toContain(
      "color: var(--cf-muted);",
    );
    expect(cssRuleBody(css, ".cf-preview-surface-body .cf-doc-list")).toContain(
      "padding-left: 0;",
    );
    expect(cssRuleBody(css, ".cf-preview-surface-body .cf-doc-list--unordered,\n.cf-preview-surface-body .cf-doc-list--ordered")).toContain(
      "list-style: none;",
    );
    expect(cssRuleBody(css, ".cf-preview-surface-body .cf-doc-list-item")).toContain(
      "display: block;",
    );
    expect(cssRuleBody(css, ".cf-shell-surface-label")).toContain(
      "color: var(--cf-bg);",
    );
  });

  it("owns critical CM6 layout CSS statically", () => {
    const css = readRepoFile("editor/editor-theme.css");

    expect(cssRuleBody(css, ".cm-editor")).toContain("display: flex !important;");
    expect(cssRuleBody(css, ".cm-scroller")).toContain("display: flex !important;");
    expect(cssRuleBody(css, ".cm-scroller")).toContain("overflow: auto;");
    expect(cssRuleBody(css, ".cm-content")).toContain(
      "max-width: var(--cf-content-max-width, 800px);",
    );
    expect(cssRuleBody(css, ".cm-content")).toContain("margin-left: auto;");
    expect(cssRuleBody(css, ".cm-content")).toContain(
      "margin-right: max(var(--cf-sidenote-margin-width, 0px), calc((100% - var(--cf-content-max-width, 800px)) / 2));",
    );
    expect(cssRuleBody(css, ".cm-content")).toContain("min-height: 100%;");
    expect(cssRuleBody(css, ".cm-content")).toContain(
      "padding: var(--cf-doc-content-padding-block-start, 24px) var(--cf-doc-content-padding-inline, 48px) var(--cf-doc-content-padding-block-end, 24px) var(--cf-doc-content-padding-inline, 48px);",
    );
    expect(cssRuleBody(css, ".cm-content")).toContain("white-space: pre;");
    expect(cssRuleBody(css, ".cm-line")).toContain("line-height: inherit;");
    expect(cssRuleBody(css, ".cm-line")).toContain("padding: 0;");
    expect(cssRuleBody(css, ".cm-editor .cm-line")).toContain("padding: 0;");
  });

  it("ships full-document reader defaults for host-rendered documents", () => {
    const css = readRepoFile("editor/editor-theme.css");

    expect(cssRuleBody(css, ".cf-doc-flow")).toContain("-webkit-font-smoothing: antialiased;");
    expect(cssRuleBody(css, ".cf-reader")).toContain("max-width: var(--cf-content-max-width, 800px);");
    expect(cssRuleBody(css, ".cf-reader")).toContain("counter-reset: cf-reader-h1 cf-reader-h2 cf-reader-h3 cf-reader-h4 cf-reader-h5 cf-reader-h6;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-heading--h1")).toContain(
      "font-size: var(--cf-h1-size, 1.15em);",
    );
    expect(cssRuleBody(css, ".cf-reader .cf-doc-heading--h2")).toContain(
      "font-style: var(--cf-h2-style, italic);",
    );
    expect(cssRuleBody(css, ".cf-reader .cf-doc-heading--h1:not([data-section-number]):not(.cf-doc-heading--unnumbered)::before")).toContain(
      "counter-increment: cf-reader-h1;",
    );
    expect(cssRuleBody(css, ".cf-reader .cf-doc-heading--h2:not([data-section-number]):not(.cf-doc-heading--unnumbered)::before")).toContain(
      "counter-increment: cf-reader-h2;",
    );
    expect(cssRuleBody(css, ".cf-reader .cf-doc-heading--h3:not([data-section-number]):not(.cf-doc-heading--unnumbered)::before")).toContain(
      "counter-increment: cf-reader-h3;",
    );
    expect(cssRuleBody(css, "[data-section-number]::before")).toContain(
      'content: attr(data-section-number) ".\\2002";',
    );
    expect(cssRuleBody(css, ".cf-reader a,\n.cf-reader .cf-doc-link")).toContain("display: inline;");
    expect(cssRuleBody(css, ".cf-reader a,\n.cf-reader .cf-doc-link")).toContain("text-decoration-style: dotted;");
    expect(cssRuleBody(css, ".cf-reader a[data-cf-link-layout=\"flow\"],\n.cf-reader .cf-doc-link[data-cf-link-layout=\"flow\"]")).toContain(
      "display: inline;",
    );
    expect(cssRuleBody(css, ".cf-reader a[data-cf-link-layout=\"atomic\"],\n.cf-reader .cf-doc-link[data-cf-link-layout=\"atomic\"]")).toContain(
      "display: inline-block;",
    );
    expect(cssRuleBody(css, ".cf-reader .cf-doc-paragraph")).toContain("white-space: break-spaces;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-paragraph")).toContain("word-break: break-word;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-paragraph")).toContain("overflow-wrap: anywhere;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-list")).toContain("margin: 0;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-list")).toContain("padding-left: 0;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-list--unordered")).toContain("list-style: none;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-list--ordered")).toContain("list-style: none;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-list-item")).toContain("display: block;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-list-item")).toContain("margin: 0;");
    expect(cssRuleBody(css, ".cf-list-bullet")).toContain("font-weight: 700;");
    expect(cssRuleBody(css, ".cf-list-number")).toContain("font-weight: 600;");
    expect(cssRuleBody(css, ".cf-list-number")).toContain("font-variant-numeric: tabular-nums;");
    expect(cssRuleBody(css, ".cm-line.cf-doc-list")).toContain("margin: 0;");
    expect(cssRuleBody(css, ".cm-line.cf-doc-list")).toContain("padding-left: 0;");
    expect(cssRuleBody(css, ".cm-line.cf-doc-list")).toContain("list-style: none;");
    expect(cssRuleBody(css, ".cm-line.cf-doc-list-item")).toContain("display: block;");
    expect(cssRuleBody(css, ".cm-line.cf-doc-list-item")).toContain("margin: 0;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-list-item--check input[type=\"checkbox\"]")).toContain("pointer-events: none;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-code-block")).toContain("margin: 0;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-code-block")).toContain("overflow-x: auto;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-code-block")).toContain("overflow-y: hidden;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-code-block")).toContain("padding: 0;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-code-block")).toContain("border: 0;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-code-block")).toContain('font-family: var(--cf-code-font, Monaco, "DejaVu Sans Mono", Consolas, monospace);');
    expect(cssRuleBody(css, ".cf-reader .cf-doc-code-block")).toContain("font-style: normal;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-code-block")).toContain("line-height: var(--cf-line-height, 1.5);");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-code-block > .cf-codeblock-language")).toContain("display: block;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-code-block code")).toContain("display: block;");
    expect(cssRuleBody(css, ".cm-line.cf-codeblock-header,\n.cm-line.cf-codeblock-body,\n.cm-line.cf-codeblock-last")).toContain("font-style: normal;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-display-math")).toContain("text-align: center;");
    expect(cssRuleBody(css, ".cf-math-display-content")).toContain("display: block;");
    expect(cssRuleBody(css, ".cf-math-display-content")).toContain("width: fit-content;");
    expect(cssRuleBody(css, ".cf-math-display-content")).toContain("margin-inline: auto;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-table-block")).toContain("margin: var(--cf-spacing-sm) 0;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-table-block")).toContain("width: 100%;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-table-cell")).toContain("text-align: left;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-table-cell")).toContain("vertical-align: top;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-table-cell")).toContain("white-space: break-spaces;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-table-cell")).toContain("word-break: break-word;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-table-cell")).toContain("overflow-wrap: anywhere;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-list-item")).toContain("white-space: break-spaces;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-list-item")).toContain("word-break: break-word;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-list-item")).toContain("overflow-wrap: anywhere;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-table-header")).toContain("background: transparent;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-table-header")).toContain("font-weight: 700;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-block")).toContain("margin: 0;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-block:not(.cm-line)")).toContain("margin: 0;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-blank-line")).toContain("line-height: inherit;");
    const collapsibleHeading = cssRuleBody(css, ".cf-reader .cf-doc-block-collapsible > .cf-doc-block-heading,\n.cf-reader details.cf-doc-block > .cf-doc-block-heading");
    expect(collapsibleHeading).toContain("display: block;");
    expect(collapsibleHeading).toContain("position: relative;");
    expect(collapsibleHeading).toContain("list-style: none;");
    const collapsibleBlock = cssRuleBody(css, ".cf-reader .cf-doc-block-collapsible");
    expect(collapsibleBlock).toContain(
      "position: relative;",
    );
    expect(cssRuleBody(css, ".cf-reader .cf-doc-section-heading-collapsible")).toContain(
      "position: relative;",
    );
    expect(cssRuleBody(css, ".cf-reader .cf-doc-block-collapsible > .cf-block-disclosure-body,\n.cf-reader .cf-section-disclosure-body")).toContain(
      "position: relative;",
    );
    const collapsibleRail = cssRuleBody(css, ".cf-reader .cf-doc-block-collapsible > .cf-block-disclosure-body::before,\n.cf-reader .cf-section-disclosure-body::before");
    expect(collapsibleRail).toContain(
      "left: calc(-0.5em - var(--cf-spacing-xs));",
    );
    expect(collapsibleRail).toContain(
      "transform: translateX(-50%);",
    );
    expect(collapsibleRail).toContain(
      "width: var(--cf-border-width-accent, 2px);",
    );
    expect(cssRuleBody(css, ".cf-reader .cf-doc-block-collapsible:has(> .cf-doc-block-heading > .cf-block-disclosure-toggle:hover) > .cf-block-disclosure-body::before,\n.cf-reader .cf-doc-block-collapsible:has(> .cf-doc-block-heading > .cf-block-disclosure-toggle:focus-visible) > .cf-block-disclosure-body::before")).toContain(
      "opacity: 1;",
    );
    expect(cssRuleBody(css, ".cf-reader .cf-doc-section-heading-collapsible:has(> .cf-section-disclosure-toggle:hover) + .cf-section-disclosure-body::before,\n.cf-reader .cf-doc-section-heading-collapsible:has(> .cf-section-disclosure-toggle:focus-visible) + .cf-section-disclosure-body::before")).toContain(
      "opacity: 1;",
    );
    const disclosureToggle = cssRuleBody(css, ".cf-reader .cf-block-disclosure-toggle");
    expect(disclosureToggle).toContain("appearance: none;");
    expect(disclosureToggle).toContain("display: block;");
    expect(disclosureToggle).toContain("font: inherit;");
    expect(disclosureToggle).toContain("font-style: normal;");
    expect(disclosureToggle).toContain("opacity: 0;");
    expect(disclosureToggle).toContain("position: absolute;");
    expect(disclosureToggle).toContain("right: 100%;");
    expect(disclosureToggle).toContain("transition: opacity");
    expect(disclosureToggle).not.toMatch(/\bfont-(?:family|size)\s*:/);
    const disclosureToggleIcon = cssRuleBody(css, ".cf-reader .cf-block-disclosure-toggle svg");
    expect(disclosureToggleIcon).toContain("display: block;");
    expect(disclosureToggleIcon).toContain("width: 1em;");
    expect(disclosureToggleIcon).toContain("height: 1em;");
    expect(cssRuleBody(css, ".cf-reader .cf-doc-block-collapsible:hover > .cf-doc-block-heading > .cf-block-disclosure-toggle,\n.cf-reader .cf-doc-block-collapsible:focus-within > .cf-doc-block-heading > .cf-block-disclosure-toggle,\n.cf-reader .cf-doc-section-heading-collapsible:hover > .cf-block-disclosure-toggle,\n.cf-reader .cf-doc-section-heading-collapsible:focus-within > .cf-block-disclosure-toggle")).toContain("opacity: 1;");
    expect(cssRuleBody(css, ".cf-reader .cf-block-disclosure-toggle:hover,\n.cf-reader .cf-block-disclosure-toggle:focus-visible,\n.cf-reader .cf-block-disclosure-toggle-collapsed")).toContain("opacity: 1;");
    expect(cssRuleBody(css, ".cf-reader .cf-block-disclosure-body[hidden]")).toContain("display: none;");
    expect(cssRuleBody(css, ".cf-reader .cf-section-disclosure-body[hidden]")).toContain("display: none;");
    expect(cssRuleBody(css, ".cf-block-header-rendered")).toContain("line-height: 0;");
  });

  it("keeps cursor-state block source classes metric-neutral", () => {
    const css = readRepoFile("editor/editor-theme.css");
    const blockSource = cssRuleBody(css, ".cf-block-source");

    expect(blockSource).toContain("line-height: inherit;");
    expect(blockSource).not.toMatch(/\bfont-(?:family|size|style)\s*:/);
    expect(blockSource).not.toMatch(/\b(?:padding|margin|border)\s*:/);
  });

  it("keeps editor fold icon sizing stable", () => {
    expect(baseThemeStyles[".cf-fold-toggle svg"]).toEqual({
      width: "1em",
      height: "1em",
      display: "block",
    });
  });

  it("keeps shared inline mark styling available outside CM6", () => {
    const css = readRepoFile("editor/editor-theme.css");

    expect(cssRuleBody(css, ".cf-highlight")).toContain(
      "background-color: var(--cf-mark-bg, rgba(255, 255, 0, 0.2));",
    );
    expect(cssRuleBody(css, ".cf-highlight")).toContain("color: var(--cf-fg);");
    expect(cssRuleBody(css, ".cf-inline-code")).toContain(
      "background: var(--cf-color-code-bg, var(--cf-hover));",
    );
    expect(cssRuleBody(css, ".cf-inline-code")).toContain("padding: 0.1em 0.25em;");
    expect(cssRuleBody(css, ".cf-crossref")).toContain("font-kerning: none;");
    expect(cssRuleBody(css, ".cf-crossref")).toContain("text-decoration-style: dotted;");
    expect(cssRuleBody(css, ".cf-crossref-unresolved")).toContain("text-decoration-style: dotted;");
    expect(cssRuleBody(css, ".cf-crossref-unresolved")).not.toContain("box-shadow:");
    expect(cssRuleBody(css, ".cf-citation")).toContain("font-kerning: none;");
  });

  it("lets the Blueprint theme target reader and CM6 semantic classes", () => {
    const css = readRepoFile("themes/blueprint-book.css");

    expect(cssRuleBody(css, ".cf-theme-blueprint-book .cm-line.cf-doc-heading")).toContain(
      "font-family: var(--cf-ui-font);",
    );
    expect(cssRuleBody(css, ".cf-theme-blueprint-book .cm-line.cf-doc-heading--h1")).toContain(
      "text-align: center;",
    );
    expect(cssRuleBody(css, ".cf-theme-blueprint-book .cf-reader .cf-doc-block--theorem,\n.cf-theme-blueprint-book .cf-reader .cf-doc-block--proposition,\n.cf-theme-blueprint-book .cm-line.cf-doc-block--theorem,\n.cf-theme-blueprint-book .cm-line.cf-doc-block--proposition")).toContain(
      "border-left: 0.15rem solid #0a0a14;",
    );
    expect(cssRuleBody(css, ".cf-theme-blueprint-book .cf-reader .cf-doc-block--proof,\n.cf-theme-blueprint-book .cf-doc-block--proof:not(.cm-line),\n.cf-theme-blueprint-book .cm-line.cf-doc-block--proof")).toContain(
      "border-left: 0.08rem solid #808080;",
    );
  });

  it("keeps the proof QED marker on the shared line-level class", () => {
    const css = readRepoFile("editor/editor-theme.css");

    expect(cssRuleBody(css, ".cf-doc-block--proof:not(.cm-line):not(.cf-block-header-collapsed)::after")).toContain(
      "content: var(--cf-proof-marker);",
    );
    expect(cssRuleBody(css, ".cf-reader .cf-doc-block--proof:not(.cm-line)::after")).toContain(
      "content: none;",
    );
    expect(cssRuleBody(css, ".cf-block-qed::after")).toContain(
      "line-height: 1;",
    );
  });
});
