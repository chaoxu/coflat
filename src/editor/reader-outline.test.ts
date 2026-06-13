import { describe, expect, it } from "vitest";
import { renderToHtml } from "../../reader";

const doc = [
  "# Intro",
  "",
  "Body text.",
  "",
  "## Background {#bg}",
  "",
  "## Background",
  "",
  "# Méthodes & Results!",
].join("\n");

describe("renderToHtml outline option", () => {
  it("is off by default — unlabeled headings carry no id", () => {
    const html = renderToHtml(doc).html;
    expect(html).toContain("<h1");
    // Only the explicitly-labeled heading has an id.
    expect(html).toContain('id="bg"');
    expect(html).not.toContain('id="intro"');
    // No outline field unless requested.
    expect(renderToHtml(doc).outline).toBeUndefined();
  });

  it("returns a document-order outline with ids, levels, and section numbers", () => {
    const { outline } = renderToHtml(doc, undefined, { outline: true });
    expect(outline).toEqual([
      { id: "intro", text: "Intro", level: 1, number: "1" },
      { id: "bg", text: "Background", level: 2, number: "1.1" },
      { id: "background", text: "Background", level: 2, number: "1.2" },
      { id: "methodes-results", text: "Méthodes & Results!", level: 1, number: "2" },
    ]);
  });

  it("emits a matching id on every heading so outline anchors resolve", () => {
    const { html, outline } = renderToHtml(doc, undefined, { outline: true });
    for (const entry of outline ?? []) {
      expect(html).toContain(`id="${entry.id}"`);
    }
  });

  it("keeps an explicit {#id} and de-duplicates slug collisions", () => {
    const { outline } = renderToHtml(doc, undefined, { outline: true });
    const ids = outline?.map((o) => o.id);
    expect(ids).toEqual(["intro", "bg", "background", "methodes-results"]);
    // The second "Background" slug would collide with the first's slug
    // ("background") but the first kept its explicit id "bg", so no suffix.
    expect(new Set(ids).size).toBe(ids?.length);
  });

  it("de-duplicates identical unlabeled headings with a numeric suffix", () => {
    const { outline } = renderToHtml("# Notes\n\n# Notes", undefined, { outline: true });
    expect(outline?.map((o) => o.id)).toEqual(["notes", "notes-2"]);
  });

  it("lets an explicit {#id} win over an earlier auto-slug (no duplicate ids)", () => {
    // The first heading auto-slugs to "background", but a later heading claims
    // {#background} explicitly — the explicit id wins; the auto-slug is suffixed.
    const { html, outline } = renderToHtml(
      "# Background\n\n## Setup {#background}",
      undefined,
      { outline: true },
    );
    expect(outline?.map((o) => o.id)).toEqual(["background-2", "background"]);
    // Exactly one element per id — no duplicate DOM ids.
    expect(html.match(/id="background"/g)?.length).toBe(1);
    expect(html.match(/id="background-2"/g)?.length).toBe(1);
  });

  it("returns an empty outline for a heading-free document", () => {
    expect(renderToHtml("just plain words", undefined, { outline: true }).outline).toEqual([]);
  });

  it("omits the section number for unnumbered headings", () => {
    const { outline } = renderToHtml("# Title {.unnumbered}", undefined, { outline: true });
    expect(outline).toEqual([{ id: "title", text: "Title", level: 1 }]);
  });

  it("does not include headings past a truncation boundary in the outline", () => {
    const { outline } = renderToHtml(
      "# Kept\n\nbody\n\n# Dropped",
      undefined,
      { outline: true, truncate: { lines: 1 } },
    );
    // The second heading is truncated away, so it must not appear in the outline.
    expect(outline?.map((o) => o.id)).toEqual(["kept"]);
  });

  it("does not change html output when the option is off", () => {
    expect(renderToHtml(doc).html).toBe(renderToHtml(doc, undefined, {}).html);
  });
});
