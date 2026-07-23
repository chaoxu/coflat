import { beforeEach, describe, expect, it } from "vitest";
import type { LinkResolver } from "../../reader";
import {
  hydrateReferences,
  renderToHtml,
  renderToText,
} from "../../reader";
import { createNumericCitationFormatter } from "../core/citations/numeric";
import type { FileSystem } from "../core/lib/file-system-types";
import {
  getLezerInvocationCount,
  resetLezerInvocationCount,
} from "../reader/reader-internal";

beforeEach(() => {
  resetLezerInvocationCount();
});

describe("renderToHtml — fast path (plain text only)", () => {
  it("renders plain text", () => {
    const r = renderToHtml("plain text");
    expect(r.html).toBe("plain text");
    expect(r.hasMath).toBe(false);
  });

  it("escapes ampersands in plain runs without invoking Lezer", () => {
    resetLezerInvocationCount();
    const r = renderToHtml("a & b");
    expect(r.html).toBe("a &amp; b");
    expect(getLezerInvocationCount()).toBe(0);
  });

  it("does NOT invoke Lezer for pure plain-text inputs", () => {
    resetLezerInvocationCount();
    renderToHtml("just some words");
    renderToHtml("plain text");
    expect(getLezerInvocationCount()).toBe(0);
  });

  it("falls through to the real parser for any inline delimiter", () => {
    // The hand-rolled fast path only ever sees plain text now; anything that
    // could carry markup semantics (emphasis, escape, highlight, citation)
    // must go to Lezer so the output matches the canonical render.
    for (const s of ["**bold**", "a_b", "x~y", "==hi==", "see @doe2020", "50\\% off"]) {
      resetLezerInvocationCount();
      renderToHtml(s);
      expect(getLezerInvocationCount(), s).toBeGreaterThan(0);
    }
  });

  it("routes single-line block constructs to the real parser, not literal text", () => {
    // `+` bullets, ordered-list markers and leading indent are block constructs
    // the fast path would otherwise emit as raw markdown.
    expect(renderToHtml("+ item").html).toContain('class="cf-doc-list');
    expect(renderToHtml("1. item").html).toContain('class="cf-doc-list');
    expect(renderToHtml("2) foo").html).toContain('start="2"');
    // A bare ordered-list marker (no trailing content) is still a list.
    expect(renderToHtml("1.").html).toContain('class="cf-doc-list');
    expect(renderToHtml("1)").html).toContain('class="cf-doc-list');
    // Indented content is stripped by the parser, not kept verbatim.
    expect(renderToHtml("    code").html).toBe("code");
  });

  it("keeps fast/slow parity for trailing whitespace (CommonMark strips it)", () => {
    // A plain line ending in space/tab must NOT take the fast path, or it would
    // preserve the trailing whitespace the canonical parser strips.
    for (const s of ["hello   ", "hello\t", "a b\t\t", "word "]) {
      const fast = renderToHtml(s).html;
      const slow = renderToHtml(s, undefined, { resolveReferences: true }).html;
      expect(fast, JSON.stringify(s)).toBe(slow);
    }
    // Genuine plain text without a trailing space is unaffected (fast == slow).
    expect(renderToHtml("hello").html).toBe("hello");
    expect(renderToHtml("3.5 mm").html).toBe("3.5 mm");
  });
});

describe("renderToHtml — inline marks render canonically", () => {
  it("renders bold/italic/strike/highlight with canonical classes", () => {
    // Formerly the fast path emitted unclassed <strong>/<em>/<del> and dropped
    // ==highlight== entirely, diverging from every other coflat render surface.
    expect(renderToHtml("**bold**").html).toBe('<strong class="cf-bold">bold</strong>');
    expect(renderToHtml("__bold__").html).toBe('<strong class="cf-bold">bold</strong>');
    expect(renderToHtml("*italic*").html).toBe('<em class="cf-italic">italic</em>');
    expect(renderToHtml("_italic_").html).toBe('<em class="cf-italic">italic</em>');
    expect(renderToHtml("~~strike~~").html).toBe('<del class="cf-strikethrough">strike</del>');
    expect(renderToHtml("==hi==").html).toBe('<mark class="cf-highlight">hi</mark>');
  });

  it("does not invent emphasis inside snake_case identifiers", () => {
    expect(renderToHtml("snake_case_name").html).toBe("snake_case_name");
  });

  it("applies backslash escapes via the real parser", () => {
    expect(renderToHtml("50\\% done").html).toBe("50% done");
  });

  it("fast (plain-text) and Lezer paths agree byte-for-byte", () => {
    // resolveReferences forces the Lezer path even for target-free plain text;
    // the two renders must be identical or the fast path is unsound.
    const corpus = [
      "hello world",
      "a & b",
      "one two three",
      "café résumé",
      "tabs\tand spaces",
      "digits 123 456",
    ];
    for (const s of corpus) {
      const fast = renderToHtml(s).html;
      const slow = renderToHtml(s, undefined, { resolveReferences: true }).html;
      expect(slow, s).toBe(fast);
    }
  });
});

