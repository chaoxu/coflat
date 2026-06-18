import { describe, expect, it } from "vitest";

import { listRenderPlan } from "./block-render-plan";
import {
  listItemSurfaceEmissionPlan,
  listSurfaceEmissionPlan,
} from "./list-emission-plan";
import { parseMarkdownSource } from "./parser";

function firstBlock(source: string, name: string) {
  const node = parseMarkdownSource(source, "html-render").topNode.firstChild;
  if (!node || node.name !== name) throw new Error(`expected ${name}`);
  return node;
}

describe("list emission plan", () => {
  it("projects list render plans into shared surface options and item actions", () => {
    const source = "3. [x] done\n\n4. next";
    const renderPlan = listRenderPlan(source, firstBlock(source, "OrderedList"));
    const plan = listSurfaceEmissionPlan(renderPlan);

    expect(plan.options).toEqual({
      ordered: true,
      task: true,
      loose: true,
      start: 3,
    });
    expect(plan.items.map((item) => ({
      markerNumber: item.markerNumber,
      options: item.options,
      children: item.childPlans.map((child) => ({
        kind: child.kind,
        node: child.node.name,
        wrapTaskContent: child.wrapTaskContent,
      })),
    }))).toEqual([
      {
        markerNumber: 3,
        options: { ordered: true, task: true, checked: true },
        children: [{ kind: "task", node: "Task", wrapTaskContent: false }],
      },
      {
        markerNumber: 4,
        options: { ordered: true, task: false, checked: undefined },
        children: [{ kind: "inline-paragraph", node: "Paragraph", wrapTaskContent: false }],
      },
    ]);
  });

  it("projects one list item with the same task wrapping policy used by emitters", () => {
    const source = "- [ ] task\n\n  continuation";
    const renderPlan = listRenderPlan(source, firstBlock(source, "BulletList"));
    const itemPlan = listItemSurfaceEmissionPlan(false, renderPlan.items[0]);

    expect(itemPlan.options).toEqual({
      ordered: false,
      task: true,
      checked: false,
    });
    expect(itemPlan.childPlans[0]).toMatchObject({
      kind: "task",
      node: { name: "Task" },
      wrapTaskContent: true,
    });
  });
});
