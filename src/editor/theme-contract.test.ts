import { describe, expect, it } from "vitest";
import {
  COFLAT_READER_CLASS,
  COFLAT_READER_DOCUMENT_CLASS,
  COFLAT_READER_SHELL_CLASS,
  COFLAT_READER_TOC_CLASS,
  COFLAT_THEME_SCOPE_CLASS,
  blueprintBookThemeManifest,
  themeLayerTokenDefaults,
  themeLayerTokens,
  themeSurfaceTokenMap,
  themeTokenNames,
} from "./theme-contract";
import type { CoflatThemeManifest } from "../core/theme-manifest";

describe("theme contract", () => {
  it("keeps shared layer tokens explicit and defaulted", () => {
    expect(themeLayerTokens).toEqual([
      "--cf-layer-inline-chrome",
      "--cf-layer-preview-surface",
      "--cf-layer-block-picker",
    ]);
    expect(themeLayerTokenDefaults).toEqual({
      "--cf-layer-inline-chrome": "1",
      "--cf-layer-preview-surface": "1000",
      "--cf-layer-block-picker": "1010",
    });
  });

  it("maps every surface token to a canonical token name", () => {
    const allTokens = new Set(themeTokenNames);

    for (const [surface, tokens] of Object.entries(themeSurfaceTokenMap)) {
      expect(tokens.length, `${surface} should expose tokens`).toBeGreaterThan(0);
      for (const token of tokens) {
        expect(allTokens.has(token), `${surface} uses ${token}`).toBe(true);
      }
    }
  });

  it("keeps tooltip and block surfaces on the shared foreground and layer contracts", () => {
    expect(themeSurfaceTokenMap.tooltipAndHover).toEqual(expect.arrayContaining([
      "--cf-fg",
      "--cf-muted",
      "--cf-layer-preview-surface",
    ]));
    expect(themeSurfaceTokenMap.blockSurfaces).toEqual(expect.arrayContaining([
      "--cf-block-header-accent",
      "--cf-proof-marker",
      "--cf-layer-inline-chrome",
    ]));
  });

  it("exports a host-managed theme manifest contract", () => {
    const externalTheme: CoflatThemeManifest = {
      id: "external",
      name: "External",
      targets: ["reader", "editor"],
      css: ["/themes/external.css"],
      rootClass: "external-theme",
      variables: {
        "--cf-content-max-width": "72ch",
        "--external-private-token": "1",
      },
    };

    expect(externalTheme.targets).toEqual(["reader", "editor"]);
    expect(blueprintBookThemeManifest).toMatchObject({
      id: "blueprint-book",
      rootClass: "cf-theme-blueprint-book",
      dataTheme: "blueprint-book",
    });
    expect(blueprintBookThemeManifest.css).toEqual([
      "@chaoxu/coflat/themes/blueprint-book.css",
    ]);
  });

  it("keeps scoped reader theme class names stable", () => {
    expect(COFLAT_THEME_SCOPE_CLASS).toBe("cf-theme-scope");
    expect(COFLAT_READER_CLASS).toBe("cf-reader");
    expect(COFLAT_READER_SHELL_CLASS).toBe("cf-reader-shell");
    expect(COFLAT_READER_TOC_CLASS).toBe("cf-reader-toc");
    expect(COFLAT_READER_DOCUMENT_CLASS).toBe("cf-reader-document");
  });
});