describe("renderToHtml — slow path (Lezer)", () => {
  it("invokes Lezer when source contains interesting chars", () => {
    resetLezerInvocationCount();
    renderToHtml("see `code`");
    expect(getLezerInvocationCount()).toBeGreaterThan(0);
  });

  it("renders inline code", () => {
    const r = renderToHtml("see `code` here");
    expect(r.html).toContain('<code class="cf-doc-code-token cf-inline-code">code</code>');
  });

  it("renders a [label](url) link", () => {
    const r = renderToHtml("[label](https://example.com)");
    expect(r.html).toBe(
      '<a class="cf-doc-link cf-link-rendered" href="https://example.com" data-cf-link-layout="flow">label</a>',
    );
  });

  it("renders an autolink", () => {
    const r = renderToHtml("<https://example.com>");
    expect(r.html).toContain('class="cf-doc-link cf-link-rendered"');
    expect(r.html).toContain('href="https://example.com"');
    expect(r.html).toContain('data-cf-link-layout="flow"');
    expect(r.html).toContain("https://example.com</a>");
  });

  it("marks document links as atomic", () => {
    const r = renderToHtml("[label](chapter.md)");
    expect(r.html).toContain('href="chapter.md"');
    expect(r.html).toContain('data-cf-link-layout="atomic"');
  });

  it("renders headings with canonical classes", () => {
    const r = renderToHtml("# Heading\n\nbody");
    expect(r.html).toContain('class="cf-doc-heading cf-doc-heading--h1"');
    expect(r.html).toContain('data-section-number="1"');
    expect(r.html).toContain(">Heading</h1>");
    expect(r.html).toContain("body");
  });

  it("omits YAML frontmatter from document rendering", () => {
    const source = "---\ntitle: Hidden\nstatus: accepted\n---\n# Visible\n\nbody";
    const r = renderToHtml(source, undefined, { sourcePositions: true });
    expect(r.html).toContain('class="cf-doc-header"');
    expect(r.html).toContain('class="cf-doc-title"');
    expect(r.html).toContain(">Hidden</div>");
    expect(r.html).toContain("Visible");
    expect(r.html).toContain("body");
    expect(r.html).not.toContain("status: accepted");
    expect(r.html).toContain(`data-source-from="${source.indexOf("# Visible")}"`);
  });

  it("ignores frontmatter abstract in the article header", () => {
    const source = [
      "---",
      "title: Article",
      "abstract-title: Summary",
      "abstract: |",
      "  A richer abstract with $x^2$.",
      "---",
      "",
      "Body",
    ].join("\n");
    const r = renderToHtml(source);

    expect(r.html).toContain('class="cf-doc-header"');
    expect(r.html).not.toContain('class="cf-doc-abstract"');
    expect(r.html).not.toContain("Summary");
    expect(r.html).not.toContain("A richer abstract");
    expect(r.html).not.toContain('data-math="x^2"');
  });

  it("renders abstract body blocks as document prose blocks", () => {
    const source = [
      "---",
      "title: Article",
      "---",
      "",
      "::: {.abstract}",
      "A block abstract with $x^2$ and **bold** text.",
      ":::",
      "",
      "Body",
    ].join("\n");
    const r = renderToHtml(source);

    expect(r.html).toContain('class="cf-doc-block cf-doc-block--abstract"');
    expect(r.html).toContain('class="cf-doc-abstract-label"');
    expect(r.html).toContain('<div class="cf-doc-abstract-label"><span class="cf-block-header-rendered">Abstract</span></div>');
    expect(r.html).toContain("A block abstract");
    expect(r.html).toContain('data-math="x^2"');
    expect(r.hasMath).toBe(true);
  });

  it("renders abstract body blocks without frontmatter fallback", () => {
    const source = [
      "---",
      "title: Article",
      "abstract: Legacy abstract.",
      "---",
      "",
      "::: {.abstract}",
      "Block abstract.",
      ":::",
    ].join("\n");
    const r = renderToHtml(source);

    expect(r.html).toContain("Block abstract");
    expect(r.html).not.toContain("Legacy abstract");
  });

  it("surfaces frontmatter `math:` macros as result.mathMacros", () => {
    const source = [
      "---",
      'title: "T $\\\\foo$"',
      "math:",
      '  \\foo: "\\\\mathbb{R}"',
      '  \\bar: "\\\\mathcal{B}"',
      "---",
      "",
      "Body $\\bar$.",
    ].join("\n");
    const r = renderToHtml(source);
    expect(r.mathMacros).toEqual({ "\\foo": "\\mathbb{R}", "\\bar": "\\mathcal{B}" });
  });

  it("emits host-controlled layout gaps at source-line block boundaries", () => {
    const source = "first\n\nsecond\n\nthird";
    const r = renderToHtml(source, undefined, {
      layoutGaps: [
        { id: "gap-before-second", sourceLine: 3, height: 18, className: "cosheaf-gap bad$class" },
        { id: "gap-after-third", sourceLine: 5, placement: "after", height: 7 },
      ],
    });

    expect(r.html).toContain(
      '<div class="cf-doc-layout-gap cosheaf-gap" data-cf-layout-gap-id="gap-before-second" style="height:18px" aria-hidden="true"></div>' +
        '<p class="cf-doc-paragraph">second</p>',
    );
    expect(r.html).toContain(
      '<p class="cf-doc-paragraph">third</p>' +
        '<div class="cf-doc-layout-gap" data-cf-layout-gap-id="gap-after-third" style="height:7px" aria-hidden="true"></div>',
    );
    expect(r.html).not.toContain("data-source-line=");
  });

  it("does not emit invalid or unmatched layout gaps", () => {
    const r = renderToHtml("first\n\nsecond", undefined, {
      layoutGaps: [
        { id: "bad-line", sourceLine: 0, height: 8 },
        { id: "missing", sourceLine: 100, height: 8 },
      ],
    });

    expect(r.html).not.toContain("cf-doc-layout-gap");
  });

  it("omits result.mathMacros when the document defines no macros", () => {
    expect(renderToHtml("# Heading\n\nbody").mathMacros).toBeUndefined();
    // Plain math with no preamble still needs no macros.
    expect(renderToHtml("inline $x^2$").mathMacros).toBeUndefined();
  });

  it("lets context.mathMacros override frontmatter macros per key", () => {
    const source = [
      "---",
      "math:",
      '  \\foo: "\\\\mathbb{R}"',
      '  \\bar: "\\\\mathcal{B}"',
      "---",
      "",
      "body",
    ].join("\n");
    const r = renderToHtml(source, { mathMacros: { "\\foo": "\\mathbb{Q}", "\\baz": "\\mathbb{Z}" } });
    // \foo overridden, \bar inherited from frontmatter, \baz added by context.
    expect(r.mathMacros).toEqual({
      "\\foo": "\\mathbb{Q}",
      "\\bar": "\\mathcal{B}",
      "\\baz": "\\mathbb{Z}",
    });
  });

  it("renders the document title as inline markdown, never block-level", () => {
    const titleHtml = (source: string): string =>
      /<div class="cf-doc-title"[^>]*>([\s\S]*?)<\/div>/.exec(renderToHtml(source).html)?.[1] ?? "";

    // Inline markup + math render; no paragraph wrapper.
    const rich = renderToHtml('---\ntitle: "**Bold** $x^2$"\n---\n\nbody');
    const richTitle = /<div class="cf-doc-title"[^>]*>([\s\S]*?)<\/div>/.exec(rich.html)?.[1] ?? "";
    expect(richTitle).toContain('<strong class="cf-bold">Bold</strong>');
    expect(richTitle).toContain('data-math="x^2"');
    expect(richTitle).not.toContain("<p>");
    expect(richTitle).not.toContain("<p ");
    expect(rich.hasMath).toBe(true);

    // Leading list/quote markers stay literal text — never an <ol>/<ul>/<blockquote>.
    const listy = titleHtml('---\ntitle: "1. Introduction"\n---\n\nbody');
    expect(listy).not.toContain("<ol");
    expect(listy).not.toContain("<li");
    expect(listy).toContain("1. Introduction");

    const quoted = titleHtml('---\ntitle: "> not a quote"\n---\n\nbody');
    expect(quoted).not.toContain("<blockquote");
    expect(quoted).toContain("not a quote");
  });

  it("strips Pandoc heading attributes and marks unnumbered headings", () => {
    const dash = renderToHtml("# Unnumbered Heading {-}");
    expect(dash.html).toContain('class="cf-doc-heading cf-doc-heading--h1 cf-doc-heading--unnumbered"');
    expect(dash.html).toContain('data-heading-numbering="none"');
    expect(dash.html).toContain(">Unnumbered Heading</h1>");
    expect(dash.html).not.toContain("{-}");

    const classAttr = renderToHtml("## Unnumbered Subsection {.unnumbered}");
    expect(classAttr.html).toContain("cf-doc-heading--unnumbered");
    expect(classAttr.html).toContain(">Unnumbered Subsection</h2>");
    expect(classAttr.html).not.toContain("{.unnumbered}");
  });

  it("strips non-top-level appendix heading attributes without starting appendix mode", () => {
    const r = renderToHtml("## A target {#sec:a .appendix}");
    expect(r.html).toContain('class="cf-doc-heading cf-doc-heading--h2"');
    expect(r.html).toContain('id="sec:a"');
    expect(r.html).toContain('data-section-number="0.1"');
    expect(r.html).toContain(">A target</h2>");
    expect(r.html).not.toContain("{#sec:a");
    expect(r.html).not.toContain("cf-doc-heading--unnumbered");
  });

  it("renders appendix heading boundaries and appendix section numbers", () => {
    const r = renderToHtml([
      "# Intro",
      "",
      "# Appendix {.appendix}",
      "",
      "# Extra Proofs",
      "",
      "## Lemma Details",
      "",
      "# Tables",
    ].join("\n"));

    expect(r.html).toContain('data-section-number="1"');
    expect(r.html).toContain('class="cf-doc-heading cf-doc-heading--h1 cf-doc-heading--unnumbered" data-heading-numbering="none">Appendix</h1>');
    expect(r.html).toContain('data-section-number="A"');
    expect(r.html).toContain('data-section-number="A.1"');
    expect(r.html).toContain('data-section-number="B"');
    expect(r.html).not.toContain("{.appendix}");
  });

  it("keeps trailing braces when they are not Pandoc heading attributes", () => {
    const r = renderToHtml("## Set notation {x}");
    expect(r.html).toContain(">Set notation {x}</h2>");
    expect(r.html).not.toContain("cf-doc-heading--unnumbered");
  });

  it("renders bullet lists as <ul> with canonical list classes", () => {
    const r = renderToHtml("- a\n- b");
    expect(r.html).toContain('<ul class="cf-doc-list cf-doc-list--unordered cf-doc-list--tight');
    expect(r.html).toContain('<li class="cf-doc-list-item');
    expect(r.html).toContain('<span class="cf-list-bullet">•</span> a');
    expect(r.html).toContain("a");
    expect(r.html).toContain("b");
  });

  it("flags math without rendering it", () => {
    const r = renderToHtml("x is $y^2$");
    expect(r.hasMath).toBe(true);
    // Math source preserved as plain text (escape $).
    expect(r.html).toContain("$y^2$");
  });

  it("strips equation labels from display math placeholders and numbers them", () => {
    const r = renderToHtml("$$\nx^2\n$$ {#eq:first}\n\n\\[\ny^2\n\\] {#eq:second}");
    expect(r.html).toContain('id="eq:first"');
    expect(r.html).toContain('id="eq:second"');
    expect(r.html).toContain('data-equation-number="1"');
    expect(r.html).toContain('data-equation-number="2"');
    expect(r.html).toContain("cf-math-display-numbered");
    expect(r.html).toContain('data-math="x^2"');
    expect(r.html).toContain('data-math="y^2"');
    expect(r.html).not.toContain('data-math="$$');
  });

  it("applies LinkResolver overrides (href, className, title)", () => {
    const linkResolver: LinkResolver = {
      resolve(href) {
        if (href === "page:home") {
          return {
            href: "/home",
            className: "page-link",
            title: "Home page",
          };
        }
        return null;
      },
    };
    const r = renderToHtml("[Home](page:home)", { linkResolver });
    expect(r.html).toContain('href="/home"');
    expect(r.html).toContain('data-cf-link-layout="atomic"');
    expect(r.html).toContain('class="cf-doc-link cf-link-rendered page-link"');
    expect(r.html).toContain('title="Home page"');
  });

  it("renders unsafe javascript: hrefs as plain text", () => {
    const r = renderToHtml("[click](javascript:alert(1))");
    expect(r.html).not.toContain("javascript:");
    expect(r.html).toContain("click");
  });

  it("renders an image with synchronous resolveAssetUrl", () => {
    const ctx = {
      fileSystem: {
        // Only resolveAssetUrl is invoked; other methods unused.
        resolveAssetUrl: (path: string) => `https://cdn/${path}`,
      } as unknown as FileSystem,
    };
    const r = renderToHtml("![alt text](logo.png)", ctx);
    expect(r.html).toContain('src="https://cdn/logo.png"');
    expect(r.html).toContain('alt="alt text"');
  });

  it("resolves reader image assets relative to the document path", () => {
    const seen: string[] = [];
    const ctx = {
      fileSystem: {
        resolveAssetUrl: (path: string, options?: { purpose?: "source" | "display" }) => {
          seen.push(`${options?.purpose ?? "source"}:${path}`);
          return `https://cdn/${path.replace(/\.pdf$/, ".png")}`;
        },
      } as unknown as FileSystem,
    };
    const r = renderToHtml("![Paper](figures/paper.pdf)", ctx, { documentPath: "posts/math.md" });
    expect(seen).toEqual(["display:posts/figures/paper.pdf"]);
    expect(r.html).toContain('src="https://cdn/posts/figures/paper.png"');
  });

  it("renders PDF image assets as embedded PDF objects when no image preview is available", () => {
    const ctx = {
      fileSystem: {
        resolveAssetUrl: (path: string) => `https://cdn/${path}`,
      } as unknown as FileSystem,
    };
    const r = renderToHtml("![Paper](figures/paper.pdf)", ctx, { documentPath: "posts/math.md" });
    expect(r.html).toContain('data="https://cdn/posts/figures/paper.pdf"');
    expect(r.html).toContain('type="application/pdf"');
    expect(r.html).not.toContain('<img class="cf-image" src="https://cdn/posts/figures/paper.pdf"');
  });

  it("resolves root-relative reader image assets from the workspace root", () => {
    const seen: string[] = [];
    const ctx = {
      fileSystem: {
        resolveAssetUrl: (path: string, options?: { purpose?: "source" | "display" }) => {
          seen.push(`${options?.purpose ?? "source"}:${path}`);
          return `https://cdn/${path.replace(/\.pdf$/, ".png")}`;
        },
      } as unknown as FileSystem,
    };
    const r = renderToHtml("![Paper](/assets/paper.pdf)", ctx, { documentPath: "posts/math.md" });
    expect(seen).toEqual(["display:assets/paper.pdf"]);
    expect(r.html).toContain('src="https://cdn/assets/paper.png"');
  });

  it("does not resolve protocol image URLs through the filesystem", () => {
    const calls: string[] = [];
    const ctx = {
      fileSystem: {
        resolveAssetUrl: (path: string) => {
          calls.push(path);
          return `https://cdn/${path}`;
        },
      } as unknown as FileSystem,
    };
    const r = renderToHtml("![Remote](https://example.com/remote.png)", ctx, { documentPath: "posts/math.md" });
    expect(calls).toEqual([]);
    expect(r.html).toContain('src="https://example.com/remote.png"');
  });

  it("does not resolve protocol-relative image URLs through the filesystem", () => {
    const calls: string[] = [];
    const ctx = {
      fileSystem: {
        resolveAssetUrl: (path: string) => {
          calls.push(path);
          return `https://cdn/${path}`;
        },
      } as unknown as FileSystem,
    };
    const r = renderToHtml("![Remote](//cdn.example/remote.png)", ctx, { documentPath: "posts/math.md" });
    expect(calls).toEqual([]);
    expect(r.html).toContain('src="//cdn.example/remote.png"');
  });
});

