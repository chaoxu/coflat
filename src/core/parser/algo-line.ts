import { styleTags, tags } from "@lezer/highlight";
import type { BlockContext, BlockParser, Line, MarkdownConfig } from "@lezer/markdown";

/**
 * Line-mode body parsing for `LineFencedDiv` composites.
 *
 * Inside a fenced div whose class has `bodyMode: "lines"` (see
 * block-manifest.ts), every non-blank physical line is one `AlgoLine` node:
 * leading whitespace carries the indentation structure and the rest of the
 * line is parsed as regular inline markdown (math, emphasis, ...). There is
 * no nested block structure — a line starting with `:::`, `#`, or `-` is
 * still just a pseudocode line, which is why this parser registers ahead of
 * every other block parser and simply declines outside line-mode divs.
 *
 * Fence syntax (opener, attributes, closer, nesting) is owned entirely by
 * fenced-div.ts; the closing fence is consumed by the composite callback
 * before block parsers ever see that line.
 */

const algoLineBlockParser: BlockParser = {
  name: "AlgoLine",
  // First in the block parser order: inside a line-mode div every line is a
  // pseudocode line, so nothing else may claim it first. Outside line-mode
  // divs this parser always declines, leaving the order inert.
  before: "LinkReference",

  parse(cx: BlockContext, line: Line) {
    if (cx.depth === 0 || cx.parentType().name !== "LineFencedDiv") return false;
    // Blank (or whitespace-only) lines are vertical spacing, not algo lines.
    if (line.pos >= line.text.length) return false;

    // Include leading whitespace: indentation is the line's block structure.
    const from = cx.lineStart + line.basePos;
    const to = cx.lineStart + line.text.length;
    const text = line.text.slice(line.basePos);
    const children = cx.parser.parseInline(text, from);
    cx.addElement(cx.elt("AlgoLine", from, to, children));
    cx.nextLine();
    return true;
  },
};

/** Number of leading spaces on an algo line (tab counts as one level unit). */
export function algoLineIndentUnits(lineText: string): number {
  let units = 0;
  let i = 0;
  while (i < lineText.length) {
    const ch = lineText.charCodeAt(i);
    if (ch === 32 /* space */) {
      units += 1;
    } else if (ch === 9 /* tab */) {
      units += 2;
    } else {
      break;
    }
    i++;
  }
  return units;
}

/** Indent depth of an algo line: 2 space units = 1 level. */
export function algoLineIndentDepth(lineText: string): number {
  return Math.floor(algoLineIndentUnits(lineText) / 2);
}

/** Markdown extension adding line-mode body parsing for LineFencedDiv. */
export const algoLineExtension: MarkdownConfig = {
  defineNodes: [{ name: "AlgoLine", block: true }],
  props: [
    styleTags({
      AlgoLine: tags.content,
    }),
  ],
  parseBlock: [algoLineBlockParser],
};
