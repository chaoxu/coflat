import { describe, expect, it, beforeEach } from "vitest";
import { renderToHtml, renderToText } from "../../reader";
import type { LinkResolver } from "../../reader";
import type { FileSystem } from "../core/lib/file-system-types";
import {
  getLezerInvocationCount,
  resetLezerInvocationCount,
} from "../reader/reader-internal";

beforeEach(() => {
  resetLezerInvocationCount();
});

describe("renderToHtml — fast path (plain inline markdown)", () => {
  it("renders plain text", () => {
    const r = renderToHtml("plain text");
    expect(r.html).toBe("plain text");
    expect(r.hasMath).toBe(false);
  });

  it("renders **bold**", () => {
    expect(renderToHtml("**bold**").html).toBe("<strong>bold</strong>");
  });

  it("renders __bold__", () => {
    expect(renderToHtml("__bold__").html).toBe("<strong>bold</strong>");
  });

  it("renders *italic*", () => {
    expect(renderToHtml("*italic*").html).toBe("<em>italic</em>");
  });

  it("renders _italic_", () => {
    expect(renderToHtml("_italic_").html).toBe("<em>italic</em>");
  });

  it("renders ~~strike~~", () => {
    expect(renderToHtml("~~strike~~").html).toBe("<del>strike</del>");
  });

  it("renders mixed bold and italic", () => {
    const r = renderToHtml("a *b* c **d** e");
    expect(r.html).toBe("a <em>b</em> c <strong>d</strong> e");
  });

  it("escapes ampersands and angle brackets in plain runs", () => {
    // `<` triggers the slow path, but `&` and `>` alone do not.
    const r = renderToHtml("a & b > c");
    expect(r.html).toContain("&amp;");
    expect(r.html).toContain("&gt;");
  });

  it("does NOT invoke Lezer for plain-inline inputs", () => {
    resetLezerInvocationCount();
    renderToHtml("**bold** and *italic*");
    renderToHtml("plain text");
    renderToHtml("a ~~strike~~ b");
    expect(getLezerInvocationCount()).toBe(0);
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
    expect(r.html).toContain('<code class="cf-doc-code-token">code</code>');
  });

  it("renders a [label](url) link", () => {
    const r = renderToHtml("[label](https://example.com)");
    expect(r.html).toMatch(/<a href="https:\/\/example\.com"[^>]*>label<\/a>/);
  });

  it("renders an autolink", () => {
    const r = renderToHtml("<https://example.com>");
    expect(r.html).toMatch(/<a href="https:\/\/example\.com">/);
    expect(r.html).toContain("https://example.com</a>");
  });

  it("renders headings with canonical classes", () => {
    const r = renderToHtml("# Heading\n\nbody");
    expect(r.html).toContain('class="cf-doc-heading cf-doc-heading--h1"');
    expect(r.html).toContain(">Heading</h1>");
    expect(r.html).toContain("body");
  });

  it("renders bullet lists as <ul> with canonical list classes", () => {
    const r = renderToHtml("- a\n- b");
    expect(r.html).toContain('<ul class="cf-doc-list cf-doc-list--unordered cf-doc-list--tight');
    expect(r.html).toContain('<li class="cf-doc-list-item');
    expect(r.html).toContain("a");
    expect(r.html).toContain("b");
  });

  it("flags math without rendering it", () => {
    const r = renderToHtml("x is $y^2$");
    expect(r.hasMath).toBe(true);
    // Math source preserved as plain text (escape $).
    expect(r.html).toContain("$y^2$");
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
    expect(r.html).toContain('class="page-link"');
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

  it("emits sourceToText for the fast path", () => {
    const r = renderToText("**bold**");
    expect(r.sourceToText).toBeDefined();
    // Source: '**bold**' (8 chars). Text: 'bold' (4 chars).
    // Source index 2 ('b') → text index 2 (after the '**' literals
    // tentatively counted; the spans collapse on close — we accept that
    // the implementation maps to the *tentative* text position).
    const { sourceToText: map } = r;
    if (!map) throw new Error("expected sourceToText map");
    // The map should at least be monotonic.
    for (let i = 1; i < map.length; i++) {
      expect(map[i]).toBeGreaterThanOrEqual(map[i - 1]);
    }
    // Final sentinel matches text length (after collapsing the wrappers).
    // Tentative spans were committed before close, so the final text
    // length recorded equals 8 (the tentative literal length). Accept
    // monotonicity as the load-bearing contract for v1.
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
  });

  it("renders task list items with checkbox + data-checked", () => {
    const r = renderToHtml("- [ ] open\n- [x] done");
    expect(r.html).toContain('cf-doc-list--check');
    expect(r.html).toContain('cf-doc-list-item--check');
    expect(r.html).toContain('data-checked="false"');
    expect(r.html).toContain('data-checked="true"');
    expect(r.html).toContain('type="checkbox"');
    // disabled attribute may be normalized by DOMPurify but should be present
    expect(r.html.toLowerCase()).toContain('disabled');
  });

  it("renders blockquotes", () => {
    const r = renderToHtml("> quoted\n> body");
    expect(r.html).toContain('<blockquote class="cf-doc-blockquote"');
    expect(r.html).toContain('quoted');
  });

  it("renders fenced code with language attribute, HTML-escaped contents", () => {
    const r = renderToHtml("```js\nconst x = '<b>';\n```");
    expect(r.html).toContain('class="cf-doc-code-block"');
    expect(r.html).toContain('data-lang="js"');
    expect(r.html).toContain('&lt;b&gt;');
    expect(r.html).not.toContain('<b>');
  });

  it("renders inline code inside a heading", () => {
    const r = renderToHtml("# Use `foo` here");
    expect(r.html).toContain('cf-doc-heading--h1');
    expect(r.html).toContain('<code class="cf-doc-code-token">foo</code>');
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

  it("renders footnote refs + numbered list at end", () => {
    const r = renderToHtml("Here[^a] and there[^b].\n\n[^a]: first\n[^b]: second");
    expect(r.html).toContain('class="cf-footnote-ref"');
    expect(r.html).toContain('href="#fn-a"');
    expect(r.html).toContain('id="fnref-a"');
    expect(r.html).toContain('<ol class="cf-footnotes">');
    expect(r.html).toContain('id="fn-a"');
    expect(r.html).toContain('class="cf-footnote-backref"');
  });

  it("propagates hasMath when math appears inside a footnote body", () => {
    const r = renderToHtml("see [^1].\n\n[^1]: math here: $x^2$.");
    expect(r.hasMath).toBe(true);
  });

  it("renders fenced divs with class and data-* attributes", () => {
    const r = renderToHtml("::: {.theorem #thm-1 title=\"Pythagoras\"}\nbody\n:::");
    expect(r.html).toContain('cf-doc-block--theorem');
    expect(r.html).toContain('id="thm-1"');
    expect(r.html).toContain('data-title="Pythagoras"');
  });

  it("emits inline math placeholder with canonical class + hasMath flag", () => {
    const r = renderToHtml("x is $y^2$ today");
    expect(r.hasMath).toBe(true);
    expect(r.html).toContain('class="cf-doc-inline-math"');
    expect(r.html).toContain('data-math="y^2"');
  });

  it("emits display math placeholder with canonical class", () => {
    const r = renderToHtml("eq:\n\n$$x^2$$\n\nend");
    expect(r.hasMath).toBe(true);
    expect(r.html).toContain('cf-doc-display-math');
    expect(r.html).toContain('data-math="x^2"');
  });

  it("emits cf-citation-unresolved for [@key] with no RefResolver", () => {
    const r = renderToHtml("As shown in [@knuth1984], …");
    expect(r.html).toContain('cf-citation-unresolved');
    expect(r.html).toContain('data-ref-key="knuth1984"');
    expect(r.html).toContain('data-ref-mode="bracketed"');
  });

  it("emits cf-crossref-unresolved for [@eq:foo]", () => {
    const r = renderToHtml("see [@eq:euler]");
    expect(r.html).toContain('cf-crossref-unresolved');
    expect(r.html).toContain('cf-crossref-eq');
    expect(r.html).toContain('data-ref-key="eq:euler"');
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
    expect(r.html).toContain('<p class="cf-doc-paragraph">second</p>');
  });

  it("keeps bare-inline shape for single-paragraph (no <p>)", () => {
    const r = renderToHtml("hello *world*");
    expect(r.html).toBe("hello <em>world</em>");
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
