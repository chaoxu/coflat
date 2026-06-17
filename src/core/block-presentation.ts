import type { CaptionPosition, HeaderPosition } from "./constants/block-manifest";
import { getBlockManifestEntry } from "./constants/block-manifest";

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