describe("renderToText", () => {
  it("strips bold and italic", () => {
    const r = renderToText("**bold** and *italic*");
    expect(r.text).toBe("bold and italic");
  });

  it("renders [label](url) as the label", () => {
    const r = renderToText("see [docs](http://x)");
    expect(r.text).toContain("see ");
    expect(r.text).toContain("docs");
    expect(r.text).not.toContain("http://");
  });

  it("strips heading marks", () => {
    const r = renderToText("# Title\n\nbody");
    expect(r.text).toContain("Title");
    expect(r.text).toContain("body");
    expect(r.text).not.toContain("#");
  });

  it("omits YAML frontmatter from text output", () => {
    const r = renderToText("---\ntitle: Hidden\n---\n# Title\n\nbody");
    expect(r.text).toContain("Hidden");
    expect(r.text).toContain("Title");
    expect(r.text).toContain("body");
    expect(r.text).not.toContain("title:");
  });

  it("strips Pandoc heading attributes from text output", () => {
    const r = renderToText("# Title {-}\n\nbody");
    expect(r.text).toContain("Title");
    expect(r.text).not.toContain("{-}");
  });

  it("emits sourceToText for the fast path", () => {
    // Plain text stays on the fast path (fastRenderInline), which is the only
    // producer of a linear sourceToText map.
    const r = renderToText("bold text");
    expect(r.sourceToText).toBeDefined();
    const { sourceToText: map } = r;
    if (!map) throw new Error("expected sourceToText map");
    // Plain text is 1:1, so the map is the identity and strictly monotonic.
    for (let i = 1; i < map.length; i++) {
      expect(map[i]).toBeGreaterThanOrEqual(map[i - 1]);
    }
    expect(map[map.length - 1]).toBe("bold text".length);
  });

  it("omits sourceToText for the slow path", () => {
    const r = renderToText("see `code`");
    expect(r.sourceToText).toBeUndefined();
  });

  it("preserves math source as plain text", () => {
    const r = renderToText("x = $y^2$");
    expect(r.text).toContain("$y^2$");
  });
});

