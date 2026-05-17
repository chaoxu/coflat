/**
 * Phase 3.2 (#10) — SaveHandler wiring.
 *
 * Provides:
 *  - a CM6 extension that snapshots the last successfully-saved source,
 *    fires {@link StatusEvents.onDirtyChange} on transitions only, and
 *    debounces autosave per the host-supplied (or default) cadence;
 *  - {@link createSaveController} which exposes {@code isSaved} and
 *    {@code triggerSave} for the {@code MountedEditor} surface; and
 *  - {@code saveKeymap} which binds Ctrl/Cmd-S → manual save when (and
 *    only when) a {@link SaveHandler} is present.
 *
 * The dispatcher itself is shared by autosave, the keymap, and
 * {@code triggerSave}, so {@code onSaveStart} / {@code onSaveSucceeded} /
 * {@code onSaveFailed} fire in a single place.
 */

import { Prec } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin } from "@codemirror/view";

import {
  DEFAULT_AUTOSAVE_DEBOUNCE_MS,
  emitStatusEvent,
  saveHandlerFacet,
  type SaveHandler,
} from "./editor-host-api";

type SaveReason = "manual" | "command" | "autosave";

interface SaveControllerInternal {
  isSaved(): boolean;
  triggerSave(reason?: "manual" | "command"): Promise<void>;
}

interface PerViewState {
  lastSavedSource: string;
  dirty: boolean;
  autosaveTimer: ReturnType<typeof setTimeout> | null;
  pendingDispatch: Promise<void> | null;
}

const stateByView = new WeakMap<EditorView, PerViewState>();

function getState(view: EditorView): PerViewState {
  let s = stateByView.get(view);
  if (!s) {
    s = {
      lastSavedSource: view.state.doc.toString(),
      dirty: false,
      autosaveTimer: null,
      pendingDispatch: null,
    };
    stateByView.set(view, s);
  }
  return s;
}

function clearAutosave(s: PerViewState): void {
  if (s.autosaveTimer !== null) {
    clearTimeout(s.autosaveTimer);
    s.autosaveTimer = null;
  }
}

function setDirty(view: EditorView, s: PerViewState, dirty: boolean): void {
  if (s.dirty === dirty) return;
  s.dirty = dirty;
  emitStatusEvent(view, "onDirtyChange", dirty);
}

async function dispatchSave(view: EditorView, reason: SaveReason): Promise<void> {
  const handler = view.state.facet(saveHandlerFacet);
  if (!handler) return;
  const s = getState(view);
  // Serialize concurrent saves; keymap + autosave + triggerSave share this.
  if (s.pendingDispatch) {
    await s.pendingDispatch;
  }
  const source = view.state.doc.toString();
  const run = (async () => {
    clearAutosave(s);
    emitStatusEvent(view, "onSaveStart");
    try {
      const result = await handler.save({ source, reason });
      if (result.ok) {
        s.lastSavedSource = source;
        setDirty(view, s, source !== view.state.doc.toString());
        emitStatusEvent(view, "onSaveSucceeded");
      } else {
        emitStatusEvent(view, "onSaveFailed", { error: result.error });
      }
    } catch (e) {
      emitStatusEvent(view, "onSaveFailed", { error: String(e) });
    } finally {
      s.pendingDispatch = null;
    }
  })();
  s.pendingDispatch = run;
  await run;
}

function scheduleAutosave(view: EditorView, handler: SaveHandler): void {
  const s = getState(view);
  clearAutosave(s);
  const delay = handler.autosaveDebounceMs ?? DEFAULT_AUTOSAVE_DEBOUNCE_MS;
  s.autosaveTimer = setTimeout(() => {
    s.autosaveTimer = null;
    const current = view.state.facet(saveHandlerFacet);
    if (!current) return;
    // Editor still dirty? If a doc edit reverted to the last-saved
    // source, dirty is already false and there's nothing to save.
    if (!getState(view).dirty) return;
    // isBusy is checked exactly here — at fire time, not on a poll.
    if (current.isBusy?.()) return;
    void dispatchSave(view, "autosave");
  }, delay);
}

/**
 * Extension that powers dirty tracking and autosave. Should be included
 * exactly once per editor view.
 */
export function saveExtension() {
  return [
    // ViewPlugin so we can capture the initial doc as the baseline
    // BEFORE any updateListener fires.
    ViewPlugin.define((view) => {
      getState(view); // eager init: snapshot current doc as last-saved
      return {
        destroy() {
          const s = stateByView.get(view);
          if (s) clearAutosave(s);
          stateByView.delete(view);
        },
      };
    }),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      const handler = update.view.state.facet(saveHandlerFacet);
      const s = getState(update.view);
      const source = update.state.doc.toString();
      setDirty(update.view, s, source !== s.lastSavedSource);
      if (handler && s.dirty) {
        scheduleAutosave(update.view, handler);
      } else {
        clearAutosave(s);
      }
    }),
    Prec.high(
      keymap.of([
        {
          key: "Mod-s",
          run(view) {
            if (!view.state.facet(saveHandlerFacet)) return false;
            void dispatchSave(view, "manual");
            return true;
          },
        },
      ]),
    ),
  ];
}

/**
 * Build the {@code isSaved} / {@code triggerSave} surface bound to a view.
 * The editor exposes these on the {@code MountedEditor} handle.
 */
export function createSaveController(view: EditorView): SaveControllerInternal {
  return {
    isSaved() {
      const s = getState(view);
      return view.state.doc.toString() === s.lastSavedSource;
    },
    async triggerSave(reason: "manual" | "command" = "manual") {
      await dispatchSave(view, reason);
    },
  };
}
