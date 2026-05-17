/**
 * Default chrome for `RequestHandler.openLinkPicker`.
 *
 * Vanilla DOM (no React) so the editor core can call this in any host
 * — including non-React shells. Hosts that want their own UI override
 * `openLinkPicker` on `requestHandlerFacet`; this fallback only runs
 * when no host method is supplied.
 *
 * Behaviour: a small inline `<input>` overlay near the caret. Enter
 * resolves with the input value as the `insert`; Escape (or any
 * external cancel via `AbortSignal`) resolves with `null`. Clicking
 * outside the overlay also cancels.
 *
 * Class hooks for host restyling: `cf-default-picker`,
 * `cf-default-picker__input`.
 */

import type { EditorView } from "@codemirror/view";
import type {
  LinkPickerRequest,
  LinkPickerResult,
} from "../editor-host-api";

const PICKER_CLASS = "cf-default-picker";
const INPUT_CLASS = "cf-default-picker__input";

export function defaultOpenLinkPicker(
  view: EditorView,
  req: LinkPickerRequest,
): Promise<LinkPickerResult | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: LinkPickerResult | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const container = document.createElement("div");
    container.className = PICKER_CLASS;
    container.setAttribute("role", "dialog");
    container.setAttribute("aria-label", "Insert link");

    const input = document.createElement("input");
    input.type = "text";
    input.className = INPUT_CLASS;
    input.value = req.prefix;
    input.placeholder = "Paste or type a URL";
    container.appendChild(input);

    // Position near the caret. `coordsAtPos` returns viewport coords; we
    // position container `fixed` so we don't have to fight scroll
    // containers.
    const coords = view.coordsAtPos(req.cursorPos);
    if (coords) {
      container.style.position = "fixed";
      container.style.left = `${Math.round(coords.left)}px`;
      container.style.top = `${Math.round(coords.bottom + 4)}px`;
      container.style.zIndex = "1000";
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        settle({ insert: input.value });
      } else if (e.key === "Escape") {
        e.preventDefault();
        settle(null);
      }
    };

    const onOutsideMouseDown = (e: MouseEvent) => {
      if (!container.contains(e.target as Node)) {
        settle(null);
      }
    };

    const onAbort = () => settle(null);

    function cleanup() {
      input.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onOutsideMouseDown, true);
      req.signal.removeEventListener("abort", onAbort);
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    }

    input.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onOutsideMouseDown, true);
    if (req.signal.aborted) {
      // Defer to next microtask so the caller can `await` the returned promise.
      queueMicrotask(() => settle(null));
    } else {
      req.signal.addEventListener("abort", onAbort, { once: true });
    }

    // Append to the editor's containing document so it inherits styling
    // context. `view.dom.ownerDocument.body` handles jsdom + browser.
    (view.dom.ownerDocument?.body ?? document.body).appendChild(container);
    input.focus();
    input.select();
  });
}
