import { describe, expect, it } from "vitest";
import {
  editorListItemLineClassNames,
  listItemSurfaceClassNames,
  listMarkerClassName,
  listMarkerText,
  listSurfaceClassNames,
} from "./list-surface";

describe("list surface", () => {
  it("builds shared list classes", () => {
    expect(listSurfaceClassNames({ ordered: false, task: false, loose: false })).toBe(
      "cf-doc-list cf-doc-list--unordered cf-doc-list--tight",
    );
    expect(listSurfaceClassNames({ ordered: true, task: true, loose: true })).toBe(
      "cf-doc-list cf-doc-list--ordered cf-doc-list--check cf-doc-list--loose",
    );
  });

  it("builds shared list item classes", () => {
    expect(listItemSurfaceClassNames({ ordered: false, task: false })).toBe(
      "cf-doc-list-item",
    );
    expect(listItemSurfaceClassNames({ ordered: true, task: true })).toBe(
      "cf-doc-list-item cf-doc-list-item--check",
    );
  });

  it("builds editor list line classes from the same contract", () => {
    expect(editorListItemLineClassNames({ ordered: false, task: false })).toBe(
      "cf-doc-list cf-doc-list--unordered cf-doc-list--tight cf-doc-list-item",
    );
    expect(editorListItemLineClassNames({ ordered: true, task: true })).toBe(
      "cf-doc-list cf-doc-list--ordered cf-doc-list--check cf-doc-list--tight cf-doc-list-item cf-doc-list-item--check",
    );
  });

  it("builds marker classes and text", () => {
    expect(listMarkerClassName(false)).toBe("cf-list-bullet");
    expect(listMarkerText(false, 3)).toBe("•");
    expect(listMarkerClassName(true)).toBe("cf-list-number");
    expect(listMarkerText(true, 3)).toBe("3.");
  });
});
