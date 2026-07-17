/**
 * Footnote authoring commands (C5): insert-with-renumber, a Backspace
 * delete guard, and definition→reference jump-back.
 *
 * Ported from Zettlr's `commands/footnotes.ts`, adapted to read coflat's
 * shared document analysis (`documentAnalysisField.footnotes`) instead of
 * re-scanning the syntax tree.
 *
 * Wiring (integrator):
 * - Append `footnoteCommandsExtension` to the editor extensions. It is
 *   self-contained: it provides `documentAnalysisField` plus a `Prec.high`
 *   keymap (Mod-Alt-f → insertFootnote, Backspace →
 *   selectFootnoteBeforeDelete).
 * - Optionally register `footnotePaletteCommands` through
 *   `commandRegistryExtension` for palette/slash access.
 * - The clickable jump-back affordance on definition number labels lives in
 *   `render/sidenote-render.ts` (bundled with `sidenoteRenderPlugin`) and
 *   invokes `jumpToFootnoteRefAtPos`.
 */

import {
  type ChangeSpec,
  type Extension,
  Prec,
  type Text,
} from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import type { Command } from "./command-registry";
import type {
  FootnoteDefinition,
  FootnoteSemantics,
} from "./semantics/document";
import { documentAnalysisField } from "./state/document-analysis";

function getFootnotes(view: EditorView): FootnoteSemantics | null {
  return view.state.field(documentAnalysisField, false)?.footnotes ?? null;
}

/** Parse a footnote label as a number, or null for text labels. */
function numericLabel(id: string): number | null {
  return /^\d+$/.test(id) ? parseInt(id, 10) : null;
}

function definitionsInDocumentOrder(
  footnotes: FootnoteSemantics,
): FootnoteDefinition[] {
  return [...footnotes.defs.values()].sort((a, b) => a.from - b.from);
}

/**
 * Newline prefix that separates a definition appended at the end of the
 * document from the body text (blank line unless one already exists).
 */
function endOfDocumentSeparator(doc: Text, where: number): string {
  // The new reference itself will end the document, so the last line is
  // never empty after the insert.
  if (where === doc.length) return "\n\n";
  const tail = doc.sliceString(Math.max(0, doc.length - 2), doc.length);
  if (tail.endsWith("\n\n")) return "";
  return tail.endsWith("\n") ? "\n" : "\n\n";
}

/**
 * Insert a new `[^n]` footnote at the main selection.
 *
 * `n` is chosen so that numeric references stay in numeric document order
 * (one higher than the largest numeric label before the cursor). The
 * matching `[^n]: ` definition is inserted into the definitions block at the
 * corresponding position, all subsequent numeric refs and their definitions
 * are renumbered, and the cursor lands in the new definition body — all in a
 * single transaction (one undo step).
 */
