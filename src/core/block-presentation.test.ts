import { describe, expect, it } from "vitest";
import {
  blockPresentationPlan,
  fencedDivEmissionPlan,
} from "./block-presentation";

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

describe("fencedDivEmissionPlan", () => {
  it("plans interactive collapsible theorem blocks", () => {
    const presentation = blockPresentationPlan({
      blockType: "theorem",
      displayTitle: "Theorem",
      number: 1,
      title: "Main",
    });

    expect(fencedDivEmissionPlan({
      blockType: "theorem",
      presentation,
      title: "Main",
      isSelfClosing: false,
      semanticBlockDisclosures: "interactive",
    })).toEqual({
      containerLayout: "disclosure",
      collapsibleBlock: true,
      interactiveBlock: true,
      showSelfClosingTitleParagraph: false,
      addQedToLastBodyBlock: false,
      showStandaloneTitle: false,
      showCaptionBelow: false,
    });
  });

  it("plans inline proof headers and qed body decoration", () => {
    const presentation = blockPresentationPlan({
      blockType: "proof",
      displayTitle: "Proof",
      number: undefined,
      title: "Main",
    });

    expect(fencedDivEmissionPlan({
      blockType: "proof",
      presentation,
      title: "Main",
      isSelfClosing: false,
      semanticBlockDisclosures: "static",
    })).toMatchObject({
      containerLayout: "inline-header",
      addQedToLastBodyBlock: true,
      showStandaloneTitle: false,
      showCaptionBelow: false,
    });
  });

  it("keeps custom titled blocks visible without inventing disclosure chrome", () => {
    const presentation = blockPresentationPlan({
      blockType: "custom-note",
      displayTitle: "Custom-note",
      number: undefined,
      title: "Visible title",
    });

    expect(fencedDivEmissionPlan({
      blockType: "custom-note",
      presentation,
      title: "Visible title",
      isSelfClosing: false,
      semanticBlockDisclosures: "static",
    })).toMatchObject({
      containerLayout: "plain",
      collapsibleBlock: false,
      interactiveBlock: false,
      showStandaloneTitle: true,
    });
  });

  it("plans below captions only for non-self-closing captioned blocks", () => {
    const presentation = blockPresentationPlan({
      blockType: "figure",
      displayTitle: "Figure",
      number: 2,
      title: "Diagram",
    });

    expect(fencedDivEmissionPlan({
      blockType: "figure",
      presentation,
      title: "Diagram",
      isSelfClosing: false,
      semanticBlockDisclosures: "static",
    }).showCaptionBelow).toBe(true);
    expect(fencedDivEmissionPlan({
      blockType: "figure",
      presentation,
      title: "Diagram",
      isSelfClosing: true,
      semanticBlockDisclosures: "static",
    }).showCaptionBelow).toBe(false);
  });
});
