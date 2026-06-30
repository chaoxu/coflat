import type { Tree } from "@lezer/common";
import {
  buildFootnotePlan,
} from "../../core/semantics/footnote-plan";
import type {
  DocumentSemantics,
  EquationSemantics,
  FencedDivSemantics,
  FootnoteSemantics,
  HeadingSemantics,
  MathSemantics,
  OrderedFootnoteEntry,
  ReferenceSemantics,
  TextSource,
} from "./document-model";
import {
  findTrailingHeadingAttributes,
  hasUnnumberedHeadingAttributes,
  type TrailingHeadingAttributes,
} from "./heading-attributes";
import {
  createDocumentAnalysis,
  createDocumentArtifacts,
  type DocumentArtifacts,
} from "./incremental/engine";
import { buildEquationSlice } from "./incremental/slices/equation-slice";
import {
  buildFootnoteSlice,
  type FootnoteSlice,
} from "./incremental/slices/footnote-slice";
import { buildHeadingSlice } from "./incremental/slices/heading-slice";
import { buildMathSlice } from "./incremental/slices/math-slice";
import { buildReferenceSlice } from "./incremental/slices/reference-slice";
import { extractStructuralWindow } from "./incremental/window-extractor";

export type {
  DocumentAnalysis,
  DocumentSemantics,
  EquationSemantics,
  FencedDivSemantics,
  FootnoteDefinition,
  FootnoteReference,
  FootnoteSemantics,
  HeadingSemantics,
  MathSemantics,
  OrderedFootnoteEntry,
  ReferenceSemantics,
  TextSource,
  TextSourceLine,
} from "./document-model";
export {
  getEquationNumbersCacheKey,
  stringTextSource,
} from "./document-model";

// Equation label extraction now lives in the shared window extractor, which
// still uses readBracedLabelId from src/parser/label-utils.ts.
export type { DocumentArtifacts };
export {
  findTrailingHeadingAttributes,
  hasUnnumberedHeadingAttributes,
  type TrailingHeadingAttributes,
};

function isFootnoteSlice(value: FootnoteSemantics): value is FootnoteSlice {
  return "numberById" in value && "orderedEntries" in value;
}

// ---------------------------------------------------------------------------
// Public per-category analyzers.
// ---------------------------------------------------------------------------

export function analyzeHeadings(doc: TextSource, tree: Tree): HeadingSemantics[] {
  return [...buildHeadingSlice(extractStructuralWindow(doc, tree)).headings];
}

export function analyzeFootnotes(doc: TextSource, tree: Tree): FootnoteSemantics {
  const structural = extractStructuralWindow(doc, tree);
  return buildFootnoteSlice(structural);
}

export function numberFootnotes(
  footnotes: FootnoteSemantics,
): ReadonlyMap<string, number> {
  if (isFootnoteSlice(footnotes)) {
    return footnotes.numberById;
  }

  return buildFootnotePlan(footnotes.refs, [...footnotes.defs.values()]).numberById;
}

export function orderedFootnoteEntries(
  footnotes: FootnoteSemantics,
): OrderedFootnoteEntry[] {
  if (isFootnoteSlice(footnotes)) {
    return [...footnotes.orderedEntries];
  }

  return [...buildFootnotePlan(footnotes.refs, [...footnotes.defs.values()]).orderedEntries];
}

export function analyzeFencedDivs(doc: TextSource, tree: Tree): FencedDivSemantics[] {
  return extractStructuralWindow(doc, tree).fencedDivs;
}

export function analyzeEquations(doc: TextSource, tree: Tree): EquationSemantics[] {
  return [...buildEquationSlice(extractStructuralWindow(doc, tree)).equations];
}

export function analyzeMath(doc: TextSource, tree: Tree): MathSemantics[] {
  return [...buildMathSlice(extractStructuralWindow(doc, tree)).mathRegions];
}

export function analyzeReferences(doc: TextSource, tree: Tree): ReferenceSemantics[] {
  return [...buildReferenceSlice(extractStructuralWindow(doc, tree)).references];
}

// ---------------------------------------------------------------------------
// Canonical full-document analysis (single walk + assembly)
// ---------------------------------------------------------------------------

export function analyzeDocumentSemantics(
  doc: TextSource,
  tree: Tree,
): DocumentSemantics {
  return createDocumentAnalysis(doc, tree);
}

export function analyzeDocumentArtifacts(
  doc: TextSource,
  tree: Tree,
): DocumentArtifacts {
  return createDocumentArtifacts(doc, tree);
}
