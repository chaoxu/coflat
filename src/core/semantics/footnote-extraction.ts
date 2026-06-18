import type { SyntaxNode } from "@lezer/common";
import { footnoteDefinitionSemanticPlan } from "../block-render-plan";

export interface FootnoteTextSource {
  slice(from: number, to: number): string;
}

export interface ExtractedFootnoteReference {
  readonly id: string;
  readonly from: number;
  readonly to: number;
}

export interface ExtractedFootnoteDefinition {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly content: string;
  readonly bodyFrom: number;
  readonly bodyTo: number;
  readonly labelFrom: number;
  readonly labelTo: number;
}

export interface FootnoteNodeSpan {
  readonly from: number;
  readonly to: number;
}

export function extractFootnoteReference(
  doc: FootnoteTextSource,
  node: FootnoteNodeSpan,
): ExtractedFootnoteReference {
  return {
    id: doc.slice(node.from + 2, node.to - 1),
    from: node.from,
    to: node.to,
  };
}

export function extractFootnoteDefinition(
  source: string,
  node: SyntaxNode,
): ExtractedFootnoteDefinition | null {
  const plan = footnoteDefinitionSemanticPlan(source, node);
  if (!plan) return null;

  return {
    id: plan.id,
    from: plan.sourceRange.from,
    to: plan.sourceRange.to,
    content: source.slice(plan.bodyRange.from, plan.bodyRange.to),
    bodyFrom: plan.bodyRange.from,
    bodyTo: plan.bodyRange.to,
    labelFrom: plan.labelRange.from,
    labelTo: plan.labelRange.to,
  };
}
