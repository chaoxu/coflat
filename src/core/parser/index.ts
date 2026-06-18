export { equationLabelExtension } from "./equation-label";
export { countColons, fencedDiv } from "./fenced-div";
export type { FencedDivAttrs } from "./fenced-div-attrs";
export { extractDivClass, parseFencedDivAttrs } from "./fenced-div-attrs";
export { footnoteExtension } from "./footnote";
export {
  type BlockConfig,
  extractRawFrontmatter,
  type FrontmatterConfig,
  type FrontmatterResult,
  type FrontmatterStatus,
  parseFrontmatter,
} from "./frontmatter";
export { highlightExtension } from "./highlight";
export { mathExtension } from "./math-backslash";
export { removeBlockquote } from "./remove-blockquote";
export { removeIndentedCode } from "./remove-indented-code";
export { strikethroughExtension } from "./strikethrough";
export { tableExtension } from "./table";

import { Autolink, parser as baseMarkdownParser, TaskList } from "@lezer/markdown";
import type { Tree } from "@lezer/common";
import { equationLabelExtension } from "./equation-label";
import { fencedDiv } from "./fenced-div";
import { footnoteExtension } from "./footnote";
import { highlightExtension } from "./highlight";
import { mathExtension } from "./math-backslash";
import { removeIndentedCode } from "./remove-indented-code";
import { strikethroughExtension } from "./strikethrough";
import { tableExtension } from "./table";

/**
 * Coflat syntax extensions shared by every parser profile.
 *
 * Keep new FORMAT.md syntax here unless a surface has a documented reason to
 * parse it differently. Reader/editor parity depends on this being the common
 * source of truth instead of parallel hand-maintained extension arrays.
 */
export const coflatSharedMarkdownExtensions = [
  removeIndentedCode,
  mathExtension,
  fencedDiv,
  equationLabelExtension,
  strikethroughExtension,
  highlightExtension,
  footnoteExtension,
  tableExtension,
  Autolink,
  TaskList,
];

/**
 * Deprecated compatibility export for callers that used to inspect parser
 * profile deltas. Reader and editor now intentionally share the same parser.
 */
export const semanticOnlyMarkdownExtensions = [];

/**
 * Semantic parser extensions used by the editor state and Node parse helpers.
 * This is the default Coflat syntax model.
 */
export const markdownExtensions = coflatSharedMarkdownExtensions;

/**
 * Parser extensions for in-app HTML renderers.
 *
 * Kept as an alias so older call sites can keep naming their surface, while
 * both reader and editor use the exact same Coflat parser profile.
 */
export const htmlRenderExtensions = coflatSharedMarkdownExtensions;

export type MarkdownParserMode = "semantic" | "html-render";

let markdownParser: ReturnType<typeof baseMarkdownParser.configure> | null = null;

export function getMarkdownParser(mode: MarkdownParserMode = "semantic"): ReturnType<typeof baseMarkdownParser.configure> {
  void mode;
  markdownParser ??= baseMarkdownParser.configure(coflatSharedMarkdownExtensions);
  return markdownParser;
}

export function parseMarkdownSource(source: string, mode: MarkdownParserMode = "semantic"): Tree {
  return getMarkdownParser(mode).parse(source);
}
