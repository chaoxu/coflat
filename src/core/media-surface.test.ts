import { describe, expect, it } from "vitest";
import { CSS } from "./constants/css-classes";
import {
  createImageElement,
  createImageSurfaceElement,
  createMediaWrapperElement,
  imageUnavailableLabel,
  isUnresolvedLocalMediaUrl,
  mediaKindForSrc,
  mediaLoadingLabel,
  renderImagePlaceholderInto,
  renderImageSurfaceHtml,
  renderMediaLoadingHtml,
  renderMediaLoadingInto,
} from "./media-surface";

describe("media surface", () => {
  it("shares image wrapper and image DOM classes", () => {
    const wrapper = createMediaWrapperElement(document, "span");
    const img = createImageElement(document, "figure.png", "Figure");
    wrapper.appendChild(img);

    expect(wrapper.outerHTML).toBe(
      '<span class="cf-image-wrapper"><img class="cf-image" src="figure.png" alt="Figure"></span>',
    );

    expect(createImageSurfaceElement(document, "span", "figure.png", "Figure").outerHTML).toBe(
      '<span class="cf-image-wrapper"><img class="cf-image" src="figure.png" alt="Figure"></span>',
    );
  });

  it("renders reader image and loading HTML with the same class contract", () => {
    expect(renderImageSurfaceHtml("figure.png", "Figure")).toBe(
      '<span class="cf-image-wrapper"><img class="cf-image" src="figure.png" alt="Figure"></span>',
    );
    expect(renderMediaLoadingHtml("figure.pdf", "")).toBe(
      '<span class="cf-image-wrapper cf-image-loading">[Loading PDF: preview]</span>',
    );
  });

  it("shares labels and placeholder states", () => {
    expect(mediaKindForSrc("plot.pdf#page=2")).toBe("pdf");
    expect(mediaKindForSrc("plot.svg")).toBe("image");
    expect(mediaLoadingLabel("image", "Plot")).toBe("[Loading image: Plot]");
    expect(imageUnavailableLabel("")).toBe("[Image: preview]");

    const loading = createMediaWrapperElement(document, "span");
    renderMediaLoadingInto(loading, "pdf", "Paper");
    expect(loading.className).toBe(`${CSS.imageWrapper} ${CSS.imageLoading}`);
    expect(loading.textContent).toBe("[Loading PDF: Paper]");

    renderImagePlaceholderInto(loading, "Broken", { block: true });
    expect(loading.className).toBe(`${CSS.imageWrapper} ${CSS.imagePlaceholder}`);
    expect(loading.textContent).toBe("[Image: Broken]");
  });

  it("identifies local media that needs host resolution", () => {
    expect(isUnresolvedLocalMediaUrl("images/plot.png")).toBe(true);
    expect(isUnresolvedLocalMediaUrl("./plot.png")).toBe(true);
    expect(isUnresolvedLocalMediaUrl("../plot.pdf")).toBe(true);
    expect(isUnresolvedLocalMediaUrl("/assets/plot.png")).toBe(false);
    expect(isUnresolvedLocalMediaUrl("https://example.com/plot.png")).toBe(false);
    expect(isUnresolvedLocalMediaUrl("data:image/png;base64,abc")).toBe(false);
  });
});
