/**
 * Editor commands for the command palette.
 *
 * Registers commands for inserting block types, math, navigating
 * to headings, and toggling editor modes.
 */

import type { EditorView } from "@codemirror/view";
import type { PaletteCommand } from "./lib/command-palette";
import {
  commandRegistryExtension,
  type Command,
} from "./command-registry";
import { insertTable } from "./render/table-render";
import { extractHeadings } from "./semantics/heading-ancestry";
import { BLOCK_MANIFEST_ENTRIES } from "../core/constants/block-manifest";

/** Insert a fenced div block at the cursor. */
function insertBlock(view: EditorView, className: string): void {
  const { from, to } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  // Insert on a new line if cursor is not at the start of an empty line
  const prefix = line.text.trim() === "" && from === line.from ? "" : "\n";
  const block = `${prefix}::: {.${className}}\n\n:::\n`;
  view.dispatch({
    changes: { from, to, insert: block },
    // Place cursor inside the block (after the opening fence + newline)
    selection: { anchor: from + prefix.length + `::: {.${className}}\n`.length },
  });
  view.focus();
}

/**
 * Block types available for insertion via the command palette.
 *
 * Derived from BLOCK_MANIFEST — excludes blockquote since it is not a standard
 * insertable block.
 */
const BLOCK_TYPES: readonly string[] = BLOCK_MANIFEST_ENTRIES
  .filter((e) => e.specialBehavior !== "blockquote")
  .map((e) => e.name);

/** Create commands for inserting each block type. */
function createBlockCommands(): Command[] {
  return BLOCK_TYPES.map((type) => ({
    id: `insert-${type}`,
    label: `Insert ${type.charAt(0).toUpperCase() + type.slice(1)}`,
    keywords: [type],
    slash: true,
    run: ({ view }) => {
      insertBlock(view, type);
      return true;
    },
  }));
}

/** Create commands for inserting math. */
function createMathCommands(): Command[] {
  return [
    {
      id: "insert-inline-math",
      label: "Insert Inline Math ($...$)",
      slash: true,
      run: ({ view }) => {
        const { from, to } = view.state.selection.main;
        const selected = view.state.sliceDoc(from, to);
        const text = `$${selected}$`;
        view.dispatch({
          changes: { from, to, insert: text },
          // Place cursor between the dollar signs if no selection
          selection: {
            anchor: selected ? from + text.length : from + 1,
          },
        });
        view.focus();
        return true;
      },
    },
    {
      id: "insert-display-math",
      label: "Insert Display Math ($$...$$)",
      slash: true,
      run: ({ view }) => {
        const { from, to } = view.state.selection.main;
        const line = view.state.doc.lineAt(from);
        const prefix =
          line.text.trim() === "" && from === line.from ? "" : "\n";
        const selected = view.state.sliceDoc(from, to);
        const text = `${prefix}$$\n${selected}\n$$\n`;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: {
            anchor: from + prefix.length + 3 + (selected ? selected.length : 0),
          },
        });
        view.focus();
        return true;
      },
    },
  ];
}

/** Create dynamic heading navigation commands from the current document. */
export function createHeadingCommands(view: EditorView): PaletteCommand[] {
  const headings = extractHeadings(view.state);
  return headings.map((h, i) => ({
    id: `goto-heading-${i}`,
    label: `${"  ".repeat(h.level - 1)}${h.text}`,
    action: (v: EditorView) => {
      v.dispatch({
        selection: { anchor: h.pos },
        scrollIntoView: true,
      });
      v.focus();
    },
  }));
}

/** All static editor commands for host palettes, slash menus, and keymaps. */
export function getEditorCommandRegistry(): Command[] {
  return [
    ...createBlockCommands(),
    ...createMathCommands(),
    {
      id: "insert-table",
      label: "Insert Table",
      slash: true,
      run: ({ view }) => {
        insertTable(view);
        return true;
      },
    },
  ];
}

/** Built-in command registry extension. Host command ids registered later win. */
export const builtinCommandRegistryExtension = commandRegistryExtension(
  getEditorCommandRegistry(),
);

/** Backward-compatible palette command list. */
export function getEditorCommands(): PaletteCommand[] {
  return getEditorCommandRegistry().map((command) => ({
    id: command.id,
    label: command.label,
    shortcut: typeof command.key === "string"
      ? command.key
      : command.key?.[0],
    action: (view: EditorView) => {
      command.run({ view, surface: "palette" });
    },
  }));
}
