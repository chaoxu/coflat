/**
 * Default chrome for `RequestHandler.openAutocomplete` (Phase 3.4).
 *
 * Vanilla DOM (no React) so the editor core can call this in any host
 * — including non-React shells. Hosts that want their own UI override
 * `openAutocomplete` on `requestHandlerFacet`; this fallback only runs
 * when no host method is supplied and at least one `AutocompleteSource`
 * is registered.
 *
 * Behaviour: a small overlay near the caret listing
 * `req.suggestions`. Arrow keys navigate, Enter selects, Escape or
 * outside-click cancels. AbortSignal propagation cancels too.
 *
 * Class hooks for host restyling:
 *   `cf-default-autocomplete`,
 *   `cf-default-autocomplete__item`,
 *   `cf-default-autocomplete__item--selected`.
 */

import type { EditorView } from "@codemirror/view";
import type {
  AutocompleteRequest,
  AutocompleteResult,
} from "../../editor-host-api";

const PICKER_CLASS = "cf-default-autocomplete";
const ITEM_CLASS = "cf-default-autocomplete__item";
const ITEM_SELECTED_CLASS = "cf-default-autocomplete__item--selected";

export function defaultOpenAutocomplete(
  view: EditorView,
  req: AutocompleteRequest,
): Promise<AutocompleteResult | null> {
  return new Promise((resolve) => {
    if (req.suggestions.length === 0) {
      // Nothing to show — resolve null without painting.
      queueMicrotask(() => resolve(null));
      return;
    }

    let settled = false;
    let selectedIndex = 0;
    const settle = (result: AutocompleteResult | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const container = document.createElement("div");
    container.className = PICKER_CLASS;
    container.setAttribute("role", "listbox");
    container.setAttribute("aria-label", "Autocomplete");

    const items: HTMLElement[] = [];
    req.suggestions.forEach((s, i) => {
      const item = document.createElement("div");
      item.className = ITEM_CLASS;
      item.setAttribute("role", "option");
      item.dataset.suggestionId = s.id;
      if (s.icon) {
        const icon = document.createElement("span");
        icon.className = `${ITEM_CLASS}__icon`;
        icon.textContent = s.icon;
        item.appendChild(icon);
      }
      const label = document.createElement("span");
      label.className = `${ITEM_CLASS}__label`;
      label.textContent = s.display;
      item.appendChild(label);
      if (s.description) {
        const desc = document.createElement("span");
        desc.className = `${ITEM_CLASS}__description`;
        desc.textContent = s.description;
        item.appendChild(desc);
      }
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        settle({ insert: s.insert });
      });
      item.addEventListener("mousemove", () => {
        if (selectedIndex !== i) {
          selectedIndex = i;
          render();
        }
      });
      items.push(item);
      container.appendChild(item);
    });

    function render(): void {
      items.forEach((el, i) => {
        if (i === selectedIndex) {
          el.classList.add(ITEM_SELECTED_CLASS);
          el.setAttribute("aria-selected", "true");
        } else {
          el.classList.remove(ITEM_SELECTED_CLASS);
          el.setAttribute("aria-selected", "false");
        }
      });
    }
    render();

    // Position near the caret. Match the link-picker convention.
    const coords = view.coordsAtPos(req.cursorPos);
    if (coords) {
      container.style.position = "fixed";
      container.style.left = `${Math.round(coords.left)}px`;
      container.style.top = `${Math.round(coords.bottom + 4)}px`;
      container.style.zIndex = "1000";
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % items.length;
        render();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + items.length) % items.length;
        render();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const chosen = req.suggestions[selectedIndex];
        if (chosen) {
          settle({ insert: chosen.insert });
        } else {
          settle(null);
        }
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
      view.dom.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onOutsideMouseDown, true);
      req.signal.removeEventListener("abort", onAbort);
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    }

    // Listen on the editor DOM so typing in the editor still drives the
    // picker. Capture so we win over editor keybindings.
    view.dom.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onOutsideMouseDown, true);
    if (req.signal.aborted) {
      queueMicrotask(() => settle(null));
    } else {
      req.signal.addEventListener("abort", onAbort, { once: true });
    }

    (view.dom.ownerDocument?.body ?? document.body).appendChild(container);
  });
}
