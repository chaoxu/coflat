// Selective re-exports to avoid conflicts with semantics/document
export {
  parseHeadingLine,
  parseHeadingText,
  type ParsedHeadingText,
  type ParsedHeadingLine,
  HEADING_TRAILING_ATTRIBUTES_RE,
  extractLabelId,
} from "./heading-syntax";

export {
  extractHeadingDefinitions,
  extractHeadingsFromMarkdown,
  headingEntriesEqual,
  type HeadingDefinition,
} from "./headings";
