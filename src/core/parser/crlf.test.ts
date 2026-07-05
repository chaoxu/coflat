/**
 * CRLF line-ending regression tests for the raw-source parsers.
 *
 * @lezer/markdown splits lines on `\n` only, so a Windows/`autocrlf` checkout
 * leaves a trailing `\r` on every `line.text` reaching these parsers (the
 * editor is immune — CodeMirror normalizes line separators). Before the fix a
 * bare `:::\r` closer was re-parsed as a new opener that swallowed the rest of
 * the document, and `$$…$$\r` produced no DisplayMath node at all.
 */
import { describe, expect, it } from "vitest";
import { parseNodeNames } from "../test-utils";
import { getMarkdownParser } from "./index";

const parser = getMarkdownParser();

function names(text: string): string[] {
  return parseNodeNames(text, parser);
}

describe("CRLF line endings", () => {
  it("closes a fenced div on a bare `:::\\r` and does not swallow following text", () => {
    const lf = names("::: {.theorem}\nbody\n:::\nafter\n");
    const crlf = names("::: {.theorem}\r\nbody\r\n:::\r\nafter\r\n");
    expect(crlf).toEqual(lf);
    // Exactly one fenced div, and the trailing paragraph survives.
    expect(crlf.filter((n) => n === "FencedDiv")).toHaveLength(1);
    expect(crlf).toContain("Paragraph");
  });

  it("parses short-form fenced divs under CRLF without a `\\r` class name", () => {
    const crlf = names("::: theorem\r\nbody\r\n:::\r\n");
    expect(crlf.filter((n) => n === "FencedDiv")).toHaveLength(1);
    expect(crlf).toContain("FencedDivAttributes");
  });

  it("parses single-line display math under CRLF", () => {
    const lf = names("$$ x^2 $$\ntext\n");
    const crlf = names("$$ x^2 $$\r\ntext\r\n");
    expect(crlf).toEqual(lf);
    expect(crlf).toContain("DisplayMath");
  });

  it("parses multi-line display math under CRLF", () => {
    const crlf = names("$$\r\nx^2\r\n$$\r\ntext\r\n");
    expect(crlf.filter((n) => n === "DisplayMath")).toHaveLength(1);
  });

  it("parses a labeled display-math equation under CRLF", () => {
    const crlf = names("$$ x^2 $$ {#eq:quad}\r\n");
    expect(crlf).toContain("DisplayMath");
    expect(crlf).toContain("EquationLabel");
  });
});
