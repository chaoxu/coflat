import { __iconNode as chevronDownIconNode } from "lucide-react/dist/esm/icons/chevron-down.js";
import { __iconNode as chevronRightIconNode } from "lucide-react/dist/esm/icons/chevron-right.js";
import { CSS } from "./constants/css-classes";
import { createLucideIcon } from "./lib/lucide-icon";

export interface DisclosureToggleLabels {
  readonly expanded: string;
  readonly collapsed: string;
}

export interface SyncDisclosureToggleOptions {
  readonly expanded: boolean;
  readonly labels: DisclosureToggleLabels;
  readonly collapsedClassName: string;
}

export const READER_BLOCK_DISCLOSURE_LABELS: DisclosureToggleLabels = {
  expanded: "Collapse block",
  collapsed: "Expand block",
};

export const READER_SECTION_DISCLOSURE_LABELS: DisclosureToggleLabels = {
  expanded: "Collapse section",
  collapsed: "Expand section",
};

export const EDITOR_BLOCK_FOLD_LABELS: DisclosureToggleLabels = {
  expanded: "Fold block",
  collapsed: "Unfold block",
};

export const EDITOR_SECTION_FOLD_LABELS: DisclosureToggleLabels = {
  expanded: "Fold section",
  collapsed: "Unfold section",
};

export function createDisclosureToggleButton(
  ...classNames: Array<string | false | null | undefined>
): HTMLButtonElement {
  const toggle = document.createElement("button");
  toggle.className = [CSS.blockDisclosureToggle, ...classNames]
    .filter((className): className is string => Boolean(className))
    .join(" ");
  toggle.type = "button";
  return toggle;
}

export function syncDisclosureToggle(
  toggle: HTMLElement,
  options: SyncDisclosureToggleOptions,
): void {
  toggle.replaceChildren(
    options.expanded
      ? createLucideIcon(chevronDownIconNode, "chevron-down")
      : createLucideIcon(chevronRightIconNode, "chevron-right"),
  );
  toggle.classList.toggle(options.collapsedClassName, !options.expanded);
  toggle.setAttribute("aria-expanded", options.expanded ? "true" : "false");
  toggle.setAttribute(
    "aria-label",
    options.expanded ? options.labels.expanded : options.labels.collapsed,
  );
}
