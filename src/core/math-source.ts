import type { SyntaxNode } from "@lezer/common";
import { readBracedLabelId } from "./parser/label-utils";

interface MathDelimiterPair {
  readonly open: string;
  readonly close: string;
}

/** Delimiter patterns for extracting LaTeX content from inline math nodes. */
export const INLINE_DELIMITERS: ReadonlyArray<MathDelimiterPair> = [
  { open: "\\(", close: "\\)" },
  { open: "$", close: "$" },
];

/** Delimiter patterns for extracting LaTeX content from display math nodes. */
export const DISPLAY_DELIMITERS: ReadonlyArray<MathDelimiterPair> = [
  { open: "\\[", close: "\\]" },
  { open: "$$", close: "$$" },
];

/**
 * Strip math delimiters from raw source.
 * `contentTo` slices raw to the end of the closing delimiter, excluding labels.
 */
export function stripMathDelimiters(raw: string, isDisplay: boolean, contentTo?: number): string {
  const trimmed = contentTo !== undefined ? raw.slice(0, contentTo) : raw;
  const delimiters = isDisplay ? DISPLAY_DELIMITERS : INLINE_DELIMITERS;
  for (const { open, close } of delimiters) {
    if (trimmed.startsWith(open) && trimmed.endsWith(close)) {
      return trimmed.slice(open.length, trimmed.length - close.length);
    }
  }
  return trimmed;
}

export function trimSourceRange(source: string, from: number, to: number): { from: number; to: number } {
  while (from < to && /\s/.test(source[from] ?? "")) from++;
  while (to > from && /\s/.test(source[to - 1] ?? "")) to--;
  return { from, to };
}

/**
 * Compute the relative content boundary for a display math node that may
 * contain an EquationLabel child. Returns `undefined` when there is no label.
 */
export function getDisplayMathContentEnd(node: SyntaxNode): number | undefined {
  if (!node.getChild("EquationLabel")) return undefined;
  const marks = node.getChildren("DisplayMathMark");
  if (marks.length >= 2) {
    return marks[marks.length - 1].to - node.from;
  }
  return undefined;
}

export function displayMathLatexRange(
  source: string,
  node: SyntaxNode,
): { from: number; to: number } {
  const plan = displayMathSourcePlan(source, node);
  if (plan) return plan.latexRange;

  const marks = node.getChildren("DisplayMathMark");
  if (marks.length >= 2) {
    return trimSourceRange(source, marks[0].to, marks[marks.length - 1].from);
  }
  const label = node.getChild("EquationLabel");
  const sourceEnd = label ? label.from : node.to;
  return trimSourceRange(source, node.from, sourceEnd);
}

export function displayMathLatex(source: string, node: SyntaxNode): string {
  const plan = displayMathSourcePlan(source, node);
  if (plan) return plan.latex;

  const marks = node.getChildren("DisplayMathMark");
  if (marks.length >= 2) {
    const range = displayMathLatexRange(source, node);
    return source.slice(range.from, range.to);
  }
  const label = node.getChild("EquationLabel");
  const sourceEnd = label ? label.from : node.to;
  return stripMathDelimiters(source.slice(node.from, sourceEnd).trim(), true).trim();
}

export interface DisplayMathSourcePlan {
  readonly sourceRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly contentRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly latexRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly closeMarkRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly labelRange?: {
    readonly from: number;
    readonly to: number;
  };
  readonly labelFrom?: number;
  readonly equationId: string | null;
  readonly latex: string;
}

export function displayMathSourcePlan(
  source: string,
  node: SyntaxNode,
): DisplayMathSourcePlan | null {
  const marks = node.getChildren("DisplayMathMark");
  if (marks.length < 2) return null;

  const closeMark = marks[marks.length - 1];
  const contentRange = { from: marks[0].to, to: closeMark.from };
  const latexRange = trimSourceRange(source, contentRange.from, contentRange.to);
  const label = node.getChild("EquationLabel");
  const labelRange = label ? { from: label.from, to: label.to } : undefined;
  const equationId = label
    ? readBracedLabelId(source, label.from, label.to, "eq:")
    : null;

  return {
    sourceRange: { from: node.from, to: node.to },
    contentRange,
    latexRange,
    closeMarkRange: { from: closeMark.from, to: closeMark.to },
    ...(labelRange ? { labelRange, labelFrom: closeMark.to } : {}),
    equationId,
    latex: source.slice(latexRange.from, latexRange.to),
  };
}
