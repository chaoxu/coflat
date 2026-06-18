import type { SyntaxNode } from "@lezer/common";
import { tableRenderPlan } from "../../core/block-render-plan";
import { createTablePlanElement } from "../../core/table-surface";
import type { PreviewRenderContext } from "./preview-render-context";
import { renderInlineFragmentsToDom } from "./inline-render";

export function renderPreviewTable(
  parent: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  context: PreviewRenderContext,
): void {
  const plan = tableRenderPlan(context.doc, node);
  parent.appendChild(
    createTablePlanElement(document, plan, (cell, cellPlan) => {
      renderInlineFragmentsToDom(
        cell,
        cellPlan.fragments,
        context.macros,
        context.surfacePolicy.bodyInlineSurface,
        {
          ...context.referenceContext,
          imageUrlOverrides: context.imageUrlOverrides,
          footnoteNumbers: context.footnoteNumbers,
        },
      );
    }),
  );
}
