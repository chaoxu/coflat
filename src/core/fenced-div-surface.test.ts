import { describe, expect, it } from "vitest";

import { fencedDivRenderPlan } from "./block-render-plan";
import {
  fencedDivContainerOptions,
  fencedDivSurfaceAssemblyPlan,
  fencedDivSurfaceChromePlan,
} from "./fenced-div-surface";
import { parseMarkdownSource } from "./parser";

function firstFencedDiv(source: string) {
  const node = parseMarkdownSource(source, "html-render").topNode.firstChild;
  if (!node || node.name !== "FencedDiv") throw new Error("expected fenced div");
  return node;
}

describe("fenced div surface assembly", () => {
  it("plans interactive disclosure block assembly", () => {
    const source = '::: {.theorem #thm title="Main"}\nBody\n:::';
    const plan = fencedDivRenderPlan(source, firstFencedDiv(source), {
      displayTitleForBlockType: () => "Theorem",
      numberForBlockType: () => 4,
      semanticBlockDisclosures: "interactive",
    });

    expect(fencedDivContainerOptions(plan)).toEqual({
      types: ["theorem"],
      id: "thm",
      dataAttributes: { title: "Main" },
      extraClassNames: ["cf-doc-block-collapsible"],
    });
    expect(fencedDivSurfaceAssemblyPlan(plan)).toEqual({
      renderSelfClosingTitleParagraph: false,
      renderBody: true,
      addQedToLastBodyBlock: false,
      prependInlineHeading: false,
      renderDisclosure: true,
      renderStandaloneTitle: false,
      renderCaptionBelow: false,
      appendPlainBody: false,
      setInitialOpenState: true,
    });
    expect(fencedDivSurfaceChromePlan(plan)).toEqual({
      titleSlot: "none",
      bodySlot: "disclosure",
      captionSlot: "none",
      decorateLastBodyBlockWithQed: false,
      setInitialOpenState: true,
    });
  });

  it("plans inline proof heading and QED placement", () => {
    const source = "::: {.proof}\nBody\n:::";
    const plan = fencedDivRenderPlan(source, firstFencedDiv(source), {
      displayTitleForBlockType: () => "Proof",
      semanticBlockDisclosures: "static",
    });

    expect(fencedDivSurfaceAssemblyPlan(plan)).toMatchObject({
      addQedToLastBodyBlock: true,
      prependInlineHeading: true,
      renderDisclosure: false,
      appendPlainBody: true,
    });
    expect(fencedDivSurfaceChromePlan(plan)).toMatchObject({
      titleSlot: "none",
      bodySlot: "inline-heading",
      captionSlot: "none",
      decorateLastBodyBlockWithQed: true,
    });
  });

  it("plans below-caption figures", () => {
    const source = '::: {.figure #fig title="Diagram"}\n![x](x.png)\n:::';
    const plan = fencedDivRenderPlan(source, firstFencedDiv(source), {
      displayTitleForBlockType: () => "Figure",
      numberForBlockType: () => 2,
    });

    expect(fencedDivSurfaceAssemblyPlan(plan)).toMatchObject({
      renderCaptionBelow: true,
      appendPlainBody: true,
      renderStandaloneTitle: false,
    });
    expect(fencedDivSurfaceChromePlan(plan)).toMatchObject({
      bodySlot: "plain",
      captionSlot: "below",
    });
  });

  it("keeps self-closing titles as paragraph-only content", () => {
    const source = '::: {.remark title="One line"}\nBody\n:::';
    const plan = fencedDivRenderPlan(source, firstFencedDiv(source), {
      displayTitleForBlockType: () => "Remark",
    });
    const selfClosingPlan = {
      ...plan,
      isSelfClosing: true,
      emission: {
        ...plan.emission,
        showSelfClosingTitleParagraph: true,
        showStandaloneTitle: false,
        showCaptionBelow: false,
      },
    };

    expect(fencedDivSurfaceAssemblyPlan(selfClosingPlan)).toMatchObject({
      renderSelfClosingTitleParagraph: true,
      renderBody: false,
      renderCaptionBelow: false,
      appendPlainBody: false,
    });
    expect(fencedDivSurfaceChromePlan(selfClosingPlan)).toMatchObject({
      titleSlot: "self-closing-paragraph",
      bodySlot: "none",
      captionSlot: "none",
    });
  });
});
