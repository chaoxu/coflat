import { describe, expect, it } from "vitest";
import { CSS } from "./constants/css-classes";
import {
  createHoverPreviewBodyElement,
  createHoverPreviewCitationBodyElement,
  createHoverPreviewContentElement,
  createHoverPreviewElementWithBody,
  createHoverPreviewElementWithChild,
  createHoverPreviewHeaderElement,
  createHoverPreviewTextElement,
  createUnresolvedHoverPreviewElement,
} from "./hover-preview-surface";

describe("hover preview surface", () => {
  it("creates the shared preview content, header, and body class contract", () => {
    const content = createHoverPreviewContentElement("extra-preview");
    const header = createHoverPreviewHeaderElement("Theorem 1");
    const body = createHoverPreviewBodyElement();
    content.append(header, body);

    expect(content.className).toBe(`${CSS.previewSurfaceContent} ${CSS.hoverPreview} extra-preview`);
    expect(header.className).toBe(`${CSS.previewSurfaceHeader} ${CSS.hoverPreviewHeader}`);
    expect(header.textContent).toBe("Theorem 1");
    expect(body.className).toBe(`${CSS.previewSurfaceBody} ${CSS.hoverPreviewBody}`);
  });

  it("creates citation and unresolved preview variants", () => {
    expect(createHoverPreviewCitationBodyElement().className)
      .toBe(`${CSS.previewSurfaceBody} ${CSS.hoverPreviewCitation}`);

    const unresolved = createUnresolvedHoverPreviewElement("thm:missing");
    expect(unresolved.classList.contains(CSS.hoverPreview)).toBe(true);
    const header = unresolved.querySelector(`.${CSS.hoverPreviewHeader}`);
    expect(header?.classList.contains(CSS.hoverPreviewUnresolved)).toBe(true);
    expect(header?.textContent).toBe("Unresolved: thm:missing");
  });

  it("wraps common hover preview body variants", () => {
    const textPreview = createHoverPreviewTextElement("Citation text");
    expect(textPreview.classList.contains(CSS.hoverPreview)).toBe(true);
    expect(textPreview.querySelector(`.${CSS.hoverPreviewCitation}`)?.textContent)
      .toBe("Citation text");

    const body = createHoverPreviewBodyElement();
    body.textContent = "Body";
    expect(createHoverPreviewElementWithBody(body).firstElementChild).toBe(body);

    const child = document.createElement("section");
    expect(createHoverPreviewElementWithChild(child).firstElementChild).toBe(child);
  });
});
