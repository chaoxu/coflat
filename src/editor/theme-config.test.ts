import { afterEach, describe, expect, it } from "vitest";
import {
  applyThemePreset,
  clearThemePreset,
  defaultThemePresetKey,
  themePresets,
} from "./theme-config";

afterEach(() => {
  clearThemePreset();
});

describe("theme presets", () => {
  it("exports a default preset key that resolves to an existing preset", () => {
    expect(themePresets[defaultThemePresetKey]).toBe(themePresets.academic);
  });

  it("applyThemePreset sets UI, content, and code font variables", () => {
    applyThemePreset(themePresets.academic);

    expect(document.documentElement.style.getPropertyValue("--cf-ui-font")).toBe(
      themePresets.academic.uiFont,
    );
    expect(document.documentElement.style.getPropertyValue("--cf-content-font")).toBe(
      themePresets.academic.contentFont,
    );
    expect(document.documentElement.style.getPropertyValue("--cf-code-font")).toBe(
      themePresets.academic.codeFont,
    );
  });

  it("clearThemePreset removes theme-owned font variables", () => {
    applyThemePreset(themePresets.modern);
    clearThemePreset();

    expect(document.documentElement.style.getPropertyValue("--cf-ui-font")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--cf-content-font")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--cf-code-font")).toBe("");
  });
});
