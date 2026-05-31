import { describe, expect, it } from "vitest";
import { linkLayoutForHref } from "./link-layout";

describe("linkLayoutForHref", () => {
  it("keeps document links atomic and browser-flow links inline", () => {
    expect(linkLayoutForHref("chapter.md")).toBe("atomic");
    expect(linkLayoutForHref("#local-heading")).toBe("atomic");
    expect(linkLayoutForHref("/docs/chapter.md")).toBe("atomic");
    expect(linkLayoutForHref("https://example.com/long/path")).toBe("flow");
    expect(linkLayoutForHref("HTTP://example.com")).toBe("flow");
    expect(linkLayoutForHref("mailto:hello@example.com")).toBe("flow");
    expect(linkLayoutForHref("tel:+15555555555")).toBe("flow");
  });
});
