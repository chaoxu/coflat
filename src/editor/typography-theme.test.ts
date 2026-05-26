import { describe, expect, it } from "vitest";
import { typographyThemeStyles } from "./typography-theme";

describe("typographyThemeStyles", () => {
  it("keeps inline source reveal typography from contributing line-box height", () => {
    for (const selector of [
      ".cf-source-delimiter",
      ".cf-inline-source",
      ".cf-math-source",
      ".cf-reference-source",
      ".cf-inline-code",
    ] as const) {
      expect(typographyThemeStyles[selector]).toMatchObject({
        fontSize: "0.85em",
        lineHeight: "0",
        verticalAlign: "baseline",
      });
    }
  });

  it("uses reader/editor shared tokens for rendered inline code and links", () => {
    expect(typographyThemeStyles[".cf-inline-code"]).toMatchObject({
      backgroundColor: "var(--cf-color-code-bg, var(--cf-hover))",
      borderRadius: "var(--cf-border-radius)",
      padding: "0.1em 0.25em",
    });

    expect(typographyThemeStyles[".cf-link-rendered"]).toMatchObject({
      color: "var(--cf-color-link, var(--cf-accent))",
      textDecorationThickness: "1px",
      textUnderlineOffset: "2px",
    });
  });
});
