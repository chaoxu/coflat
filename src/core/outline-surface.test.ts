import { describe, expect, it } from "vitest";

import { documentOutlineEntry } from "./outline-surface";

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
});

