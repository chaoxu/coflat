/**
 * `<EditableReader>` — Phase 2.7 click-to-edit primitive (issue #4).
 *
 * Renders FORMAT.md source via `renderToHtml` + `hydrateMath` in "reading"
 * mode. When `canEdit` is true, clicking the rendered output swaps to a
 * CodeMirror 6 editor seeded with the same source + DocumentContext. The
 * editor's heavy module graph is imported lazily — hosts that never
 * click-to-edit (canEdit=false everywhere) don't pay the editor's cost.
 *
 * The reader DOM and the editor's mounted DOM are mutually exclusive:
 * when one is shown, the other is unmounted, and the CM6 view is
 * destroyed on every transition out of editing mode.
 */

import type { ReactElement } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { EditorView } from "@codemirror/view";

import {
  hydrateMath,
  mapDomRangeToSource,
  renderToHtml,
  type DocumentContext,
} from "./reader";

export type EditableReaderMode = "reading" | "editing" | "committing";

export interface EditableReaderRenderOptions {
  sourceLineAttribution?: boolean;
  sourcePositions?: boolean;
  truncate?: { lines: number } | { chars: number };
}

export interface EditableReaderProps {
  /** FORMAT.md source. */
  source: string;
  /** Resolvers shared between reader and editor. */
  context?: DocumentContext;
  /** When false, the component is pure-reader and no editor is ever mounted. */
  canEdit: boolean;
  /** Called when the user commits an edit. On rejection the editor stays mounted. */
  onCommit: (next: string) => Promise<void>;
  /** Called when the user cancels back to reading mode. */
  onCancel?: () => void;
  /** Source offset to drop the CM6 cursor at on editing-mode entry. */
  initialCaret?: number;
  /** Options forwarded to `renderToHtml`. */
  readerOptions?: EditableReaderRenderOptions;
  /** Extra className applied to the root `<div>`. */
  className?: string;
  /** KaTeX macros forwarded to `hydrateMath`. */
  mathMacros?: Record<string, string>;
}

// Lazy import of the heavy CM6 entry. The promise is cached at module scope
// so subsequent EditableReader instances share one network/parse cost.
type EditorModule = typeof import("./editor");
let editorModulePromise: Promise<EditorModule> | null = null;
function loadEditorModule(): Promise<EditorModule> {
  if (!editorModulePromise) {
    editorModulePromise = import("./editor");
  }
  return editorModulePromise;
}

/**
 * Pre-load the CM6 editor module. Hosts that know they will need the editor
 * soon (e.g. a fragment grid where most entries are owned) can call this on
 * idle to avoid the click-to-edit latency spike.
 */
export function preloadEditableReaderEditor(): Promise<void> {
  return loadEditorModule().then(() => undefined);
}

