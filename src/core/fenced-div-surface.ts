import type { BlockContainerSurfaceOptions } from "./block-surface";
import { CSS } from "./constants/css-classes";
import type { FencedDivRenderPlan } from "./block-render-plan";

export interface FencedDivSurfaceAssemblyPlan {
  readonly renderSelfClosingTitleParagraph: boolean;
  readonly renderBody: boolean;
  readonly addQedToLastBodyBlock: boolean;
  readonly prependInlineHeading: boolean;
  readonly renderDisclosure: boolean;
  readonly renderStandaloneTitle: boolean;
  readonly renderCaptionBelow: boolean;
  readonly appendPlainBody: boolean;
  readonly setInitialOpenState: boolean;
}

export type FencedDivTitleSlot =
  | "none"
  | "self-closing-paragraph"
  | "standalone-label";

export type FencedDivBodySlot =
  | "none"
  | "plain"
  | "inline-heading"
  | "disclosure";

export type FencedDivCaptionSlot =
  | "none"
  | "below";

export interface FencedDivSurfaceChromePlan {
  readonly titleSlot: FencedDivTitleSlot;
  readonly bodySlot: FencedDivBodySlot;
  readonly captionSlot: FencedDivCaptionSlot;
  readonly decorateLastBodyBlockWithQed: boolean;
  readonly setInitialOpenState: boolean;
}

export function fencedDivContainerOptions(
  plan: FencedDivRenderPlan,
): BlockContainerSurfaceOptions {
  return {
    types: plan.classes,
    id: plan.id,
    dataAttributes: plan.keyValues,
    extraClassNames: plan.emission.interactiveBlock ? [CSS.blockCollapsible] : [],
  };
}

export function fencedDivSurfaceAssemblyPlan(
  plan: FencedDivRenderPlan,
): FencedDivSurfaceAssemblyPlan {
  const hasSummary = plan.presentation !== undefined;
  const renderBody = !plan.isSelfClosing;
  const inlineHeader = plan.emission.containerLayout === "inline-header" && hasSummary;
  const disclosure = plan.emission.containerLayout === "disclosure" && hasSummary;
  return {
    renderSelfClosingTitleParagraph: plan.emission.showSelfClosingTitleParagraph,
    renderBody,
    addQedToLastBodyBlock: renderBody && inlineHeader && plan.emission.addQedToLastBodyBlock,
    prependInlineHeading: renderBody && inlineHeader,
    renderDisclosure: renderBody && disclosure,
    renderStandaloneTitle: renderBody && !disclosure && plan.emission.showStandaloneTitle,
    renderCaptionBelow: plan.emission.showCaptionBelow && !!plan.title && hasSummary,
    appendPlainBody: renderBody && !disclosure,
    setInitialOpenState: renderBody && disclosure && plan.emission.interactiveBlock,
  };
}

export function fencedDivSurfaceChromePlan(
  plan: FencedDivRenderPlan,
): FencedDivSurfaceChromePlan {
  const assembly = fencedDivSurfaceAssemblyPlan(plan);
  let titleSlot: FencedDivTitleSlot = "none";
  if (assembly.renderSelfClosingTitleParagraph) {
    titleSlot = "self-closing-paragraph";
  } else if (assembly.renderStandaloneTitle) {
    titleSlot = "standalone-label";
  }

  let bodySlot: FencedDivBodySlot = "none";
  if (assembly.prependInlineHeading) {
    bodySlot = "inline-heading";
  } else if (assembly.renderDisclosure) {
    bodySlot = "disclosure";
  } else if (assembly.appendPlainBody) {
    bodySlot = "plain";
  }

  return {
    titleSlot,
    bodySlot,
    captionSlot: assembly.renderCaptionBelow ? "below" : "none",
    decorateLastBodyBlockWithQed: assembly.addQedToLastBodyBlock,
    setInitialOpenState: assembly.setInitialOpenState,
  };
}
