import type { CaptionPosition, HeaderPosition } from "./constants/block-manifest";
import {
  getBlockManifestEntry,
  isCollapsibleBlockType,
} from "./constants/block-manifest";

export interface BlockPresentationOptions {
  readonly blockType: string;
  readonly displayTitle: string;
  readonly number: number | undefined;
  readonly title: string | undefined;
}

export interface BlockPresentationPlan {
  readonly label: string;
  readonly title: string | undefined;
  readonly showTitleInHeader: boolean;
  readonly captionPosition: CaptionPosition | undefined;
  readonly headerPosition: HeaderPosition | undefined;
  readonly displayHeader: boolean;
  readonly hasInlineHeader: boolean;
  readonly hasCaptionBelow: boolean;
  readonly isProof: boolean;
}

export type SemanticBlockDisclosureMode = "interactive" | "static";

export interface FencedDivEmissionPlanOptions {
  readonly blockType: string | undefined;
  readonly presentation: BlockPresentationPlan | undefined;
  readonly title: string | undefined;
  readonly isSelfClosing: boolean;
  readonly semanticBlockDisclosures: SemanticBlockDisclosureMode;
}

export interface FencedDivEmissionPlan {
  readonly containerLayout: "inline-header" | "disclosure" | "plain";
  readonly collapsibleBlock: boolean;
  readonly interactiveBlock: boolean;
  readonly showSelfClosingTitleParagraph: boolean;
  readonly addQedToLastBodyBlock: boolean;
  readonly showStandaloneTitle: boolean;
  readonly showCaptionBelow: boolean;
}

export function blockPresentationPlan(
  options: BlockPresentationOptions,
): BlockPresentationPlan {
  const manifest = getBlockManifestEntry(options.blockType);
  const label = options.blockType === "proof"
    ? "Proof"
    : options.number === undefined
      ? options.displayTitle
      : `${options.displayTitle} ${options.number}`;
  const captionPosition = manifest?.captionPosition;
  const headerPosition = manifest?.headerPosition;
  const displayHeader = manifest?.displayHeader !== false;
  const isProof = options.blockType === "proof";

  return {
    label,
    title: options.title,
    showTitleInHeader: Boolean(options.title) && !isProof,
    captionPosition,
    headerPosition,
    displayHeader,
    hasInlineHeader: headerPosition === "inline",
    hasCaptionBelow: captionPosition === "below",
    isProof,
  };
}

export function fencedDivEmissionPlan(
  options: FencedDivEmissionPlanOptions,
): FencedDivEmissionPlan {
  const hasTitle = Boolean(options.title);
  const collapsibleBlock = Boolean(
    options.blockType && isCollapsibleBlockType(options.blockType),
  );
  const interactiveBlock = collapsibleBlock
    && options.semanticBlockDisclosures === "interactive";
  const containerLayout = options.presentation?.hasInlineHeader
    ? "inline-header"
    : collapsibleBlock
      ? "disclosure"
      : "plain";

  return {
    containerLayout,
    collapsibleBlock,
    interactiveBlock,
    showSelfClosingTitleParagraph: hasTitle && options.isSelfClosing,
    addQedToLastBodyBlock: Boolean(options.presentation?.isProof),
    showStandaloneTitle: hasTitle
      && !options.presentation?.hasCaptionBelow
      && !options.presentation?.hasInlineHeader
      && !collapsibleBlock,
    showCaptionBelow: hasTitle
      && !options.isSelfClosing
      && Boolean(options.presentation?.hasCaptionBelow),
  };
}
