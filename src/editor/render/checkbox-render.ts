/**
 * Checkbox rendering for GFM task lists.
 *
 * Replaces TaskMarker nodes ([ ] or [x]) with interactive checkbox
 * widgets. Task markers stay rendered as widgets during ordinary
 * navigation; clicking the checkbox toggles the document content
 * between [ ] and [x].
 */

import { syntaxTree } from "@codemirror/language";
import {
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  type Decoration,
  type EditorView,
} from "@codemirror/view";
import { pushWidgetDecoration } from "./decoration-core";
import { RenderWidget } from "./source-widget";
import { createCursorSensitiveViewPlugin } from "./view-plugin-factories";
import { type VisibleRange } from "./viewport-diff";

/** Checkbox widget that toggles task marker content on click. */
export class CheckboxWidget extends RenderWidget {
  constructor(
    private readonly checked: boolean,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.setAttribute("aria-label", this.checked ? "Completed task" : "Incomplete task");
    input.style.cursor = "pointer";
    input.style.verticalAlign = "middle";
    input.style.marginRight = "4px";

    const from = this.from;
    const to = this.to;
    const checked = this.checked;

    input.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const replacement = checked ? "[ ]" : "[x]";
      view.dispatch({
        changes: { from, to, insert: replacement },
      });
    });

    return input;
  }

  eq(other: CheckboxWidget): boolean {
    return this.checked === other.checked && this.from === other.from && this.to === other.to;
  }
}

function collectCheckboxItems(
  view: EditorView,
  ranges: readonly VisibleRange[],
  skip: (nodeFrom: number) => boolean,
): Range<Decoration>[] {
  const state = view.state;
  const items: Range<Decoration>[] = [];
  const seen = new Set<number>();
  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "TaskMarker" || seen.has(node.from)) return;
        seen.add(node.from);
        if (skip(node.from)) return;
        const text = state.sliceDoc(node.from, node.to);
        const checked = text.includes("x") || text.includes("X");
        pushWidgetDecoration(
          items,
          new CheckboxWidget(checked, node.from, node.to),
          node.from,
          node.to,
        );
      },
    });
  }
  return items;
}

/** CM6 extension that renders task list checkboxes with toggle support. */
export const checkboxRenderPlugin: Extension = createCursorSensitiveViewPlugin(
  collectCheckboxItems,
  {
    // CheckboxWidget captures its marker offsets for the click handler, so
    // decorations must never be position-mapped through doc changes with the
    // old widget instances (stale toggle ranges, see #346). Returning null
    // forces a rebuild, now scoped to the visible ranges instead of the
    // whole document.
    docChangeRanges: () => null,
    // Zero cursor sensitivity: selection/focus changes never affect output.
    contextChangeRanges: () => [],
    spanName: "cm6.checkboxRender",
  },
);
