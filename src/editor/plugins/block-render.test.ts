import { describe, expect, it } from "vitest";

import { CSS } from "../../core/constants/css-classes";
import { formatBlockHeader, createBlockRender } from "./block-render";

describe("formatBlockHeader", () => {
  it("includes the number when present", () => {
    const result = formatBlockHeader("Theorem", {
      type: "theorem",
      number: 3,
      title: "Main Result",
    });
    expect(result).toBe("Theorem 3");
  });

  it("returns only the display title when number is undefined", () => {
    const result = formatBlockHeader("Proof", { type: "proof" });
    expect(result).toBe("Proof");
  });

  it("does not include the user title in the header", () => {
    const result = formatBlockHeader("Proof", {
      type: "proof",
      title: "of Theorem 1",
    });
    expect(result).toBe("Proof");
  });
});

describe("createBlockRender", () => {
  it("produces the default cf-block className from attrs.type", () => {
    const render = createBlockRender("Definition");
    const spec = render({ type: "definition", number: 2 });
    expect(spec.className).toBe(CSS.block("definition"));
    expect(spec.header).toBe("Definition 2");
  });

  it("uses a custom className when provided", () => {
    const render = createBlockRender("Quote", "cf-custom-quote-block");
    const spec = render({ type: "blockquote" });
    expect(spec.className).toBe("cf-custom-quote-block");
    expect(spec.header).toBe("Quote");
  });
});
