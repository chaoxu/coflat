import { describe, expect, it } from "vitest";
import {
  appendListMarker,
  appendReadOnlyTaskCheckbox,
  createListItemSurfaceElement,
  createListSurfaceElement,
  createReadOnlyTaskCheckboxElement,
  editorListItemLineClassNames,
  listItemSurfaceClassNames,
  listMarkerClassName,
  listMarkerText,
  listSurfaceClassNames,
  renderListItemSurfaceHtml,
  renderListMarkerHtml,
  renderListSurfaceHtml,
  renderReadOnlyTaskCheckboxHtml,
  taskMarkerChecked,
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
    expect(renderListMarkerHtml(true, 3)).toBe(
      '<span class="cf-list-number">3.</span> ',
    );
  });

  it("renders and creates list wrappers from the same surface contract", () => {
    expect(
      renderListSurfaceHtml(
        { ordered: true, task: true, loose: false, start: 3 },
        "<li>item</li>",
        ' data-source-from="1"',
      ),
    ).toBe(
      '<ol class="cf-doc-list cf-doc-list--ordered cf-doc-list--check cf-doc-list--tight" start="3" data-source-from="1"><li>item</li></ol>',
    );

    const list = createListSurfaceElement(document, {
      ordered: false,
      task: false,
      loose: true,
    });
    expect(list.outerHTML).toBe(
      '<ul class="cf-doc-list cf-doc-list--unordered cf-doc-list--loose"></ul>',
    );
  });

  it("renders and creates list item wrappers with shared marker and checked attrs", () => {
    expect(
      renderListItemSurfaceHtml(
        { ordered: false, task: true, checked: false },
        1,
        "<span>task</span>",
        ' data-source-to="9"',
      ),
    ).toBe(
      '<li class="cf-doc-list-item cf-doc-list-item--check" data-checked="false" data-source-to="9"><span class="cf-list-bullet">•</span> <span>task</span></li>',
    );

    const item = createListItemSurfaceElement(document, {
      ordered: true,
      task: true,
      checked: true,
    });
    appendListMarker(item, true, 7);
    expect(item.outerHTML).toBe(
      '<li class="cf-doc-list-item cf-doc-list-item--check" data-checked="true"><span class="cf-list-number">7.</span> </li>',
    );
  });

  it("shares read-only task checkbox rendering", () => {
    expect(taskMarkerChecked("[ ]")).toBe(false);
    expect(taskMarkerChecked("[x]")).toBe(true);
    expect(taskMarkerChecked("[X]")).toBe(true);

    expect(renderReadOnlyTaskCheckboxHtml(false)).toBe(
      '<input type="checkbox" tabindex="-1" aria-disabled="true">',
    );
    expect(renderReadOnlyTaskCheckboxHtml(true)).toBe(
      '<input type="checkbox" tabindex="-1" aria-disabled="true" checked>',
    );

    const input = createReadOnlyTaskCheckboxElement(document, true);
    expect(input.outerHTML).toBe(
      '<input type="checkbox" tabindex="-1" aria-disabled="true">',
    );
    expect(input.checked).toBe(true);

    const host = document.createElement("li");
    appendReadOnlyTaskCheckbox(host, true);
    expect(host.innerHTML).toBe(
      '<input type="checkbox" tabindex="-1" aria-disabled="true"> ',
    );
    expect(host.querySelector("input")?.checked).toBe(true);
  });
});
