import { describe, expect, it } from "vitest";

import { documentOutlineEntry, headingOutlineEntry, headingOutlineText } from "./outline-surface";

describe("documentOutlineEntry", () => {
  it("preserves shared outline fields and section number", () => {
    expect(documentOutlineEntry({
      id: "intro",
      text: "Intro",
      html: "<strong>Intro</strong>",
      level: 1,
      number: "2",
    })).toEqual({
      id: "intro",
      text: "Intro",
      html: "<strong>Intro</strong>",
      level: 1,
      number: "2",
    });
  });

  it("omits numbers for unnumbered outline entries", () => {
    expect(documentOutlineEntry({
      id: "appendix",
      text: "Appendix",
      html: "Appendix",
      level: 2,
      number: "1.1",
      displayUnnumbered: true,
    })).toEqual({
      id: "appendix",
      text: "Appendix",
      html: "Appendix",
      level: 2,
    });
  });

  it("omits empty numbers", () => {
    expect(documentOutlineEntry({
      id: "note",
      text: "Note",
      html: "Note",
      level: 3,
      number: "",
    })).toEqual({
      id: "note",
      text: "Note",
      html: "Note",
      level: 3,
    });
  });

  it("derives shared heading outline text from inline markdown", () => {
    expect(headingOutlineText("Proof of **Theorem** $a^2$ `code`")).toBe(
      "Proof of Theorem $a^2$ code",
    );
  });

  it("builds heading outline entries from markdown and rendered html", () => {
    expect(headingOutlineEntry({
      id: "proof",
      markdown: "Proof of **Theorem**",
      html: 'Proof of <strong class="cf-bold">Theorem</strong>',
      level: 2,
      number: "1.1",
    })).toEqual({
      id: "proof",
      text: "Proof of Theorem",
      html: 'Proof of <strong class="cf-bold">Theorem</strong>',
      level: 2,
      number: "1.1",
    });
  });
});
