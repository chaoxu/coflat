import { describe, expect, it } from "vitest";

import {
  buildHeadingOutlineProjection,
  nextHeadingOutlineProjectionEntry,
} from "./outline-plan";

describe("outline plan", () => {
  it("projects headings into shared outline entries with stable anchor ids", () => {
    const headings = [
      { from: 0, text: "Background", id: undefined, level: 1, number: "1" },
      { from: 20, text: "Setup", id: "background", level: 2, number: "1.1" },
      { from: 40, text: "Background", id: undefined, level: 1, number: "2" },
    ];

    expect(buildHeadingOutlineProjection(headings, {
      markdown: (heading) => `**${heading.text}**`,
      html: (_heading, markdown) => `<strong>${markdown}</strong>`,
    })).toEqual([
      {
        id: "background-2",
        text: "Background",
        html: "<strong>**Background**</strong>",
        level: 1,
        number: "1",
        markdown: "**Background**",
        from: 0,
      },
      {
        id: "background",
        text: "Setup",
        html: "<strong>**Setup**</strong>",
        level: 2,
        number: "1.1",
        markdown: "**Setup**",
        from: 20,
      },
      {
        id: "background-3",
        text: "Background",
        html: "<strong>**Background**</strong>",
        level: 1,
        number: "2",
        markdown: "**Background**",
        from: 40,
      },
    ]);
  });

  it("supports incremental reader projection with caller-owned used ids", () => {
    const used = new Set(["background"]);
    const first = nextHeadingOutlineProjectionEntry(
      { from: 0, text: "Background", level: 1, number: "1" },
      used,
      {
        markdown: (heading) => heading.text,
        html: (_heading, markdown) => markdown,
      },
    );
    const second = nextHeadingOutlineProjectionEntry(
      { from: 20, text: "Background", level: 1, number: "2" },
      used,
      {
        markdown: (heading) => heading.text,
        html: (_heading, markdown) => markdown,
        displayUnnumbered: () => true,
      },
    );

    expect(first).toEqual({
      id: "background-2",
      text: "Background",
      html: "Background",
      level: 1,
      number: "1",
      markdown: "Background",
      from: 0,
    });
    expect(second).toEqual({
      id: "background-3",
      text: "Background",
      html: "Background",
      level: 1,
      markdown: "Background",
      from: 20,
    });
  });
});
