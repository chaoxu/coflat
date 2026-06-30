import type { SyntaxNodeRef } from "@lezer/common";
import {
  fencedDivSyntaxPlan,
  headingSemanticPlan,
} from "../../../core/block-render-plan";
import { displayMathSourcePlan } from "../../../core/math-source";
import {
  extractFootnoteDefinition,
  extractFootnoteReference,
} from "../../../core/semantics/footnote-extraction";
import {
  isDisplayMath,
} from "../../lib/syntax-tree-helpers";
import type {
  EquationSemantics,
  FencedDivSemantics,
  FootnoteDefinition,
  FootnoteReference,
  HeadingSemantics,
  MathSemantics,
  ReferenceSemantics,
  TextSource,
} from "../document-model";
import { matchBracketedReference } from "../reference-parts";

export interface StructuralWindow {
  readonly from: number;
  readonly to: number;
}

export type HeadingStructure = Omit<HeadingSemantics, "number">;
export type EquationStructure = Omit<EquationSemantics, "number">;

export interface ExcludedRange {
  readonly from: number;
  readonly to: number;
}

export interface StructuralWindowExtraction {
  readonly headings: HeadingStructure[];
  readonly footnoteRefs: FootnoteReference[];
  readonly footnoteDefs: FootnoteDefinition[];
  readonly fencedDivs: FencedDivSemantics[];
  readonly equations: EquationStructure[];
  readonly mathRegions: MathSemantics[];
  readonly bracketedRefs: ReferenceSemantics[];
  readonly narrativeRefs: ReferenceSemantics[];
  readonly excludedRanges: ExcludedRange[];
}

export function createStructuralWindowExtraction(): StructuralWindowExtraction {
  return {
    headings: [],
    footnoteRefs: [],
    footnoteDefs: [],
    fencedDivs: [],
    equations: [],
    mathRegions: [],
    bracketedRefs: [],
    narrativeRefs: [],
    excludedRanges: [],
  };
}

export function collectHeading(
  source: string,
  node: SyntaxNodeRef,
  result: StructuralWindowExtraction,
): void {
  result.headings.push(headingSemanticPlan(source, node.node));
}

export function collectFootnoteRef(
  doc: TextSource,
  node: SyntaxNodeRef,
  result: StructuralWindowExtraction,
): void {
  result.footnoteRefs.push(extractFootnoteReference(doc, node));
}

export function collectFootnoteDef(
  source: string,
  node: SyntaxNodeRef,
  result: StructuralWindowExtraction,
): void {
  const footnote = extractFootnoteDefinition(source, node.node);
  if (footnote) result.footnoteDefs.push(footnote);
}

export function collectFencedDiv(
  source: string,
  node: SyntaxNodeRef,
  result: StructuralWindowExtraction,
): void {
  const divNode = node.node;
  const syntax = fencedDivSyntaxPlan(source, divNode);
  const openFenceFrom = syntax.openFenceRange?.from ?? node.from;
  const openFenceTo = syntax.openerRange.to;
  const closeFenceFrom = syntax.closeFenceLineRange?.from ?? -1;
  const closeFenceTo = syntax.closeFenceLineRange?.to ?? -1;
  const attrFrom = syntax.attrRange?.from;
  const attrTo = syntax.attrRange?.to;
  const titleFrom = syntax.titleRange?.from;
  const titleTo = syntax.titleRange?.to;
  const titleSourceFrom = syntax.titleSourceRange?.from;
  const titleSourceTo = syntax.titleSourceRange?.to;

  result.fencedDivs.push({
    from: node.from,
    to: node.to,
    openFenceFrom,
    openFenceTo,
    attrFrom,
    attrTo,
    titleFrom,
    titleTo,
    titleSourceFrom,
    titleSourceTo,
    closeFenceFrom,
    closeFenceTo,
    singleLine: syntax.singleLine,
    isSelfClosing: syntax.isSelfClosing,
    classes: syntax.classes,
    primaryClass: syntax.primaryClassName,
    id: syntax.id,
    title: syntax.title,
    keyValues: syntax.keyValues,
  });
}

export function collectMath(
  doc: TextSource,
  node: SyntaxNodeRef,
  result: StructuralWindowExtraction,
): void {
  const isDisplay = isDisplayMath(node);
  if (isDisplay) {
    const plan = displayMathSourcePlan(doc.slice(0, doc.length), node.node);
    if (!plan) return;

    result.mathRegions.push({
      from: node.from,
      to: node.to,
      isDisplay: true,
      contentFrom: plan.contentRange.from,
      contentTo: plan.contentRange.to,
      labelFrom: plan.labelFrom,
      latex: plan.latex,
    });

    if (plan.labelRange && plan.equationId) {
      result.equations.push({
        id: plan.equationId,
        from: node.from,
        to: node.to,
        labelFrom: plan.labelRange.from,
        labelTo: plan.labelRange.to,
        latex: plan.latex,
      });
    }

    result.excludedRanges.push({ from: node.from, to: node.to });
    return;
  }

  const markName = "InlineMathMark";
  let markCount = 0;
  let firstMarkTo: number | undefined;
  let lastMarkFrom: number | undefined;
  const cursor = node.node.cursor();

  if (cursor.firstChild()) {
    do {
      if (cursor.name === markName) {
        markCount++;
        if (firstMarkTo === undefined) {
          firstMarkTo = cursor.to;
        }
        lastMarkFrom = cursor.from;
      }
    } while (cursor.nextSibling());
  }

  const contentFrom = firstMarkTo ?? node.from;
  const contentTo = markCount >= 2 && lastMarkFrom !== undefined
    ? lastMarkFrom
    : node.to;
  const latex = contentFrom <= contentTo
    ? doc.slice(contentFrom, contentTo)
    : "";

  result.mathRegions.push({
    from: node.from,
    to: node.to,
    isDisplay,
    contentFrom,
    contentTo,
    latex,
  });

  result.excludedRanges.push({ from: node.from, to: node.to });
}

export function collectLink(
  doc: TextSource,
  node: SyntaxNodeRef,
  result: StructuralWindowExtraction,
): void {
  const raw = doc.slice(node.from, node.to);
  const refMatch = matchBracketedReference(raw);
  if (refMatch) {
    result.bracketedRefs.push({
      from: node.from,
      to: node.to,
      bracketed: true,
      ids: [...refMatch.ids],
      locators: [...refMatch.locators],
    });
  }
  result.excludedRanges.push({ from: node.from, to: node.to });
}
