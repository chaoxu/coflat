import { EditorSelection } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { createTestView } from "./test-utils";
import { richMouseSelectionStyle } from "./rich-mouse-selection";

describe("rich mouse selection", () => {
  it("does not collapse a non-empty drag selection on the follow-up click", () => {
    const view = createTestView("plain text", {
      extensions: [richMouseSelectionStyle],
    });
    try {
      view.dispatch({
        selection: EditorSelection.range(0, "plain".length),
      });

      const line = view.contentDOM.querySelector<HTMLElement>(".cm-line");
      if (!line) throw new Error("expected rendered line");

      line.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 4,
        clientY: 4,
        detail: 1,
      }));

      expect(view.state.selection.main.from).toBe(0);
      expect(view.state.selection.main.to).toBe("plain".length);
    } finally {
      view.destroy();
    }
  });
});