export function insertFootnote(view: EditorView): boolean {
  const footnotes = getFootnotes(view);
  if (!footnotes) return false;
  const { state } = view;
  const doc = state.doc;

  let where = state.selection.main.from;
  // Never split an existing reference; insert after it instead.
  for (const ref of footnotes.refs) {
    if (ref.from < where && where < ref.to) {
      where = ref.to;
      break;
    }
  }
  const defsInOrder = definitionsInDocumentOrder(footnotes);
  // Never split a definition's [^id]: label either.
  for (const def of defsInOrder) {
    if (def.from < where && where < def.labelTo) {
      where = def.labelTo;
      break;
    }
  }

  // New number: one above the largest numeric label fully before the cursor.
  let newNumber = 1;
  for (const ref of footnotes.refs) {
    if (ref.to > where) continue;
    const num = numericLabel(ref.id);
    if (num !== null && num >= newNumber) newNumber = num + 1;
  }

  // Definition anchor: before the first definition that must follow the new
  // one, after the last definition otherwise, or at the end of the document
  // when no definitions exist yet.
  const defAfter = defsInOrder.find((def) => {
    const num = numericLabel(def.id);
    return num !== null && num >= newNumber;
  });
  const lastDef = defsInOrder[defsInOrder.length - 1];

  let defPos: number;
  let prefix: string;
  let suffix: string;
  if (defAfter) {
    defPos = doc.lineAt(defAfter.from).from;
    prefix = "";
    suffix = "\n";
  } else if (lastDef) {
    defPos = lastDef.to;
    prefix = "\n";
    suffix = "";
  } else {
    defPos = doc.length;
    prefix = endOfDocumentSeparator(doc, where);
    suffix = "";
  }

  const changes: ChangeSpec[] = [
    { from: where, insert: `[^${newNumber}]` },
    { from: defPos, insert: `${prefix}[^${newNumber}]: ${suffix}` },
  ];

  // Renumber all numeric refs after the insertion point to consecutive
  // numbers, keeping each definition label in sync with its reference.
  const idsBefore = new Set<string>();
  for (const ref of footnotes.refs) {
    if (ref.to <= where) idsBefore.add(ref.id);
  }

  let nextNumber = newNumber + 1;
  const renamed = new Map<string, string>();
  for (const ref of footnotes.refs) {
    if (ref.from < where) continue;
    if (numericLabel(ref.id) === null) continue;
    // A duplicate of an id already used before the cursor keeps its label so
    // the earlier occurrence stays linked to the shared definition.
    if (idsBefore.has(ref.id)) continue;

    const already = renamed.get(ref.id);
    if (already !== undefined) {
      if (already !== ref.id) {
        changes.push({ from: ref.from + 2, to: ref.to - 1, insert: already });
      }
      continue;
    }

    const next = String(nextNumber);
    renamed.set(ref.id, next);
    nextNumber++;
    if (ref.id === next) continue;

    changes.push({ from: ref.from + 2, to: ref.to - 1, insert: next });
    const def = footnotes.defs.get(ref.id);
    if (def) {
      changes.push({
        from: def.labelFrom + 2,
        to: def.labelFrom + 2 + ref.id.length,
        insert: next,
      });
    }
  }

  const changeSet = state.changes(changes);
  view.dispatch({
    changes: changeSet,
    // Land in the new definition body (just after "[^n]: ").
    selection: { anchor: changeSet.mapPos(defPos, 1) - suffix.length },
    scrollIntoView: true,
  });
  return true;
}

/**
 * Backspace guard: deleting into a `[^n]` reference first selects the whole
 * reference as a visual confirmation, so the next Backspace removes it as a
 * unit. Returns false (letting the default Backspace run) otherwise.
 */
export function selectFootnoteBeforeDelete(view: EditorView): boolean {
  const main = view.state.selection.main;
  if (!main.empty) return false;

  const footnotes = getFootnotes(view);
  const ref = footnotes?.refs.find((candidate) => candidate.to === main.head);
  if (!ref) return false;

  view.dispatch({ selection: { anchor: ref.to, head: ref.from } });
  return true;
}

/**
 * Jump back from a footnote definition at `pos` to its first `[^n]`
 * reference, selecting the reference. Used by the definition-label click
 * affordance in `render/sidenote-render.ts`.
 */
export function jumpToFootnoteRefAtPos(view: EditorView, pos: number): boolean {
  const footnotes = getFootnotes(view);
  if (!footnotes) return false;

  let def: FootnoteDefinition | undefined;
  for (const candidate of footnotes.defs.values()) {
    if (pos >= candidate.from && pos <= candidate.to) {
      def = candidate;
      break;
    }
  }
  if (!def) return false;

  const id = def.id;
  const ref = footnotes.refs.find((candidate) => candidate.id === id);
  if (!ref) return false;

  view.focus();
  view.dispatch({
    selection: { anchor: ref.from, head: ref.to },
    scrollIntoView: true,
  });
  return true;
}

/** Jump back from the footnote definition under the cursor to its reference. */
export function jumpToFootnoteRef(view: EditorView): boolean {
  return jumpToFootnoteRefAtPos(view, view.state.selection.main.head);
}

/** Palette/slash entries for the footnote commands. */
export const footnotePaletteCommands: readonly Command[] = [
  {
    id: "insert-footnote",
    label: "Insert Footnote",
    keywords: ["footnote", "note"],
    key: "Mod-Alt-f",
    slash: true,
    run: ({ view }) => insertFootnote(view),
  },
  {
    id: "jump-to-footnote-ref",
    label: "Jump to Footnote Reference",
    keywords: ["footnote", "reference", "back"],
    run: ({ view }) => jumpToFootnoteRef(view),
  },
];

/**
 * Self-contained footnote authoring bundle: the shared analysis field plus a
 * high-precedence keymap (so Backspace runs before the default
 * deleteCharBackward binding).
 */
export const footnoteCommandsExtension: Extension = [
  documentAnalysisField,
  Prec.high(
    keymap.of([
      { key: "Mod-Alt-f", run: insertFootnote },
      { key: "Backspace", run: selectFootnoteBeforeDelete },
    ]),
  ),
];
