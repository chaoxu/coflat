import { describe, expect, it } from "vitest";
import { monoFont } from "../core/constants/editor-constants";
import { codeThemeStyles } from "./code-theme";

describe("codeThemeStyles", () => {
  it("keeps rendered code block rows on the shared monospace token", () => {
    expect(codeThemeStyles[".cf-codeblock-header"]).toMatchObject({
      fontFamily: monoFont,
      whiteSpace: "pre",
      wordBreak: "normal",
      overflowWrap: "normal",
    });
    expect(codeThemeStyles[".cf-codeblock-body"]).toMatchObject({
      fontFamily: monoFont,
      whiteSpace: "pre",
      wordBreak: "normal",
      overflowWrap: "normal",
    });
    expect(codeThemeStyles[".cf-codeblock-last"]).toMatchObject({
      fontFamily: monoFont,
      whiteSpace: "pre",
      wordBreak: "normal",
      overflowWrap: "normal",
    });
  });
});
