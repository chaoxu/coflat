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
import { removeBlockquote } from "./remove-blockquote";
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
 * Semantic-only parser extensions.
 *
 * Editor/source semantics strip ordinary `>` blockquotes because Coflat
 * blockquotes are modeled as fenced divs. HTML render surfaces intentionally
 * omit this extension so authored Markdown blockquotes can still be displayed.
 */
export const semanticOnlyMarkdownExtensions = [
  removeBlockquote,
];

/**
 * Semantic parser extensions used by the editor state and Node parse helpers.
 * This is the default Coflat syntax model.
 */
export const markdownExtensions = [
  removeIndentedCode,
  ...semanticOnlyMarkdownExtensions,
  ...coflatSharedMarkdownExtensions.slice(1),
];

/**
 * Parser extensions for in-app HTML renderers.
 *
 * This is the semantic parser plus one intentional surface distinction:
 * standard `>` blockquotes stay as Blockquote nodes so read/preview surfaces
 * can render authored Markdown as HTML. All parser construction goes through
 * getMarkdownParser/parseMarkdownSource so this distinction stays explicit.
 */
export const htmlRenderExtensions = coflatSharedMarkdownExtensions;

export type MarkdownParserMode = "semantic" | "html-render";

let markdownSemanticParser: ReturnType<typeof baseMarkdownParser.configure> | null = null;
let markdownHtmlRenderParser: ReturnType<typeof baseMarkdownParser.configure> | null = null;

export function getMarkdownParser(mode: MarkdownParserMode = "semantic"): ReturnType<typeof baseMarkdownParser.configure> {
  if (mode === "html-render") {
    markdownHtmlRenderParser ??= baseMarkdownParser.configure(htmlRenderExtensions);
    return markdownHtmlRenderParser;
  }
  markdownSemanticParser ??= baseMarkdownParser.configure(markdownExtensions);
  return markdownSemanticParser;
}

export function parseMarkdownSource(source: string, mode: MarkdownParserMode = "semantic"): Tree {
  return getMarkdownParser(mode).parse(source);
}
