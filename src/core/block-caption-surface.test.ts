import { describe, expect, it } from "vitest";
import {
  appendBlockCaptionLabel,
  appendBlockCaptionText,
  blockCaptionClassName,
  createBlockCaptionElement,
  renderBlockCaptionHtml,
} from "./block-caption-surface";

describe("block caption surface", () => {
  it("renders reader caption HTML with the canonical class contract", () => {
    expect(renderBlockCaptionHtml("Figure 1", "A <em>caption</em>", ' data-source-from="1"')).toBe(
      '<div class="cf-block-caption" data-source-from="1"><span class="cf-block-header-rendered">Figure 1</span><span class="cf-block-caption-text">A <em>caption</em></span></div>',
    );
  });

  it("creates editor caption DOM with matching label/text children", () => {
    const caption = createBlockCaptionElement(document, true);
    appendBlockCaptionLabel(caption, "Table 2");
    appendBlockCaptionText(caption).textContent = "Results";

    expect(caption.className).toBe(blockCaptionClassName(true));
    expect(caption.querySelector(".cf-block-header-rendered")?.textContent).toBe("Table 2");
    expect(caption.querySelector(".cf-block-caption-text")?.textContent).toBe("Results");
  });
});
