import type { StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { createTestView } from "./test-utils";
import {
  extendTypewriterTransaction,
  isTypewriterModeActive,
  toggleTypewriterMode,
  toggleTypewriterModeEffect,
  typewriterModeExtension,
} from "./typewriter-mode";

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

/** Create a view with the typewriter mode extension and the given document. */
function setup(doc: string, cursorPos = 0): EditorView {
  view = createTestView(doc, {
    cursorPos,
    extensions: typewriterModeExtension,
  });
  return view;
}

/** Identity of CM's internal scrollIntoView effect type. */
const scrollEffectType = (
  EditorView.scrollIntoView(0) as unknown as { type: unknown }
).type;

function isScrollEffect(effect: StateEffect<unknown>): boolean {
  return (effect as unknown as { type: unknown }).type === scrollEffectType;
}

function scrollEffects(effects: readonly StateEffect<unknown>[]): StateEffect<unknown>[] {
  return effects.filter(isScrollEffect);
}

describe("typewriter mode", () => {
  describe("extender inactive", () => {
    it("returns exactly null (not an empty spec) on user typing", () => {
      const v = setup("Hello\nWorld");
      const tr = v.state.update({
        changes: { from: 0, insert: "x" },
        userEvent: "input.type",
      });
      // The Zettlr #6058 gotcha: must be null, never {} / { effects: [] }.
      expect(extendTypewriterTransaction(tr)).toBeNull();
      expect(tr.effects).toHaveLength(0);
    });

    it("appends nothing on selection-only transactions", () => {
      const v = setup("Hello\nWorld");
      const tr = v.state.update({ selection: { anchor: 3 } });
      expect(extendTypewriterTransaction(tr)).toBeNull();
      expect(tr.effects).toHaveLength(0);
    });
  });

  describe("extender active", () => {
    it("appends a center scroll effect on doc-changing user transactions", () => {
      const v = setup("Hello\nWorld", 6);
      toggleTypewriterMode(v);

      const tr = v.state.update({
        changes: { from: 6, insert: "x" },
        userEvent: "input.type",
      });
      const scrolls = scrollEffects(tr.effects);
      expect(scrolls).toHaveLength(1);
      const value = scrolls[0].value as { range: { from: number }; y: string };
      expect(value.y).toBe("center");
      expect(value.range.from).toBe(tr.newSelection.main.from);
    });

    it("does not scroll on programmatic (non-user) doc changes", () => {
      const v = setup("Hello\nWorld");
      toggleTypewriterMode(v);

      const tr = v.state.update({ changes: { from: 0, insert: "x" } });
      expect(extendTypewriterTransaction(tr)).toBeNull();
      expect(scrollEffects(tr.effects)).toHaveLength(0);
    });

    it("does not scroll on selection-only transactions", () => {
      const v = setup("Hello\nWorld");
      toggleTypewriterMode(v);

      const tr = v.state.update({ selection: { anchor: 8 } });
      expect(scrollEffects(tr.effects)).toHaveLength(0);
    });
  });

  describe("toggle transitions", () => {
    it("toggle-on appends the theme reconfigure and a center scroll", () => {
      const v = setup("Hello\nWorld");
      const tr = v.state.update({
        effects: toggleTypewriterModeEffect.of(true),
      });
      // Original toggle effect + compartment reconfigure + center scroll.
      expect(tr.effects).toHaveLength(3);
      expect(tr.effects.some((e) => e.is(toggleTypewriterModeEffect))).toBe(true);
      expect(scrollEffects(tr.effects)).toHaveLength(1);
      expect(isTypewriterModeActive(tr.state)).toBe(true);
    });

    it("toggle-off also reconfigures and recenters", () => {
      const v = setup("Hello\nWorld");
      toggleTypewriterMode(v);

      const tr = v.state.update({
        effects: toggleTypewriterModeEffect.of(false),
      });
      expect(tr.effects).toHaveLength(3);
      expect(scrollEffects(tr.effects)).toHaveLength(1);
      expect(isTypewriterModeActive(tr.state)).toBe(false);
    });

    it("redundant toggle (same value) reconfigures without scrolling", () => {
      const v = setup("Hello\nWorld");
      const tr = v.state.update({
        effects: toggleTypewriterModeEffect.of(false),
      });
      // Mode did not change: reconfigure is appended but no scroll.
      expect(scrollEffects(tr.effects)).toHaveLength(0);
    });
  });

  describe("toggleTypewriterMode command", () => {
    it("starts inactive", () => {
      const v = setup("Hello");
      expect(isTypewriterModeActive(v.state)).toBe(false);
    });

    it("toggles on and off", () => {
      const v = setup("Hello");
      toggleTypewriterMode(v);
      expect(isTypewriterModeActive(v.state)).toBe(true);
      toggleTypewriterMode(v);
      expect(isTypewriterModeActive(v.state)).toBe(false);
    });

    it("returns true (consumed command)", () => {
      const v = setup("Hello");
      expect(toggleTypewriterMode(v)).toBe(true);
    });
  });
});
