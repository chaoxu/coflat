import type { LocalMediaDependencies } from "./media-preview";

export {
  destroyFloatingTooltip,
  destroyHoverPreviewTooltipForTest,
  ensureHoverPreviewTooltipForTest,
  floatingTooltipContains,
  getCachedTooltipContentForTest,
  hideFloatingTooltip,
  isFloatingTooltipVisible,
  showFloatingTooltip,
} from "../../core/hover-tooltip";

export type TooltipPlan = import("../../core/hover-tooltip").TooltipPlan<LocalMediaDependencies>;
