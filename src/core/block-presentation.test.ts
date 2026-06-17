import { describe, expect, it } from "vitest";
import { blockPresentationPlan } from "./block-presentation";

describe("block presentation", () => {
  it("builds numbered block labels with title shown in the header", () => {
    expect(blockPresentationPlan({
      blockType: "theorem",
      displayTitle: "Theorem",
      number: 4,
      title: "Main result",
    })).toMatchObject({
      label: "Theorem 4",
      title: "Main result",
      showTitleInHeader: true,
      displayHeader: true,
      hasInlineHeader: false,
      hasCaptionBelow: false,
      isProof: false,
    });
  });

  it("suppresses proof titles while retaining the proof label", () => {
    expect(blockPresentationPlan({
      blockType: "proof",
      displayTitle: "Proof",
      number: undefined,
      title: "Main result",
    })).toMatchObject({
      label: "Proof",
      title: "Main result",
      showTitleInHeader: false,
      displayHeader: true,
      hasInlineHeader: true,
      isProof: true,
    });
  });

  it("marks below-caption blocks", () => {
    expect(blockPresentationPlan({
      blockType: "figure",
      displayTitle: "Figure",
      number: 2,
      title: "Diagram",
    })).toMatchObject({
      label: "Figure 2",
      showTitleInHeader: true,
      hasCaptionBelow: true,
      captionPosition: "below",
    });
  });

  it("marks hidden-header blocks", () => {
    expect(blockPresentationPlan({
      blockType: "blockquote",
      displayTitle: "Blockquote",
      number: undefined,
      title: undefined,
    })).toMatchObject({
      label: "Blockquote",
      showTitleInHeader: false,
      displayHeader: false,
    });
  });
});
