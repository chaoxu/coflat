import { describe, expect, it } from "vitest";
import { CSS } from "./constants/css-classes";
import {
  createDisclosureToggleButton,
  EDITOR_BLOCK_FOLD_LABELS,
  READER_SECTION_DISCLOSURE_LABELS,
  syncDisclosureToggle,
} from "./disclosure-toggle";

describe("disclosure toggle surface", () => {
  it("creates reader disclosure buttons with the shared base class", () => {
    const toggle = createDisclosureToggleButton(CSS.sectionDisclosureToggle);

    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.type).toBe("button");
    expect(toggle.className).toBe(`${CSS.blockDisclosureToggle} ${CSS.sectionDisclosureToggle}`);
  });

  it("syncs the expanded icon, class, and accessibility state", () => {
    const toggle = document.createElement("span");

    syncDisclosureToggle(toggle, {
      expanded: true,
      labels: READER_SECTION_DISCLOSURE_LABELS,
      collapsedClassName: CSS.blockDisclosureToggleCollapsed,
    });

    expect(toggle.querySelector(".lucide-chevron-down")).not.toBeNull();
    expect(toggle.classList.contains(CSS.blockDisclosureToggleCollapsed)).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Collapse section");
  });

  it("syncs the collapsed icon, class, and accessibility state", () => {
    const toggle = document.createElement("span");

    syncDisclosureToggle(toggle, {
      expanded: false,
      labels: EDITOR_BLOCK_FOLD_LABELS,
      collapsedClassName: CSS.foldToggleFolded,
    });

    expect(toggle.querySelector(".lucide-chevron-right")).not.toBeNull();
    expect(toggle.classList.contains(CSS.foldToggleFolded)).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Unfold block");
  });
});