describe("renderToHtml — block-level rendering ()", () => {
  it("renders all six heading levels", () => {
    for (let n = 1; n <= 6; n++) {
      const r = renderToHtml(`${"#".repeat(n)} H${n}\n\nbody`);
      expect(r.html).toContain(`cf-doc-heading--h${n}`);
      expect(r.html).toContain(`>H${n}</h${n}>`);
    }
  });

  it("renders an ordered list with start attribute", () => {
    const r = renderToHtml("3. three\n4. four");
    expect(r.html).toContain('<ol class="cf-doc-list cf-doc-list--ordered cf-doc-list--tight');
    expect(r.html).toContain('start="3"');
    expect(r.html).toContain('<span class="cf-list-number">3.</span> three');
    expect(r.html).toContain('<span class="cf-list-number">4.</span> four');
  });

  it("renders task list items with checkbox + data-checked", () => {
    const r = renderToHtml("- [ ] open\n- [x] done");
    expect(r.html).toContain('cf-doc-list--check');
    expect(r.html).toContain('cf-doc-list-item--check');
    expect(r.html).toContain('data-checked="false"');
    expect(r.html).toContain('data-checked="true"');
    expect(r.html).toContain('type="checkbox"');
    expect(r.html).toContain('<span class="cf-list-bullet">•</span> <input');
    expect(r.html).toContain('tabindex="-1"');
    expect(r.html).toContain('aria-disabled="true"');
    expect(r.html.toLowerCase()).not.toContain(" disabled");
  });

  it("renders blockquotes", () => {
    const r = renderToHtml("> quoted\n> body");
    expect(r.html).toContain('<blockquote class="cf-doc-blockquote"');
    expect(r.html).toContain('quoted');
  });

  it("renders fenced blockquotes with the shared document block class", () => {
    const r = renderToHtml("::: {.blockquote}\nquoted\n:::");
    expect(r.html).toContain('class="cf-doc-block cf-doc-block--blockquote"');
    expect(r.html).toContain("quoted");
    expect(r.html).not.toContain("cf-block-blockquote");
  });

  it("renders fenced code with language attribute, HTML-escaped contents", () => {
    const r = renderToHtml("```js\nconst x = '<b>';\n```");
    expect(r.html).toContain('class="cf-doc-code-block"');
    expect(r.html).toContain('data-lang="js"');
    expect(r.html).toContain('<span class="cf-codeblock-language">js</span>');
    expect(r.html).toContain('<code class="language-js">');
    expect(r.html).toContain('&lt;b&gt;');
    expect(r.html).not.toContain('<b>');
  });

  it("renders inline code inside a heading", () => {
    const r = renderToHtml("# Use `foo` here");
    expect(r.html).toContain('cf-doc-heading--h1');
    expect(r.html).toContain('<code class="cf-doc-code-token cf-inline-code">foo</code>');
  });

  it("renders horizontal rules", () => {
    const r = renderToHtml("a\n\n---\n\nb");
    expect(r.html).toContain('<hr class="cf-doc-block cf-doc-block--hr"');
  });

  it("renders tables with header, body, and cell alignment", () => {
    const r = renderToHtml("| a | b |\n|:--|--:|\n| 1 | 2 |");
    expect(r.html).toContain('<table class="cf-doc-table-block"');
    expect(r.html).toContain('<thead>');
    expect(r.html).toContain('<tbody>');
    expect(r.html).toContain('cf-doc-table-header');
    expect(r.html).toMatch(/text-align:left|data-align="left"/);
    expect(r.html).toMatch(/text-align:right|data-align="right"/);
  });

  it("propagates hasMath when math appears inside a table cell", () => {
    const r = renderToHtml("| value |\n| --- |\n| $x^2$ |");
    expect(r.html).toContain('class="cf-doc-inline-math cf-math-inline"');
    expect(r.html).toContain('data-math="x^2"');
    expect(r.hasMath).toBe(true);
  });

  it("renders footnote refs + shared numbered section at end", () => {
    const r = renderToHtml("Here[^a] and there[^b].\n\n[^a]: first\n[^b]: second");
    expect(r.html).toContain('class="cf-footnote-ref"');
    expect(r.html).toContain('href="#fn-a"');
    expect(r.html).toContain('id="fnref-a"');
    expect(r.html).toContain('<div class="cf-footnote-section" aria-label="Footnotes">');
    expect(r.html).toContain('<h2 class="cf-bibliography-heading">Footnotes</h2>');
    expect(r.html).toContain('<div class="cf-bibliography-list">');
    expect(r.html).toContain('id="fn-a"');
    expect(r.html).toContain('class="cf-footnote-backref"');
  });

  it("propagates hasMath when math appears inside a footnote body", () => {
    const r = renderToHtml("see [^1].\n\n[^1]: math here: $x^2$.");
    expect(r.hasMath).toBe(true);
  });

  it("uses shared inline fragments for footnote definition bodies", () => {
    const r = renderToHtml(
      "See [^note].\n\n[^note]: As shown in [@knuth1984] and **bold**.",
      undefined,
      { sourcePositions: true },
    );
    expect(r.html).toContain("[@knuth1984]");
    expect(r.html).toContain('<strong class="cf-bold"');
    expect(r.html).not.toContain('cf-crossref-unresolved');
    expect(r.html).not.toContain('data-ref-key="knuth1984"');
  });

  it("renders .algo divs as line-mode pseudocode with indent and math", () => {
    const doc = [
      '::: {.algo #alg:min title="Compute a minimum."}',
      "$\\textsc{Min}(f)$:",
      "  if $|V| \\le 6$",
      "    return brute force",
      ":::",
    ].join("\n");
    const r = renderToHtml(doc);
    expect(r.html).toContain("cf-doc-block--algo");
    expect(r.html).toContain('id="alg:min"');
    // Theorem-style header chrome: label + parenthesized title, so the
    // reader pixel-matches the CM6 editor rendering of the same block.
    expect(r.html).toContain('<span class="cf-block-header-rendered">Algorithm 1</span>');
    expect(r.html).toContain("Compute a minimum.");
    // One line per physical line, indent as CSS custom property.
    const lineCount = (r.html.match(/cf-doc-algo-line/g) ?? []).length;
    expect(lineCount).toBe(3);
    expect(r.html).toContain('data-indent="1"');
    expect(r.html).toContain('data-indent="2"');
    // Literal leading spaces are preserved for editor pixel parity.
    expect(r.html).toContain('>    return brute force</div>');
    // Inline math renders as hydratable math placeholder spans.
    expect(r.hasMath).toBe(true);
    expect(r.html).toContain('data-math="|V| \\le 6"');
  });

  it("renders fenced divs with class and data-* attributes", () => {
    const r = renderToHtml("::: {.theorem #thm-1 title=\"Pythagoras\"}\nbody\n:::");
    expect(r.html).toContain('cf-doc-block-collapsible');
    expect(r.html).toContain('data-cf-block-open="true"');
    // #43: the disclosure toggle is created at hydration, not baked into the
    // static HTML — no inert control and no ▼ glyph in the heading textContent.
    expect(r.html).not.toContain('<button');
    expect(r.html).not.toContain('▼');
    expect(r.html).toContain('<span class="cf-block-heading-content">');
    expect(r.html).toContain('<div class="cf-block-disclosure-body">');
    expect(r.html).toContain('<span class="cf-block-header-rendered">Theorem 1</span>');
    expect(r.html).toContain('<span class="cf-block-attr-title"><span class="cf-block-title-paren">(</span><span>Pythagoras</span><span class="cf-block-title-paren">)</span></span>');
    expect(r.html).toContain('cf-doc-block--theorem');
    expect(r.html).toContain('id="thm-1"');
    expect(r.html).toContain('data-title="Pythagoras"');
  });

  it("can render semantic block headers without disclosure controls for inert previews", () => {
    const r = renderToHtml(
      "::: {.theorem #thm-1 title=\"Pythagoras\"}\nbody\n:::",
      undefined,
      { interactiveBlockDisclosures: false },
    );
    expect(r.html).toContain('<div class="cf-doc-block-heading">');
    expect(r.html).toContain('<span class="cf-block-heading-content">');
    expect(r.html).toContain('<span class="cf-block-header-rendered">Theorem 1</span>');
    expect(r.html).not.toContain('cf-doc-block-collapsible');
    expect(r.html).not.toContain('cf-block-disclosure-toggle');
    expect(r.html).not.toContain('data-cf-block-open');
  });

  it("renders fenced div attribute titles with inline richness", () => {
    const r = renderToHtml("::: {.problem title=\"**3SUM** and $x^2$\"}\nbody\n:::");
    expect(r.html).toContain('<span class="cf-block-attr-title">');
    expect(r.html).toContain('<strong class="cf-bold">3SUM</strong>');
    expect(r.html).toContain('class="cf-doc-inline-math cf-math-inline"');
    expect(r.html).toContain('data-math="x^2"');
    expect(r.hasMath).toBe(true);
  });

  it("renders fenced div inline titles", () => {
    const r = renderToHtml("::: {.definition #def-edge} Edge Connectivity\nbody\n:::");
    expect(r.html).toContain('<span class="cf-block-header-rendered">Definition 1</span>');
    expect(r.html).toContain(
      '<span class="cf-block-attr-title"><span class="cf-block-title-paren">(</span><span>Edge Connectivity</span><span class="cf-block-title-paren">)</span></span>',
    );
    expect(r.html).toContain("body");
  });

  it("renders below-content captions for figure and table blocks", () => {
    const r = renderToHtml(
      [
        '::: {.table #tbl:main title="Results table"}',
        "| A | B |",
        "| --- | --- |",
        "| 1 | 2 |",
        ":::",
        "",
        '::: {.figure #fig:main title="Preview figure"}',
        "![Preview image](preview.png)",
        ":::",
      ].join("\n"),
      undefined,
      { sourcePositions: true },
    );

    expect(r.html).toContain('class="cf-block-caption"');
    expect(r.html).toContain('<span class="cf-block-header-rendered">Table 1</span>');
    expect(r.html).toContain('<span class="cf-block-caption-text">Results table</span>');
    expect(r.html).toContain('<span class="cf-block-header-rendered">Figure 1</span>');
    expect(r.html).toContain('<span class="cf-block-caption-text">Preview figure</span>');
    expect(r.html).toMatch(/<div class="cf-block-caption" data-source-from="\d+" data-source-to="\d+">/);
  });

  it("uses editor-compatible loading placeholders for unresolved relative media", () => {
    const r = renderToHtml("![Preview image](preview.png)\n\n![Paper](paper.pdf)");
    expect(r.html).toContain('class="cf-image-wrapper cf-image-loading"');
    expect(r.html).toContain("[Loading image: Preview image]");
    expect(r.html).toContain("[Loading PDF: Paper]");
    expect(r.html).not.toContain("<img");
  });

  it("renders proof headers inline with the first paragraph", () => {
    const r = renderToHtml("::: {.proof title=\"main theorem\"}\nbody\n:::");
    expect(r.html).toContain('<div class="cf-doc-block cf-doc-block--proof"');
    expect(r.html).toContain('<p class="cf-doc-paragraph cf-block-qed"><span class="cf-doc-block-heading"><span class="cf-block-header-rendered">Proof</span></span>body</p>');
  });

  it("renders same-length nested fenced divs inside their outer block", () => {
    const r = renderToHtml(
      [
        "::: {.proof}",
        "Before.",
        "",
        "::: {.problem}",
        "Inner.",
        ":::",
        "",
        "After.",
        ":::",
      ].join("\n"),
    );
    const problemIndex = r.html.indexOf('cf-doc-block--problem');
    const afterIndex = r.html.indexOf("After.");
    const outerCloseIndex = r.html.lastIndexOf("</div>");
    expect(r.html).toContain('cf-doc-block--proof');
    expect(problemIndex).toBeGreaterThan(-1);
    expect(afterIndex).toBeGreaterThan(problemIndex);
    expect(afterIndex).toBeLessThan(outerCloseIndex);
    expect(r.html).not.toContain(":::");
  });

  it("preserves blank source lines inside fenced semantic blocks", () => {
    const r = renderToHtml("::: {.proof}\nfirst\n\nsecond\n\n\nthird\n:::");
    const blankLines = r.html.match(/class="cf-doc-blank-line"/g) ?? [];
    expect(blankLines).toHaveLength(3);
    expect(r.html).toContain("<p class=\"cf-doc-paragraph\"><span class=\"cf-doc-block-heading\"><span class=\"cf-block-header-rendered\">Proof</span></span>first</p>");
    expect(r.html).toContain('<div class="cf-doc-blank-line" aria-hidden="true"><br></div><p class="cf-doc-paragraph">second</p>');
    expect(r.html).toContain('<p class="cf-doc-paragraph cf-block-qed">third</p>');
  });

  it("preserves blank source lines between top-level document blocks", () => {
    const r = renderToHtml("# Heading\n\nfirst\n\n\n- item\n\nsecond");
    const blankLines = r.html.match(/class="cf-doc-blank-line"/g) ?? [];
    expect(blankLines).toHaveLength(4);
    expect(r.html).toContain(
      '<h1 class="cf-doc-heading cf-doc-heading--h1" data-section-number="1">Heading</h1><div class="cf-doc-blank-line" aria-hidden="true"><br></div><p class="cf-doc-paragraph">first</p>',
    );
    expect(r.html).toContain(
      '<p class="cf-doc-paragraph">first</p><div class="cf-doc-blank-line" aria-hidden="true"><br></div><div class="cf-doc-blank-line" aria-hidden="true"><br></div><ul class="cf-doc-list cf-doc-list--unordered cf-doc-list--tight">',
    );
  });

  it("preserves a trailing blank source line for full documents", () => {
    const r = renderToHtml("# Heading\n\nbody\n");
    expect(r.html.endsWith('<div class="cf-doc-blank-line" aria-hidden="true"><br></div>')).toBe(true);
  });

  it("emits inline math placeholder with canonical class + hasMath flag", () => {
    const r = renderToHtml("x is $y^2$ today");
    expect(r.hasMath).toBe(true);
    expect(r.html).toContain("cf-doc-inline-math");
    expect(r.html).toContain("cf-math-inline");
    expect(r.html).toContain('data-math="y^2"');
  });

  it("renders hard line breaks as br elements", () => {
    const r = renderToHtml("first line  \nsecond line");
    expect(r.html).toContain("first line");
    expect(r.html).toContain("<br>");
    expect(r.html).toContain("second line");
  });

  it("emits display math placeholder with canonical class", () => {
    const r = renderToHtml("eq:\n\n$$x^2$$\n\nend");
    expect(r.hasMath).toBe(true);
    expect(r.html).toContain('cf-doc-display-math');
    expect(r.html).toContain('cf-math-display');
    expect(r.html).toContain('data-math="x^2"');
  });

  it("returns a Lezer-backed reference preview index when requested", () => {
    const source = [
      "# Intro {#sec:intro}",
      "",
      "$$",
      "x^2",
      "$$ {#eq:square}",
      "",
      "::: {.theorem #thm:main title=\"Main\"}",
      "body",
      ":::",
      "",
      "See [@sec:intro], [@eq:square], and [@thm:main].",
    ].join("\n");

    expect(renderToHtml(source, undefined, { resolveReferences: true }).referencePreviewIndex)
      .toBeUndefined();

    const r = renderToHtml(source, undefined, {
      referencePreviews: true,
      resolveReferences: true,
    });
    const heading = r.referencePreviewIndex?.["sec:intro"];
    expect(heading).toMatchObject({
      kind: "heading",
      label: "Section 1",
      title: "Intro",
      level: 1,
      number: "1",
    });
    expect(heading?.kind).toBe("heading");
    if (heading?.kind === "heading") {
      expect(source.slice(heading.from, heading.to)).toBe("# Intro {#sec:intro}");
    }

    const equation = r.referencePreviewIndex?.["eq:square"];
    expect(equation).toMatchObject({
      kind: "equation",
      label: "Eq. (1)",
      latex: "x^2",
      number: "1",
      ordinal: 1,
    });
    expect(equation?.kind).toBe("equation");
    if (equation?.kind === "equation") {
      expect(source.slice(equation.from, equation.to)).toBe("$$\nx^2\n$$ {#eq:square}");
      expect(source.slice(equation.bodyFrom, equation.bodyTo)).toBe("x^2");
    }

    expect(r.referencePreviewIndex?.["thm:main"]).toMatchObject({
      kind: "block",
      label: "Theorem 1",
      blockType: "theorem",
      title: "Main",
      number: "1",
      ordinal: 1,
    });
    const theorem = r.referencePreviewIndex?.["thm:main"];
    expect(theorem?.kind).toBe("block");
    if (theorem?.kind === "block") {
      expect(source.slice(theorem.from, theorem.to)).toContain(
        '::: {.theorem #thm:main title="Main"}',
      );
      expect(source.slice(theorem.bodyFrom, theorem.bodyTo)).toBe("body");
    }
  });

  it("serializes reference preview index ids as own properties", () => {
    const r = renderToHtml("# Prototype {#__proto__}\n\nSee [@__proto__].", undefined, {
      referencePreviews: true,
      resolveReferences: true,
    });
    expect(Object.hasOwn(r.referencePreviewIndex ?? {}, "__proto__"))
      .toBe(true);
    expect(r.referencePreviewIndex?.["__proto__"]).toMatchObject({
      kind: "heading",
      label: "Section 1",
      title: "Prototype",
    });
  });

  it("keeps citation-shaped [@key] text inert without citation context", () => {
    const r = renderToHtml("As shown in [@knuth1984], …");
    expect(r.html).toContain("As shown in [@knuth1984],");
    expect(r.html).not.toContain('cf-crossref-unresolved');
    expect(r.html).not.toContain('data-ref-key="knuth1984"');
  });

  it("keeps citation-shaped [@key] inert with source positions enabled", () => {
    const r = renderToHtml("As shown in [@knuth1984], …", undefined, {
      sourcePositions: true,
    });
    expect(r.html).toContain("[@knuth1984]");
    expect(r.html).toContain('data-source-from="12" data-source-to="24"');
    expect(r.html).not.toContain('cf-crossref-unresolved');
    expect(r.html).not.toContain('data-ref-key="knuth1984"');
  });

  it("keeps citation-shaped [@key] inert when a workspace resolver misses", () => {
    const r = renderToHtml("As shown in [@knuth1984], …", {
      refResolver: {
        resolve: () => null,
      },
    });
    expect(r.html).toContain("As shown in [@knuth1984],");
    expect(r.html).not.toContain('cf-crossref-unresolved');
    expect(r.html).not.toContain('data-ref-key="knuth1984"');
  });

  it("does not derive crossref classes from id prefixes", () => {
    const r = renderToHtml("see [@eq:euler]");
    expect(r.html).toContain('cf-crossref');
    expect(r.html).toContain('cf-crossref-unresolved');
    expect(r.html).not.toContain('cf-crossref-eq');
    expect(r.html).toContain('data-ref-key="eq:euler"');
    expect(r.html).toContain("[@eq:euler]");
  });

  it("uses the shared inline fragment path for narrative references", () => {
    const r = renderToHtml("As @thm:main shows.", {
      refResolver: {
        resolve: (key, mode) => ({
          content: `${mode}:${key}`,
          className: "cf-crossref",
        }),
      },
    });
    expect(r.html).toContain('data-ref-key="thm:main"');
    expect(r.html).toContain('data-ref-mode="narrative"');
    expect(r.html).toContain("narrative:thm:main");
    expect(r.html).not.toContain("@thm:main shows");
  });

  it("keeps narrative reference text inert when no resolver context exists", () => {
    const r = renderToHtml("As @cormen2009 showed.");
    expect(r.html).toContain("As @cormen2009 showed.");
    expect(r.html).not.toContain("cf-crossref-unresolved");
  });

  it("renders bibliography before footnotes to match the rich editor end matter", () => {
    const r = renderToHtml("See [@smith2024] and note[^1].\n\n[^1]: Footnote body.", {
      citationFormatter: createNumericCitationFormatter([{
        id: "smith2024",
        title: "Smith 2024",
      }]),
      citationKeys: new Set(["smith2024"]),
    });

    const root = document.createElement("div");
    root.innerHTML = r.html;
    const bibliography = root.querySelector(".cf-bibliography");
    const footnotes = root.querySelector(".cf-footnote-section");
    expect(bibliography?.textContent).toContain("Smith 2024");
    expect(footnotes?.textContent).toContain("Footnote body");
    expect(bibliography?.compareDocumentPosition(footnotes as Node) ?? 0)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("passes resolver metadata and document path while rendering references", () => {
    const calls: unknown[] = [];
    const r = renderToHtml(
      "see [@eq:euler, p. 2]",
      {
        refResolver: {
          resolve(key, mode, env) {
            calls.push({ key, mode, env });
            return { content: `${key}:${env?.locator}:${env?.documentPath}` };
          },
        },
      },
      { documentPath: "paper.md", sourcePositions: true },
    );
    expect(r.html).toContain("eq:euler:p. 2:paper.md");
    expect(calls).toMatchObject([
      {
        key: "eq:euler",
        mode: "bracketed",
        env: {
          raw: "[@eq:euler, p. 2]",
          sourceRange: { from: 4, to: 21 },
          locator: "p. 2",
          documentPath: "paper.md",
          surface: "reader",
        },
      },
    ]);
  });

  it("separates rendered reader reference clusters", () => {
    const r = renderToHtml(
      "See [@thm:main; @eq:gaussian].",
      {
        refResolver: {
          resolve: (key) => ({
            content: key === "thm:main" ? "Theorem 1" : "Eq. (1)",
            className: "cf-crossref",
          }),
        },
      },
      { sourcePositions: true },
    );

    const root = document.createElement("div");
    root.innerHTML = r.html;
    const cluster = root.querySelector(".cf-citation-cluster");
    expect(cluster?.textContent).toBe("Theorem 1; Eq. (1)");

    const refs = root.querySelectorAll("[data-ref-key]");
    expect(refs).toHaveLength(2);
    expect(refs[0].textContent).toBe("Theorem 1");
    expect(refs[1].textContent).toBe("Eq. (1)");
    const items = root.querySelectorAll("[data-ref-id]");
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute("data-ref-id")).toBe("thm:main");
    expect(items[1].getAttribute("data-ref-id")).toBe("eq:gaussian");
  });

  it("uses shared crossref classes for resolved reader crossrefs", () => {
    const r = renderToHtml("see [@prop:main]", {
      refResolver: {
        resolve: () => ({
          content: "Proposition 1",
          className: "cf-crossref",
        }),
      },
    });

    const root = document.createElement("div");
    root.innerHTML = r.html;
    const ref = root.querySelector("[data-ref-key='prop:main']");
    expect(ref?.classList.contains("cf-crossref")).toBe(true);
    expect(ref?.classList.contains("cf-citation")).toBe(false);
  });

  it("hydrates unresolved reader references and links in place", () => {
    const root = document.createElement("div");
    const source = "See [@page:host] and [docs](./docs.md).";
    root.innerHTML = renderToHtml(source, undefined, { sourcePositions: true }).html;

    hydrateReferences(
      root,
      {
        refResolver: {
          resolve: (key, _mode, env) => ({
            content: `<strong>${key}:${env?.sourceRange?.from}</strong>`,
            href: `/ref/${key}`,
          }),
        },
        linkResolver: {
          resolve: (href, _text, env) => ({
            href: `https://example.com/resolved/${href}`,
            className: `from-${env.documentPath}`,
          }),
        },
      },
      { documentPath: "paper.md", source },
    );

    const ref = root.querySelector("[data-ref-key='page:host']");
    expect(ref?.classList.contains("cf-citation-unresolved")).toBe(false);
    expect(ref?.classList.contains("cf-crossref")).toBe(true);
    expect(ref?.innerHTML).toContain("<strong>page:host:");
    const link = root.querySelector("a[href='https://example.com/resolved/./docs.md']");
    expect(link?.className).toContain("from-paper.md");
    expect(link?.getAttribute("data-cf-link-layout")).toBe("flow");
  });

  it("does not stack link click handlers across repeated hydration", () => {
    const root = document.createElement("div");
    const source = "See [docs](./docs.md).";
    root.innerHTML = renderToHtml(source, undefined, { sourcePositions: true }).html;

    let clicks = 0;
    const ctx = {
      linkResolver: {
        resolve: (href: string) => ({
          href: `https://example.com/${href}`,
          onClick: () => {
            clicks += 1;
          },
        }),
      },
    };

    // Hosts re-run hydrateReferences when async resolver data arrives; the
    // click listener must be attached at most once per anchor.
    hydrateReferences(root, ctx, { documentPath: "paper.md", source });
    hydrateReferences(root, ctx, { documentPath: "paper.md", source });
    hydrateReferences(root, ctx, { documentPath: "paper.md", source });

    root.querySelector("a")?.dispatchEvent(new MouseEvent("click"));
    expect(clicks).toBe(1);
  });

  it("binds the latest link click handler when a later pass resolves a new one", () => {
    const root = document.createElement("div");
    const source = "See [docs](./docs.md).";
    root.innerHTML = renderToHtml(source, undefined, { sourcePositions: true }).html;

    const fired: string[] = [];
    const ctxWith = (label: string) => ({
      linkResolver: {
        resolve: (href: string) => ({
          href: `https://example.com/${href}`,
          onClick: () => {
            fired.push(label);
          },
        }),
      },
    });

    // First pass binds a "stale" handler; a later pass (e.g. async resolver
    // data arriving) resolves a different handler. The click must fire the
    // latest one, not the one bound on the first pass.
    hydrateReferences(root, ctxWith("stale"), { documentPath: "paper.md", source });
    hydrateReferences(root, ctxWith("fresh"), { documentPath: "paper.md", source });

    root.querySelector("a")?.dispatchEvent(new MouseEvent("click"));
    expect(fired).toEqual(["fresh"]);
  });

  it("drops a stale link handler when a later pass resolves without onClick", () => {
    const root = document.createElement("div");
    const source = "See [docs](./docs.md).";
    root.innerHTML = renderToHtml(source, undefined, { sourcePositions: true }).html;

    let clicks = 0;
    const withClick = {
      linkResolver: {
        resolve: (href: string) => ({
          href: `https://example.com/${href}`,
          onClick: () => {
            clicks += 1;
          },
        }),
      },
    };
    const withoutClick = {
      linkResolver: {
        resolve: (href: string) => ({ href: `https://example.com/${href}` }),
      },
    };

    // First pass attaches a handler; a later pass resolves the same anchor
    // without an onClick. The stale handler must be detached, not left bound.
    hydrateReferences(root, withClick, { documentPath: "paper.md", source });
    hydrateReferences(root, withoutClick, { documentPath: "paper.md", source });

    root.querySelector("a")?.dispatchEvent(new MouseEvent("click"));
    expect(clicks).toBe(0);
  });

  it("emits data-source-line when sourceLineAttribution is enabled", () => {
    const src = "# top\n\nfirst paragraph\n\n## h2\n\nsecond";
    const r = renderToHtml(src, undefined, { sourceLineAttribution: true });
    expect(r.html).toContain('data-source-line="1"');
    expect(r.html).toContain('data-source-line="3"');
    expect(r.html).toContain('data-source-line="5"');
    expect(r.html).toContain('data-source-line="7"');
  });

  it("omits data-source-line by default", () => {
    const r = renderToHtml("# top\n\nbody");
    expect(r.html).not.toContain('data-source-line');
  });

  it("wraps multi-paragraph documents in canonical paragraph classes", () => {
    const r = renderToHtml("first\n\nsecond");
    expect(r.html).toContain('<p class="cf-doc-paragraph">first</p>');
    expect(r.html).toContain('<div class="cf-doc-blank-line" aria-hidden="true"><br></div>');
    expect(r.html).toContain('<p class="cf-doc-paragraph">second</p>');
  });

  it("keeps bare-inline shape for single-paragraph (no <p>)", () => {
    const r = renderToHtml("hello *world*");
    expect(r.html).toBe('hello <em class="cf-italic">world</em>');
  });
});

describe("renderToHtml — truncation ()", () => {
  it("stops before next block when lines budget exhausted (4 paragraphs, lines:2)", () => {
    const src = "p1\n\np2\n\np3\n\np4";
    const r = renderToHtml(src, undefined, { truncate: { lines: 2 } });
    expect(r.truncated).toBeDefined();
    // 2 paragraphs emitted, then marker.
    const pCount = (r.html.match(/<p class="cf-doc-paragraph"/g) ?? []).length;
    expect(pCount).toBe(2);
    expect(r.html).toContain('class="cf-truncation-marker"');
    // sourceFrom = start of paragraph 3 = index of "p3" in src.
    expect(r.truncated?.sourceFrom).toBe(src.indexOf("p3"));
    expect(r.truncated?.sourceTo).toBe(src.length);
  });

  it("emits no marker when source fits under the budget", () => {
    const src = "p1\n\np2";
    const r = renderToHtml(src, undefined, { truncate: { lines: 5 } });
    expect(r.truncated).toBeUndefined();
    expect(r.html).not.toContain("cf-truncation-marker");
  });

  it("emits no marker when no truncate option is passed", () => {
    const src = "p1\n\np2\n\np3";
    const r = renderToHtml(src);
    expect(r.truncated).toBeUndefined();
    expect(r.html).not.toContain("cf-truncation-marker");
  });

  it("truncates on chars budget for a long paragraph followed by more", () => {
    const long = "a".repeat(200);
    const src = `${long}\n\ntail`;
    const r = renderToHtml(src, undefined, { truncate: { chars: 50 } });
    // First block (paragraph of 200 chars) is atomic — emitted as a whole —
    // but the tail is dropped.
    expect(r.truncated).toBeDefined();
    expect(r.html).toContain("cf-truncation-marker");
    expect(r.html).not.toContain("tail");
  });

  it("stops at a heading boundary rather than splitting it", () => {
    const src = "p1\n\n# heading\n\np2";
    const r = renderToHtml(src, undefined, { truncate: { lines: 1 } });
    expect(r.truncated).toBeDefined();
    expect(r.html).toContain('class="cf-doc-paragraph"');
    expect(r.html).not.toContain("<h1");
    expect(r.truncated?.sourceFrom).toBe(src.indexOf("# heading"));
  });

  it("never splits a fenced code block (atomic)", () => {
    const code = "```\nL1\nL2\nL3\nL4\nL5\n```";
    const src = `${code}\n\ntail`;
    const r = renderToHtml(src, undefined, { truncate: { lines: 2 } });
    expect(r.truncated).toBeDefined();
    // Code block must appear in full.
    expect(r.html).toContain("L1");
    expect(r.html).toContain("L5");
    expect(r.html).not.toContain("tail");
  });

  it("never splits a math display block (atomic)", () => {
    const src = "$$\na + b\n$$\n\ntail";
    const r = renderToHtml(src, undefined, { truncate: { lines: 0.5 as unknown as number } });
    // Note: lines:0 would emit nothing, so use a small > 0 budget via lines:1.
    const r1 = renderToHtml(src, undefined, { truncate: { lines: 1 } });
    expect(r1.truncated).toBeDefined();
    expect(r1.html).toContain("cf-doc-display-math");
    expect(r1.html).not.toContain("tail");
    void r;
  });

  it("marker has correct class and data attributes", () => {
    const src = "p1\n\np2\n\np3";
    const r = renderToHtml(src, undefined, { truncate: { lines: 1 } });
    expect(r.html).toMatch(
      /<span class="cf-truncation-marker" data-source-from="\d+" data-source-to="\d+"><\/span>/,
    );
    const m = r.html.match(/data-source-from="(\d+)" data-source-to="(\d+)"/);
    expect(m).not.toBeNull();
    if (!m) throw new Error("expected truncation source attrs");
    expect(Number(m[1])).toBe(r.truncated?.sourceFrom);
    expect(Number(m[2])).toBe(r.truncated?.sourceTo);
  });

  it("re-rendering source.slice(truncated.sourceFrom) yields a sane document", () => {
    const src = "# Title\n\npara one\n\npara two\n\npara three";
    const r = renderToHtml(src, undefined, { truncate: { lines: 2 } });
    expect(r.truncated).toBeDefined();
    if (!r.truncated) throw new Error("expected truncation info");
    const rest = src.slice(r.truncated.sourceFrom);
    const r2 = renderToHtml(rest);
    expect(r2.html).toContain("para two");
    expect(r2.html).toContain("para three");
  });
});

describe("renderToText — truncation ()", () => {
  it("stops emitting at block boundary, no marker in text", () => {
    const src = "p1\n\np2\n\np3\n\np4";
    const r = renderToText(src, undefined, { truncate: { lines: 2 } });
    expect(r.truncated).toBeDefined();
    expect(r.text).not.toContain("cf-truncation-marker");
    expect(r.text).toContain("p1");
    expect(r.text).toContain("p2");
    expect(r.text).not.toContain("p3");
    expect(r.text).not.toContain("p4");
  });
});

describe("sanitization", () => {
  it("strips script content injected via LinkResolver className", () => {
    const linkResolver: LinkResolver = {
      resolve() {
        return { className: '"><script>x</script><a class="' };
      },
    };
    const r = renderToHtml("[x](https://e.com)", { linkResolver });
    expect(r.html.toLowerCase()).not.toContain("<script");
  });
});
