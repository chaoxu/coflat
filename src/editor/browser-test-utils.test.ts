import { describe, expect, it } from "vitest";
import {
  assertCoflatCodeBlockParity,
  assertCoflatFootnoteSectionParity,
  assertCoflatLinkStyleParity,
  assertCoflatReaderEditorSurfaceParity,
} from "./browser-test-utils";

const surface = {
  width: 720,
  paddingTop: "0px",
  paddingInline: ["0px", "0px"],
  font: "KaTeX_Main, serif",
  fontSize: "16px",
  lineHeight: "24px",
  displayMathSize: "16px",
  katexSize: "16px",
  katexDisplayMargin: "1em 0px",
  headingNumbers: ["1", "2", null],
  listMarkers: 2,
};

describe("browser parity assertion helpers", () => {
  it("accepts matching reader/editor surface stats", () => {
    expect(() => assertCoflatReaderEditorSurfaceParity(surface, surface)).not.toThrow();
  });

  it("rejects renderer drift", () => {
    expect(() =>
      assertCoflatReaderEditorSurfaceParity(surface, {
        ...surface,
        lineHeight: "25px",
      })
    ).toThrow(/lineHeight mismatch/);
  });

  it("checks dotted link parity", () => {
    const link = {
      text: "target",
      line: "underline",
      style: "dotted",
      thickness: "1px",
      underlineOffset: "2px",
      color: "rgb(0, 0, 0)",
      display: "inline",
    };
    expect(() => assertCoflatLinkStyleParity(link, link)).not.toThrow();
  });

  it("checks code block parity", () => {
    expect(() =>
      assertCoflatCodeBlockParity(
        {
          count: 1,
          languageText: "ts",
          pre: { whiteSpace: "pre", wordBreak: "normal", overflowWrap: "normal", fontFamily: "monospace" },
          code: { whiteSpace: "pre", wordBreak: "normal", overflowWrap: "normal", fontFamily: "monospace" },
        },
        {
          count: 1,
          languageText: "ts",
          lines: [{ whiteSpace: "pre", wordBreak: "normal", overflowWrap: "normal", fontFamily: "monospace" }],
        },
      )
    ).not.toThrow();
  });

  it("rejects unstable code block wrapping", () => {
    expect(() =>
      assertCoflatCodeBlockParity(
        {
          count: 1,
          languageText: "ts",
          pre: { whiteSpace: "pre", wordBreak: "normal", overflowWrap: "anywhere", fontFamily: "monospace" },
          code: { whiteSpace: "pre", wordBreak: "normal", overflowWrap: "break-word", fontFamily: "monospace" },
        },
        {
          count: 1,
          languageText: "ts",
          lines: [{ whiteSpace: "pre", wordBreak: "normal", overflowWrap: "normal", fontFamily: "monospace" }],
        },
      )
    ).toThrow(/reader code block wrapping drift/);
  });

  it("checks footnote section parity", () => {
    const footnotes = {
      count: 2,
      heading: "Footnotes",
      numbers: ["1", "2"],
      hasBackrefs: true,
      hasMath: true,
      text: "This footnote has bold and math.",
    };
    expect(() => assertCoflatFootnoteSectionParity(footnotes, footnotes)).not.toThrow();
  });
});