export function EditableReader(props: EditableReaderProps): ReactElement {
  const {
    source,
    context,
    canEdit,
    onCommit,
    onCancel,
    initialCaret,
    readerOptions,
    className,
    mathMacros,
  } = props;

  const [mode, setMode] = useState<EditableReaderMode>("reading");
  const [error, setError] = useState<string | null>(null);
  // Caret offset for the next editor mount. Captured at click time.
  const [pendingCaret, setPendingCaret] = useState<number | undefined>(undefined);

  // The "committed" source — what reading mode renders. Updates after a
  // successful commit so the reader re-renders with the new content without
  // waiting for the parent to thread `source` back through props (though if
  // the parent updates `source`, we follow it via the effect below).
  const [committedSource, setCommittedSource] = useState(source);
  // Track the prop value to detect external updates.
  const sourcePropRef = useRef(source);
  useEffect(() => {
    if (source !== sourcePropRef.current) {
      sourcePropRef.current = source;
      setCommittedSource(source);
    }
  }, [source]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const readerRef = useRef<HTMLDivElement | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // The source we entered editing with — used as the cancel snapshot.
  const editingOriginalRef = useRef<string>("");

  // -------------------------------------------------------------------------
  // Reading mode: render HTML + hydrate math.
  // -------------------------------------------------------------------------

  // Compute the HTML inline so it lands in the same render as the props that
  // produced it.
  const rendered =
    mode === "reading"
      ? renderToHtml(committedSource, context, {
          sourcePositions: readerOptions?.sourcePositions ?? true,
          sourceLineAttribution: readerOptions?.sourceLineAttribution,
          truncate: readerOptions?.truncate,
        })
      : null;

  // The document's own frontmatter `math:` macros, resolved by renderToHtml.
  // Kept in a ref so the hydrate effect can read the latest value without
  // adding the (newly-allocated each render) result object to its deps.
  const docMathMacrosRef = useRef<Record<string, string> | undefined>(undefined);
  docMathMacrosRef.current = rendered?.mathMacros;

  // Hydrate math after the reader DOM is committed.
  useLayoutEffect(() => {
    if (mode !== "reading") return;
    const root = readerRef.current;
    if (!root) return;
    // Frontmatter macros are the base; the explicit `mathMacros` prop overrides
    // per key, so document math renders without the host re-parsing frontmatter.
    const docMacros = docMathMacrosRef.current;
    const macros =
      docMacros || mathMacros ? { ...docMacros, ...mathMacros } : undefined;
    // hydrateMath is best-effort; per-equation failures are already
    // surfaced on the placeholder via `cf-math-error`. No abort handle.
    void hydrateMath(root, macros ? { mathMacros: macros } : undefined).catch(() => {});
  }, [mode, committedSource, mathMacros]);

  // -------------------------------------------------------------------------
  // Click-to-edit: switch reading -> editing.
  // -------------------------------------------------------------------------

  const handleReaderClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      // Don't hijack clicks on anchors/buttons inside the reader.
      const target = event.target as Element | null;
      if (target?.closest("a, button, [data-no-edit-swap]")) return;

      let caret = initialCaret;
      if (caret === undefined && readerRef.current) {
        const selection =
          typeof window !== "undefined" ? window.getSelection() : null;
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          if (
            readerRef.current.contains(range.startContainer) &&
            readerRef.current.contains(range.endContainer)
          ) {
            const mapped = mapDomRangeToSource(range, readerRef.current);
            if (mapped) caret = mapped.from;
          }
        }
      }
      setPendingCaret(caret);
      editingOriginalRef.current = committedSource;
      setError(null);
      setMode("editing");
    },
    [canEdit, committedSource, initialCaret],
  );

  // -------------------------------------------------------------------------
  // Editing mode: mount CM6, wire keybindings + click-outside.
  // -------------------------------------------------------------------------

  // The async commit/cancel handlers need to see the latest mounted view to
  // read the document, so we capture them via refs.
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  const commit = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    const next = view.state.doc.toString();
    setMode("committing");
    try {
      await onCommitRef.current(next);
      setCommittedSource(next);
      setError(null);
      setMode("reading");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : String(err ?? "Commit failed");
      setError(message);
      // Stay in editing mode; the editor's view still exists.
      setMode("editing");
    }
  }, []);

  const cancel = useCallback(() => {
    setError(null);
    setMode("reading");
    onCancelRef.current?.();
  }, []);

  // Mount/unmount the CM6 view when entering/leaving editing modes.
  useLayoutEffect(() => {
    if (mode === "reading") return;
    const host = editorHostRef.current;
    if (!host) return;

    let cancelled = false;
    let mountedView: EditorView | null = null;

    void loadEditorModule().then(({ createEditor }) => {
      if (cancelled) return;
      const view = createEditor({
        parent: host,
        doc: editingOriginalRef.current,
        extensions: [
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              // Clear the error banner on the next user edit.
              setError((prev) => (prev === null ? prev : null));
            }
          }),
        ],
      });
      mountedView = view;
      viewRef.current = view;
      // Drop the caret if requested.
      const caret = pendingCaret;
      if (caret !== undefined) {
        const clamped = Math.max(0, Math.min(caret, view.state.doc.length));
        view.dispatch({ selection: { anchor: clamped } });
      }
      view.focus();
    });

    return () => {
      cancelled = true;
      const v = mountedView ?? viewRef.current;
      if (v) {
        v.destroy();
      }
      viewRef.current = null;
    };
    // We intentionally re-mount only when the mode flips into edit. The
    // pendingCaret captured at click time is used by the mount effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode === "reading"]);

  // Editor-level keybindings and click-outside detection. Only active while
  // editing or committing.
  useEffect(() => {
    if (mode === "reading") return;

    const onKey = (e: KeyboardEvent) => {
      if (mode === "committing") return;
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void commit();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (mode === "committing") return;
      const container = containerRef.current;
      if (!container) return;
      const target = e.target as Node | null;
      if (target && container.contains(target)) return;
      cancel();
    };

    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [mode, commit, cancel]);

  // If canEdit flips off mid-edit, force-cancel back to reading.
  useEffect(() => {
    if (!canEdit && mode !== "reading") {
      cancel();
    }
  }, [canEdit, mode, cancel]);

  // -------------------------------------------------------------------------
  // Render.
  // -------------------------------------------------------------------------

  const rootClass = ["cf-theme-scope", "cf-editable-reader", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={containerRef}
      className={rootClass}
      data-mode={mode}
      data-can-edit={canEdit ? "true" : "false"}
    >
      {mode === "reading" && rendered ? (
        <div
          ref={readerRef}
          className="cf-doc-surface cf-doc-flow cf-reader cf-editable-reader__reader"
          onClick={handleReaderClick}
          // Sanitized HTML from renderToHtml; safe to dangerously set.
          dangerouslySetInnerHTML={{ __html: rendered.html }}
        />
      ) : (
        <>
          {error ? (
            <div role="alert" className="cf-editable-reader__error">
              {error}
            </div>
          ) : null}
          <div
            ref={editorHostRef}
            className="cf-editable-reader__editor"
            data-committing={mode === "committing" ? "true" : undefined}
          />
        </>
      )}
    </div>
  );
}
