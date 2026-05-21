/**
 * Watches doc/selection changes, performs trigger detection against the
 * registered {@link AutocompleteSource}s, debounces per source, calls
 * `suggest()` with an AbortSignal, then forwards the aggregated
 * suggestions to {@link RequestHandler.openAutocomplete} (or the
 * library default chrome via {@link resolveOpenAutocomplete}).
 *
 * Behaviour invariants:
 *   - Longest trigger match wins (so `[@` beats `[`).
 *   - Cancels in-flight `suggest()` on every prefix change, whitespace,
 *     Escape, outside-click, or unmount.
 *   - Editor replaces exactly `[triggerStart..cursorPos]` with
 *     `Suggestion.insert` on selection.
 *   - No regex per character — trigger scanning is `String.endsWith`
 *     against the bounded line slice ending at the caret.
 */

import { type Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import {
  autocompleteSourcesFacet,
  DEFAULT_AUTOCOMPLETE_DEBOUNCE_MS,
  resolveOpenAutocomplete,
  type AutocompleteSource,
  type Suggestion,
} from "./editor-host-api";

interface ActiveSession {
  trigger: string;
  triggerStart: number;
  prefix: string;
  controller: AbortController;
  /** Set when the picker is mounted (host or default). */
  pickerActive: boolean;
}

/** Char-class test for "non-prefix" / whitespace cancellation. */
function isWhitespace(ch: string): boolean {
  // Tabs and newlines also count — they unambiguously end the token.
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/**
 * Find the longest registered trigger that ends at the caret, looking
 * backwards on the current line only. Returns the trigger string and the
 * doc offset where the trigger starts. Returns null if no match.
 */
function detectTrigger(
  beforeCaret: string,
  sources: readonly AutocompleteSource[],
): { trigger: string; triggerStartOffsetFromEnd: number } | null {
  // Scan: walk back char-by-char up to the longest registered trigger
  // length, checking endsWith against the set of triggers. Longest wins.
  let bestLen = 0;
  let bestTrigger: string | null = null;
  const triggers = new Set<string>();
  let maxTriggerLen = 0;
  for (const s of sources) {
    if (s.trigger.length === 0) continue;
    triggers.add(s.trigger);
    if (s.trigger.length > maxTriggerLen) maxTriggerLen = s.trigger.length;
  }
  if (triggers.size === 0) return null;
  // Try every suffix length, keep the longest that matches a registered
  // trigger AND has only "prefix-safe" chars between trigger end and
  // caret. Because the trigger ends at end-of-string, "prefix" is empty
  // at this point; the caller is responsible for re-detecting after
  // each keystroke.
  // We allow the prefix to extend behind the trigger by searching the
  // last-known-trigger location on the line as a tail-anchored substring.
  for (let len = Math.min(maxTriggerLen, beforeCaret.length); len > 0; len--) {
    const candidate = beforeCaret.slice(beforeCaret.length - len);
    if (triggers.has(candidate)) {
      if (len > bestLen) {
        bestLen = len;
        bestTrigger = candidate;
      }
    }
  }
  if (bestTrigger) {
    return { trigger: bestTrigger, triggerStartOffsetFromEnd: bestLen };
  }
  return null;
}

/**
 * Once a trigger has been "armed" at offset T, scan forward from T to the
 * caret to extract the prefix typed so far. Returns null if the prefix
 * contains whitespace (cancellation), or the line-bounded prefix string
 * otherwise.
 */
function extractPrefix(
  lineText: string,
  triggerStartCol: number,
  triggerLen: number,
  caretCol: number,
): string | null {
  if (caretCol < triggerStartCol + triggerLen) return null;
  const slice = lineText.slice(triggerStartCol + triggerLen, caretCol);
  for (let i = 0; i < slice.length; i++) {
    if (isWhitespace(slice[i])) return null;
  }
  return slice;
}

/**
 * Locate (line, column) for an absolute doc offset and return the line
 * text + columns. Cheap helper around CM6 `Line` API.
 */
interface CaretContext {
  lineText: string;
  lineFrom: number;
  caretCol: number;
}
function caretContext(view: EditorView, pos: number): CaretContext {
  const line = view.state.doc.lineAt(pos);
  return {
    lineText: line.text,
    lineFrom: line.from,
    caretCol: pos - line.from,
  };
}

/**
 * Internal: builds the autocomplete ViewPlugin. Exported via
 * {@link autocompleteSourceExtension}.
 */
class AutocompleteSourceController {
  private session: ActiveSession | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private from: string | undefined;

  constructor(
    private readonly view: EditorView,
    from?: string,
  ) {
    this.from = from;
  }

  update(update: ViewUpdate): void {
    if (!update.docChanged && !update.selectionSet) return;
    // Ignore programmatic doc changes that don't come from user input?
    // For now, follow same behaviour as keystroke input — host can
    // re-arm regardless.
    this.scan();
  }

  /** Public for tests / unmount. */
  cancel(reason: "external" | "destroyed" = "external"): void {
    if (this.debounceTimer != null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.session) {
      this.session.controller.abort();
      this.session = null;
    }
    if (reason === "destroyed") {
      // No further scans.
    }
  }

  destroy(): void {
    this.cancel("destroyed");
  }

  private scan(): void {
    const sources = this.view.state.facet(autocompleteSourcesFacet);
    if (sources.length === 0) {
      if (this.session) this.cancel();
      return;
    }
    const selection = this.view.state.selection.main;
    if (!selection.empty) {
      if (this.session) this.cancel();
      return;
    }
    const pos = selection.head;
    const ctx = caretContext(this.view, pos);

    // If we already have an armed session, try to extend it first.
    if (this.session) {
      const sessionTriggerCol =
        this.session.triggerStart - ctx.lineFrom;
      // If the caret has moved before the trigger, abandon.
      if (
        sessionTriggerCol < 0
        || ctx.caretCol < sessionTriggerCol + this.session.trigger.length
        || !ctx.lineText.startsWith(
          this.session.trigger,
          sessionTriggerCol,
        )
      ) {
        this.cancel();
      } else {
        const prefix = extractPrefix(
          ctx.lineText,
          sessionTriggerCol,
          this.session.trigger.length,
          ctx.caretCol,
        );
        if (prefix === null) {
          this.cancel();
          return;
        }
        if (prefix === this.session.prefix) return;
        // Prefix changed — cancel previous suggest and re-schedule.
        this.session.controller.abort();
        this.session.controller = new AbortController();
        this.session.prefix = prefix;
        this.scheduleSuggest();
        return;
      }
    }

    // No active session — detect a fresh trigger.
    const beforeCaret = ctx.lineText.slice(0, ctx.caretCol);
    const hit = detectTrigger(beforeCaret, sources);
    if (!hit) return;
    const triggerStartCol = ctx.caretCol - hit.triggerStartOffsetFromEnd;
    this.session = {
      trigger: hit.trigger,
      triggerStart: ctx.lineFrom + triggerStartCol,
      prefix: "",
      controller: new AbortController(),
      pickerActive: false,
    };
    this.scheduleSuggest();
  }

  private scheduleSuggest(): void {
    if (this.debounceTimer != null) {
      clearTimeout(this.debounceTimer);
    }
    const session = this.session;
    if (!session) return;
    const sources = this.view.state
      .facet(autocompleteSourcesFacet)
      .filter((s) => s.trigger === session.trigger);
    if (sources.length === 0) return;
    // Per-source debounce. When several sources share a trigger we
    // collapse to a single timer using the longest declared debounce —
    // every source gets at least its own quiet window before firing.
    let debounceMs = 0;
    let sawExplicit = false;
    for (const s of sources) {
      const d = s.debounceMs;
      if (typeof d === "number" && d >= 0) {
        sawExplicit = true;
        if (d > debounceMs) debounceMs = d;
      }
    }
    if (!sawExplicit) debounceMs = DEFAULT_AUTOCOMPLETE_DEBOUNCE_MS;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.fire(sources);
    }, debounceMs);
  }

  private async fire(matchingSources: readonly AutocompleteSource[]): Promise<void> {
    const session = this.session;
    if (!session) return;
    const signal = session.controller.signal;
    const cursorPos = this.view.state.selection.main.head;
    const env = { from: this.from, cursorPos, signal };

    const aggregated: Suggestion[] = [];
    const results = await Promise.all(
      matchingSources.map((s) => {
        try {
          return Promise.resolve(s.suggest(session.prefix, env)).catch(
            () => [] as readonly Suggestion[],
          );
        } catch {
          return Promise.resolve<readonly Suggestion[]>([]);
        }
      }),
    );
    if (signal.aborted) return;
    const seen = new Set<string>();
    for (const arr of results) {
      for (const s of arr) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        aggregated.push(s);
      }
    }

    if (signal.aborted) return;
    if (this.session !== session) return;

    session.pickerActive = true;
    let result: { insert: string } | null = null;
    try {
      result = await resolveOpenAutocomplete(this.view, {
        trigger: session.trigger,
        prefix: session.prefix,
        cursorPos,
        signal,
        sources: matchingSources,
        suggestions: aggregated,
      });
    } catch {
      result = null;
    }

    if (this.session !== session) return;
    if (signal.aborted) {
      this.session = null;
      return;
    }
    if (result && result.insert) {
      this.commit(session, result.insert);
    }
    this.session = null;
  }

  private commit(session: ActiveSession, insert: string): void {
    const from = session.triggerStart;
    const to = from + session.trigger.length + session.prefix.length;
    const docLen = this.view.state.doc.length;
    if (from < 0 || to > docLen) return;
    this.view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
    });
  }
}

/**
 * Public extension. Hosts call {@link mountEditor} with an
 * `autocompleteSources` array; the resulting facet entry plus this
 * extension drive the picker lifecycle.
 *
 * `from` is the optional source-file identifier passed into
 * {@link AutocompleteEnv.from} — usually the path the document was
 * loaded from.
 */
export function autocompleteSourceExtension(opts: {
  from?: string;
} = {}): Extension {
  return ViewPlugin.define((view) => new AutocompleteSourceController(view, opts.from), {
    eventHandlers: {
      // Nothing for now — Escape & outside-click are handled by the
      // chrome (default picker listens on `view.dom`); whitespace
      // cancellation is handled in `update()`.
    },
  });
}
