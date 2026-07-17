/**
 * Selection formatting toolbar.
 *
 * Shows a small floating toolbar of inline-formatting buttons (bold, italic,
 * inline code, strikethrough, highlight, link) next to a non-empty selection,
 * following Zettlr's tooltip design: a `StateField<readonly Tooltip[]>`
 * provided via `showTooltip.computeN`. The tooltip anchors at the selection
 * head and flips above the selection when the user selects upward
 * (head < anchor). It hides for empty selections and read-only editors, and
 * dismissal is implicit via the per-transaction recompute.
 *
 * Buttons reuse the existing formatting commands (`toggleInlineMarker`,
 * `toggleLink` from `keybindings.ts`) — the toolbar adds no new formatting
 * logic. Handlers fire on `mousedown` with `preventDefault()`, NOT `click`:
 * the resulting transaction recomputes the tooltip and re-creates its DOM
 * before `mouseup`, so a click handler would never fire (and the default
 * mousedown would collapse the selection).
 *
 * Wiring (integrator):
 * - Append `formattingToolbarExtension` to the editor extension list in
 *   `base-editor-extensions.ts`. No keymap is needed — the underlying
 *   commands already have shortcuts in `keybindings.ts`.
 * - Optionally register `formattingToolbarCommands` through
 *   `commandRegistryExtension` (`commands.ts`) to expose the same actions in
 *   the palette. The command objects deliberately carry no `key` so they do
 *   not double-bind the shortcuts in `keybindings.ts`.
 *
 * Styles live in `editor-theme.css` under the "Formatting toolbar" block
 * (`.cf-formatting-toolbar`, `.cf-formatting-toolbar-button`).
 */

import { type EditorState, type Extension, StateField } from "@codemirror/state";
import { type EditorView, showTooltip, type Tooltip } from "@codemirror/view";
import type { Command } from "./command-registry";
import { toggleInlineMarker, toggleLink } from "./keybindings";

// ---------------------------------------------------------------------------
// Button specs
// ---------------------------------------------------------------------------

/** One toolbar button: identity, accessible label, glyph, and action. */
interface ToolbarButtonSpec {
  /** Stable command name, used as `data-command` and in registry ids. */
  readonly command: string;
  /** Accessible label (aria-label + title) and palette label. */
  readonly label: string;
  /** Visible glyph; per-command CSS previews the formatting. */
  readonly glyph: string;
  readonly run: (view: EditorView) => boolean;
}

const TOOLBAR_BUTTONS: readonly ToolbarButtonSpec[] = [
  {
    command: "bold",
    label: "Bold",
    glyph: "B",
    run: (view) => toggleInlineMarker(view, "**"),
  },
  {
    command: "italic",
    label: "Italic",
    glyph: "I",
    run: (view) => toggleInlineMarker(view, "*"),
  },
  {
    command: "code",
    label: "Inline code",
    glyph: "<>",
    run: (view) => toggleInlineMarker(view, "`"),
  },
  {
    command: "strikethrough",
    label: "Strikethrough",
    glyph: "S",
    run: (view) => toggleInlineMarker(view, "~~"),
  },
  {
    command: "highlight",
    label: "Highlight",
    glyph: "H",
    run: (view) => toggleInlineMarker(view, "=="),
  },
  {
    command: "link",
    label: "Link",
    glyph: "L",
    run: (view) => toggleLink(view),
  },
];

// ---------------------------------------------------------------------------
// Tooltip DOM
// ---------------------------------------------------------------------------

function createToolbarButton(
  view: EditorView,
  spec: ToolbarButtonSpec,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cf-formatting-toolbar-button";
  btn.dataset.command = spec.command;
  btn.textContent = spec.glyph;
  btn.setAttribute("aria-label", spec.label);
  btn.title = spec.label;
  // NOTE: mousedown + preventDefault, not click — the formatting transaction
  // re-creates this tooltip's DOM before mouseup, so click never fires, and
  // preventDefault keeps the mousedown from collapsing the selection.
  btn.addEventListener("mousedown", (event) => {
    event.preventDefault();
    spec.run(view);
  });
  return btn;
}

/**
 * Compute the toolbar tooltip list for a state.
 *
 * Empty when the main selection is empty or the editor is read-only
 * (`EditorState.readOnly`, which `rich-readonly` mode also sets).
 */
function getFormattingTooltips(state: EditorState): readonly Tooltip[] {
  const mainSel = state.selection.main;
  if (mainSel.empty || state.readOnly) return [];

  return [{
    pos: mainSel.head,
    above: mainSel.head < mainSel.anchor,
    strictSide: false,
    create: (view) => {
      const dom = document.createElement("div");
      dom.className = "cf-formatting-toolbar";
      dom.setAttribute("role", "toolbar");
      dom.setAttribute("aria-label", "Text formatting");
      for (const spec of TOOLBAR_BUTTONS) {
        dom.appendChild(createToolbarButton(view, spec));
      }
      return { dom };
    },
  }];
}

// ---------------------------------------------------------------------------
// State field + extension
// ---------------------------------------------------------------------------

const formattingToolbarField = StateField.define<readonly Tooltip[]>({
  create(state) {
    return getFormattingTooltips(state);
  },

  update(tooltips, tr) {
    // Only doc/selection/readonly changes can alter the tooltip. Keeping the
    // array identity otherwise lets CM6 keep the existing tooltip DOM.
    if (
      !tr.docChanged &&
      !tr.selection &&
      tr.state.readOnly === tr.startState.readOnly
    ) {
      return tooltips;
    }
    return getFormattingTooltips(tr.state);
  },

  provide: (field) => showTooltip.computeN([field], (state) => state.field(field)),
});

/**
 * Selection formatting toolbar extension. Self-contained: append to the
 * editor extension list.
 */
export const formattingToolbarExtension: Extension = formattingToolbarField;

// ---------------------------------------------------------------------------
// Registry commands
// ---------------------------------------------------------------------------

/**
 * The toolbar actions as command-registry entries (ids `format-bold`,
 * `format-italic`, `format-inline-code`, `format-strikethrough`,
 * `format-highlight`, `format-link`) for hosts that want them in the palette.
 */
export const formattingToolbarCommands: readonly Command[] = TOOLBAR_BUTTONS.map(
  (spec) => ({
    id: spec.command === "code" ? "format-inline-code" : `format-${spec.command}`,
    label: spec.label,
    keywords: ["format", spec.command],
    run: ({ view }) => spec.run(view),
  }),
);

// ---------------------------------------------------------------------------
// Test-only exports
// ---------------------------------------------------------------------------

/** Exported for unit testing without a browser. */
export { getFormattingTooltips as _getFormattingTooltipsForTest };
