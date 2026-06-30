import { describe, expect, it } from "vitest";
import { getCm6RenderDecorations, withCm6BlockPlugin } from "./cm6-block-plugin";
import { createStandardPlugin } from "./plugin-factory";

describe("CM6 block plugin hooks", () => {
  it("attaches render decoration hooks outside the neutral BlockPlugin type", () => {
    const addBodyDecorations = () => {};
    const plugin = withCm6BlockPlugin(
      createStandardPlugin({
        name: "custom",
        numbered: false,
      }),
      { renderDecorations: { addBodyDecorations } },
    );

    expect(getCm6RenderDecorations(plugin)?.addBodyDecorations).toBe(addBodyDecorations);
  });
});
