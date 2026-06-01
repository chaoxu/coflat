import { describe, expect, it } from "vitest";
import { baseThemeStyles } from "./base-theme";
import { blockThemeStyles } from "./block-theme";
import { codeThemeStyles } from "./code-theme";

const LINE_BOX_METRIC_PROPS = [
  "border",
  "borderBottom",
  "borderLeft",
  "borderRight",
  "borderTop",
  "fontFamily",
  "fontSize",
  "lineHeight",
  "margin",
  "marginBottom",
  "marginTop",
  "padding",
  "paddingBottom",
  "paddingTop",
] as const;

function expectMetricNeutral(selector: string, style: Record<string, string> | undefined): void {
  expect(style, `${selector} style`).toBeDefined();
  for (const prop of LINE_BOX_METRIC_PROPS) {
    expect(style, `${selector} must not set ${prop}`).not.toHaveProperty(prop);
  }
}

describe("cursor-stable theme contract", () => {
  it("keeps cursor/active state classes from changing line-box metrics", () => {
    expectMetricNeutral(".cm-activeLine", baseThemeStyles[".cm-activeLine"]);
    expectMetricNeutral(".cf-focus-dimmed", baseThemeStyles[".cf-focus-dimmed"]);
    expectMetricNeutral(".cf-fold-rail-line", baseThemeStyles[".cf-fold-rail-line"]);
    expectMetricNeutral(".cf-table-cell-editing", blockThemeStyles[".cf-table-cell-editing"]);
    expectMetricNeutral(".cf-table-cell-active", blockThemeStyles[".cf-table-cell-active"]);
    expectMetricNeutral(".cf-codeblock-source", codeThemeStyles[".cf-codeblock-source"]);
    expectMetricNeutral(".cf-codeblock-source-open", codeThemeStyles[".cf-codeblock-source-open"]);
    expectMetricNeutral(".cf-codeblock-source-close", codeThemeStyles[".cf-codeblock-source-close"]);
  });
});
