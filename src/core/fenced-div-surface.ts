import type { FencedDivRenderPlan } from "./block-render-plan";
import type { BlockContainerSurfaceOptions } from "./block-surface";
import { CSS } from "./constants/css-classes";

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

export type FencedDivLiveEditorTitleSlot =
  | "none"
  | "parenthesized-inline"
  | "hidden-inline"
  | "attribute-title";

export type FencedDivLiveEditorOpenerSlot =
  | "visible"
  | "collapsed";

export type FencedDivLiveEditorOpenerLabelSlot =
  | "none"
  | "empty"
  | "label";

export interface FencedDivLiveEditorChromeOptions {
  readonly captionBelow: boolean;
  readonly inlineHeader: boolean;
  readonly displayHeader: boolean;
  readonly structureEditActive: boolean;
  readonly activeShell: boolean;
  readonly hasVisibleBody: boolean;
  readonly hasEditableInlineTitle: boolean;
  readonly hasAttributeTitle: boolean;
}

export interface FencedDivLiveEditorChromePlan {
  readonly openerSourceActive: boolean;
  readonly openerSlot: FencedDivLiveEditorOpenerSlot;
  readonly openerLabelSlot: FencedDivLiveEditorOpenerLabelSlot;
  readonly openerIsBottom: boolean;
  readonly bodyShellStartsOnFirstBodyLine: boolean;
  readonly bodyShellEndsOnLastBodyLine: boolean;
  readonly titleSlot: FencedDivLiveEditorTitleSlot;
  readonly bodySlot: FencedDivBodySlot;
  readonly captionSlot: FencedDivCaptionSlot;
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

export function fencedDivLiveEditorChromePlan(
  options: FencedDivLiveEditorChromeOptions,
): FencedDivLiveEditorChromePlan {
  const openerSourceActive = options.structureEditActive && (
    options.captionBelow
    || options.inlineHeader
    || !options.hasEditableInlineTitle
  );
  const openerLineVisible = openerSourceActive || (
    !options.captionBelow
    && !options.inlineHeader
    && options.displayHeader
  );
  const captionVisible = options.captionBelow
    && !openerSourceActive
    && options.hasVisibleBody;
  const inlineHeaderVisible = options.inlineHeader
    && !openerSourceActive
    && options.hasVisibleBody;
  const bottomOnCaption = options.activeShell && captionVisible;
  const openerIsBottom = options.activeShell
    && !options.hasVisibleBody
    && !bottomOnCaption;

  let openerLabelSlot: FencedDivLiveEditorOpenerLabelSlot = "none";
  if (openerLineVisible) {
    openerLabelSlot = options.captionBelow || options.inlineHeader || !options.displayHeader
      ? "empty"
      : "label";
  }

  let titleSlot: FencedDivLiveEditorTitleSlot = "none";
  if (
    openerLineVisible
    && !openerSourceActive
    && !options.captionBelow
    && !options.inlineHeader
    && options.hasEditableInlineTitle
  ) {
    titleSlot = "parenthesized-inline";
  } else if (
    openerLineVisible
    && !openerSourceActive
    && (options.captionBelow || options.inlineHeader)
    && options.hasEditableInlineTitle
  ) {
    titleSlot = "hidden-inline";
  } else if (
    openerLineVisible
    && !openerSourceActive
    && !options.captionBelow
    && !options.hasEditableInlineTitle
    && options.hasAttributeTitle
  ) {
    titleSlot = "attribute-title";
  }

  return {
    openerSourceActive,
    openerSlot: openerLineVisible ? "visible" : "collapsed",
    openerLabelSlot,
    openerIsBottom,
    bodyShellStartsOnFirstBodyLine: options.activeShell && !openerLineVisible,
    bodyShellEndsOnLastBodyLine: options.activeShell && !bottomOnCaption,
    titleSlot,
    bodySlot: inlineHeaderVisible ? "inline-heading" : options.hasVisibleBody ? "plain" : "none",
    captionSlot: captionVisible ? "below" : "none",
  };
}
