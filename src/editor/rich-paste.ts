/**
 * Rich paste and copy-as-markdown/html.
 *
 * Ports Zettlr's clipboard handling to coflat:
 *
 *   - **Paste intent heuristic** — rich sources (MS Office, LibreOffice,
 *     browsers) write text *and* image flavors to the clipboard; whenever
 *     `text/plain` is present the user intends text. The image side of the
 *     heuristic lives in `image-paste.ts`, which stands down on any clipboard
 *     that carries a `text/plain` flavor.
 *   - **HTML → Markdown paste** — when the `text/html` flavor is meaningfully
 *     richer than `text/plain`, convert it to Coflat-flavored markdown via
 *     turndown (loaded lazily on first use so the eager bundle graph does not
 *     grow) and insert that instead of the plain text.
 *   - **Paste as plain text** (Mod-Shift-v) — bypasses the conversion and
 *     inserts the `text/plain` flavor verbatim.
 *   - **Copy as Markdown / Copy as HTML** — explicit clipboard commands; the
 *     HTML variant writes a dual `text/plain` + `text/html` ClipboardItem and
 *     is off until a host injects a markdown→HTML renderer via
 *     {@link htmlCopyRendererFacet} (`src/editor` deliberately does not import
 *     `src/reader`, so the reader's `renderToHtml` must be injected from
 *     layer-legal wiring such as the package root or the host app).
 *
 * Wiring (integrator):
 *   1. Append `richPasteExtension()` to the base editor extensions (order
 *      relative to `imagePasteExtension()` does not matter — the two handle
 *      disjoint clipboard shapes).
 *   2. Register `createRichPasteCommands()` through `commandRegistryExtension`.
 *   3. Optionally provide `htmlCopyRendererFacet.of((md) => renderToHtml(...))`
 *      to enable "Copy as HTML".
 */

import { type EditorState, type Extension, Facet, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type TurndownService from "turndown";
import type { Command } from "./command-registry";

/* ────────────────────────────────────────────────────────────────────────────
 * Paste-intent heuristic
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Formatting/structure tags whose presence makes an HTML clipboard flavor
 * "meaningfully richer" than the plain-text flavor. Generic wrappers that
 * plain-text-ish sources emit (`<div>`, `<span style=…>`, `<meta>`, `<p>`,
 * `<br>`) are deliberately absent: VS Code, terminals, and macOS write those
 * around content that the user thinks of as plain text.
 */
const RICH_MARKUP_RE =
  /<(?:a|b|strong|i|em|s|del|strike|mark|code|pre|kbd|h[1-6]|ul|ol|li|table|blockquote|img|hr|sub|sup|dl|figure)\b/i;

/**
 * Decide whether the `text/html` clipboard flavor carries formatting or
 * structure that the `text/plain` flavor loses.
 *
 * Zettlr's own check (util/copy-paste-cut.ts:63) is `html === plain`; this is
 * a stricter version that also treats style-only wrappers as plain so that
 * pasting code from a syntax-highlighting editor does not round-trip through
 * turndown.
 */
export function htmlIsMeaningfullyRicher(html: string, plain: string): boolean {
  if (!html.trim()) return false;
  if (html === plain) return false;
  return RICH_MARKUP_RE.test(html);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Lazy turndown (HTML → Coflat markdown)
 * ──────────────────────────────────────────────────────────────────────────── */

let turndownServicePromise: Promise<TurndownService> | null = null;

function tableAncestor(node: HTMLElement): HTMLElement | null {
  let current: Node | null = node;
  while (current) {
    if (current.nodeName === "TABLE") return current as HTMLElement;
    current = current.parentNode;
  }
  return null;
}

function cellsOf(row: HTMLElement): HTMLElement[] {
  return Array.from(row.children).filter(
    (child): child is HTMLElement => child.nodeName === "TH" || child.nodeName === "TD",
  );
}

function isHeadingRow(row: HTMLElement): boolean {
  const parent = row.parentNode as HTMLElement | null;
  if (!parent) return false;
  if (parent.nodeName === "THEAD") return true;
  const table = parent.nodeName === "TABLE"
    ? parent
    : (parent.parentNode as HTMLElement | null);
  if (!table || table.nodeName !== "TABLE") return false;
  if (table.querySelector("tr") !== row) return false;
  const cells = cellsOf(row);
  return cells.length > 0 && cells.every((cell) => cell.nodeName === "TH");
}

function spanCount(cell: HTMLElement, attribute: "colspan" | "rowspan"): number {
  return Number.parseInt(cell.getAttribute(attribute) ?? "1", 10) || 1;
}

/**
 * A table maps onto a Coflat pipe table when it has exactly one header row
 * (a `<thead>` or a leading all-`<th>` row), no spanning cells, and no nested
 * table or caption. Anything else falls through to turndown's default rules,
 * which degrade the cells to plain paragraphs instead of emitting a broken
 * pipe table.
 */
function isPipeConvertibleTable(table: HTMLElement | null): boolean {
  if (!table) return false;
  if (table.querySelector("table, caption")) return false;
  const rows = Array.from(table.querySelectorAll("tr")) as HTMLElement[];
  if (rows.length === 0) return false;
  if (!isHeadingRow(rows[0])) return false;
  for (let i = 1; i < rows.length; i++) {
    if (isHeadingRow(rows[i])) return false;
  }
  for (const row of rows) {
    for (const cell of cellsOf(row)) {
      if (spanCount(cell, "colspan") > 1 || spanCount(cell, "rowspan") > 1) {
        return false;
      }
    }
  }
  return true;
}

const DELIMITER_BY_ALIGNMENT: Record<string, string> = {
  left: ":---",
  right: "---:",
  center: ":---:",
  "": "---",
};

function cellAlignment(cell: HTMLElement): string {
  const attr = (cell.getAttribute("align") ?? "").toLowerCase();
  if (attr === "left" || attr === "right" || attr === "center") return attr;
  const match = /text-align:\s*(left|right|center)/i.exec(
    cell.getAttribute("style") ?? "",
  );
  return match ? match[1].toLowerCase() : "";
}

function pipeCellContent(content: string): string {
  return content
    .trim()
    // Coflat's table-cell rule (FORMAT.md): inline `<br>` is the line-break
    // syntax inside a pipe-table cell — collapse any converted line break
    // (including turndown's trailing-space hard breaks) back to `<br>`.
    .replace(/ *\r?\n+ */g, "<br>")
    .replace(/\|/g, "\\|");
}

/**
 * Configure a turndown service to Coflat conventions (FORMAT.md): ATX
 * headings, fenced code blocks, `**bold**` / `*italic*`, `~~strikethrough~~`,
 * `==highlight==`, `-` bullets, hard breaks as two trailing spaces, and pipe
 * tables for tables that map onto them.
 */
function configureCoflatTurndown(service: TurndownService): TurndownService {
  // Office/Word HTML carries <style> blocks (and sometimes <script>/<title>)
  // whose raw text would otherwise leak into the converted markdown.
  service.remove(["style", "script", "title"]);
  // Tight list items: single space after the marker, continuation lines
  // indented to the marker width (turndown's default pads to four columns).
  service.addRule("coflatListItem", {
    filter: "li",
    replacement: (content, node, options) => {
      let prefix = `${options.bulletListMarker ?? "-"} `;
      const parent = node.parentNode as HTMLElement | null;
      if (parent?.nodeName === "OL") {
        const start = Number.parseInt(parent.getAttribute("start") ?? "1", 10) || 1;
        const index = Array.prototype.indexOf.call(parent.children, node);
        prefix = `${start + index}. `;
      }
      const body = content
        .replace(/^\n+/, "")
        .replace(/\n+$/, "\n")
        .replace(/\n/gm, `\n${" ".repeat(prefix.length)}`);
      const separator = node.nextSibling && !/\n$/.test(body) ? "\n" : "";
      return `${prefix}${body}${separator}`;
    },
  });
  service.addRule("coflatStrikethrough", {
    filter: (node) =>
      node.nodeName === "DEL" || node.nodeName === "S" || node.nodeName === "STRIKE",
    replacement: (content) => (content ? `~~${content}~~` : ""),
  });
  service.addRule("coflatHighlight", {
    filter: (node) => node.nodeName === "MARK",
    replacement: (content) => (content ? `==${content}==` : ""),
  });
  service.addRule("coflatTableCell", {
    filter: (node) =>
      (node.nodeName === "TH" || node.nodeName === "TD")
      && isPipeConvertibleTable(tableAncestor(node)),
    replacement: (content, node) => {
      const row = node.parentNode as HTMLElement;
      const prefix = cellsOf(row).indexOf(node) === 0 ? "| " : " ";
      return `${prefix}${pipeCellContent(content)} |`;
    },
  });
  service.addRule("coflatTableRow", {
    filter: (node) =>
      node.nodeName === "TR" && isPipeConvertibleTable(tableAncestor(node)),
    replacement: (content, node) => {
      let delimiter = "";
      if (isHeadingRow(node)) {
        const markers = cellsOf(node).map(
          (cell) => DELIMITER_BY_ALIGNMENT[cellAlignment(cell)],
        );
        delimiter = `\n| ${markers.join(" | ")} |`;
      }
      return `\n${content}${delimiter}`;
    },
  });
  service.addRule("coflatTableSection", {
    filter: (node) =>
      (node.nodeName === "THEAD" || node.nodeName === "TBODY" || node.nodeName === "TFOOT")
      && isPipeConvertibleTable(tableAncestor(node)),
    replacement: (content) => content,
  });
  service.addRule("coflatTable", {
    filter: (node) => node.nodeName === "TABLE" && isPipeConvertibleTable(node),
    replacement: (content) => `\n\n${content.replace(/\n+/g, "\n").trim()}\n\n`,
  });
  return service;
}

function loadTurndownService(): Promise<TurndownService> {
  // Lazy: turndown only enters the module graph on the first rich HTML paste.
  // The bundle-graph gate (scripts/measure-package-graph.mjs --assert) only
  // permits it as a dynamic specifier.
  turndownServicePromise ??= import("turndown").then(({ default: Turndown }) =>
    configureCoflatTurndown(
      new Turndown({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        fence: "```",
        emDelimiter: "*",
        strongDelimiter: "**",
        bulletListMarker: "-",
        hr: "---",
        linkStyle: "inlined",
      }),
    ),
  );
  return turndownServicePromise;
}

/** Convert an HTML fragment to Coflat-flavored markdown (lazy turndown). */
export async function htmlToMarkdown(html: string): Promise<string> {
  const service = await loadTurndownService();
  return service.turndown(html);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Paste handling
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * How long a Mod-Shift-v "paste plain" intent stays valid while waiting for
 * the browser's native paste event. Generous, but bounded so an intent from a
 * key press whose default action never produced a paste cannot leak into an
 * unrelated later paste.
 */
const PLAIN_PASTE_INTENT_WINDOW_MS = 2000;

const plainPasteIntentAt = new WeakMap<EditorView, number>();

function consumePlainPasteIntent(view: EditorView): boolean {
  const at = plainPasteIntentAt.get(view);
  if (at === undefined) return false;
  plainPasteIntentAt.delete(view);
  return Date.now() - at <= PLAIN_PASTE_INTENT_WINDOW_MS;
}

async function insertConvertedHtml(
  view: EditorView,
  html: string,
  fallback: string,
): Promise<void> {
  let markdown: string;
  try {
    markdown = await htmlToMarkdown(html);
  } catch (err) {
    // On conversion failure fall back to the plain-text flavor
    // (Zettlr md-paste-drop-handlers.ts:132-136).
    console.error("[coflat] HTML paste conversion failed:", err);
    markdown = fallback;
  }
  if (markdown === "") markdown = fallback;
  if (!view.dom.isConnected) return;
  view.dispatch(view.state.replaceSelection(markdown), {
    scrollIntoView: true,
    userEvent: "input.paste",
  });
}

function handleRichPaste(event: ClipboardEvent, view: EditorView): boolean {
  const data = event.clipboardData;
  if (!data) return false;

  // A pending Mod-Shift-v always refers to the very next paste event: consume
  // it and stand down so CM6's default paste inserts text/plain verbatim.
  if (consumePlainPasteIntent(view)) return false;

  // Intent heuristic (Zettlr md-paste-drop-handlers.ts:98-116): text/plain
  // present means the user intends text. Without it this is an image/file
  // paste (image-paste.ts owns that); without text/html the CM6 default
  // plain-text paste is already correct.
  const types = data.types;
  if (!types.includes("text/plain") || !types.includes("text/html")) return false;

  const html = data.getData("text/html");
  const plain = data.getData("text/plain");
  if (!htmlIsMeaningfullyRicher(html, plain)) return false;

  event.preventDefault();
  void insertConvertedHtml(view, html, plain);
  return true;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Copy / paste commands
 * ──────────────────────────────────────────────────────────────────────────── */

/** Render markdown to an HTML string for "Copy as HTML". May be async. */
export type HtmlCopyRenderer = (markdown: string) => string | Promise<string>;

/**
 * At-most-one markdown→HTML renderer for {@link copySelectionAsHtml}; last
 * wins, defaulting to `null` which leaves copy-as-HTML off. The editor layer
 * does not import the reader, so hosts inject the reader's `renderToHtml`
 * (or any other renderer) from layer-legal wiring.
 */
export const htmlCopyRendererFacet = Facet.define<
  HtmlCopyRenderer,
  HtmlCopyRenderer | null
>({
  combine(values) {
    return values.length > 0 ? values[values.length - 1] : null;
  },
});

function systemClipboard(): Clipboard | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.clipboard;
}

function selectionMarkdown(state: EditorState): string {
  const parts: string[] = [];
  for (const range of state.selection.ranges) {
    if (!range.empty) parts.push(state.sliceDoc(range.from, range.to));
  }
  return parts.join("\n");
}

/** Copy the selected markdown source to the clipboard as plain text. */
export function copySelectionAsMarkdown(view: EditorView): boolean {
  const markdown = selectionMarkdown(view.state);
  if (!markdown) return false;
  const clipboard = systemClipboard();
  if (!clipboard?.writeText) return false;
  clipboard.writeText(markdown).catch((err: unknown) => {
    console.error("[coflat] copy as markdown failed:", err);
  });
  return true;
}

async function writeDualFlavorClipboard(
  markdown: string,
  renderer: HtmlCopyRenderer,
): Promise<void> {
  try {
    const html = await renderer(markdown);
    const clipboard = systemClipboard();
    if (clipboard?.write && typeof ClipboardItem !== "undefined") {
      // Dual-flavor ClipboardItem (Zettlr util/copy-paste-cut.ts:96-103):
      // rich targets read text/html, plain targets keep the markdown source.
      await clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([markdown], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
    } else if (clipboard?.writeText) {
      await clipboard.writeText(markdown);
    }
  } catch (err) {
    console.error("[coflat] copy as HTML failed:", err);
  }
}

/**
 * Copy the selection as rendered HTML with a markdown plain-text fallback.
 * Returns false (feature off) until a host provides {@link htmlCopyRendererFacet}.
 */
export function copySelectionAsHtml(view: EditorView): boolean {
  const renderer = view.state.facet(htmlCopyRendererFacet);
  if (!renderer) return false;
  const markdown = selectionMarkdown(view.state);
  if (!markdown) return false;
  void writeDualFlavorClipboard(markdown, renderer);
  return true;
}

/**
 * Paste the clipboard's plain-text flavor verbatim, bypassing the
 * HTML→Markdown conversion.
 *
 * Prefers the async clipboard API (Zettlr util/copy-paste-cut.ts:167-175).
 * Where that is unavailable it marks the next paste event as plain-intent and
 * returns false so the browser's native paste fires and CM6's default handler
 * inserts the text/plain flavor.
 */
export function pastePlainText(view: EditorView): boolean {
  const clipboard = systemClipboard();
  if (clipboard?.readText) {
    clipboard
      .readText()
      .then((text) => {
        if (!text || !view.dom.isConnected) return;
        view.dispatch(view.state.replaceSelection(text), {
          scrollIntoView: true,
          userEvent: "input.paste",
        });
      })
      .catch((err: unknown) => {
        console.error("[coflat] paste as plain text failed:", err);
      });
    return true;
  }
  plainPasteIntentAt.set(view, Date.now());
  return false;
}

/** Palette commands for the clipboard features in this module. */
export function createRichPasteCommands(): Command[] {
  return [
    {
      id: "copy-as-markdown",
      label: "Copy as Markdown",
      description: "Copy the selection as raw Markdown source",
      keywords: ["copy", "clipboard", "markdown"],
      run: ({ view }) => copySelectionAsMarkdown(view),
      isEnabled: ({ view }) => !view.state.selection.main.empty,
    },
    {
      id: "copy-as-html",
      label: "Copy as HTML",
      description: "Copy the selection as rendered HTML with a Markdown fallback",
      keywords: ["copy", "clipboard", "html"],
      run: ({ view }) => copySelectionAsHtml(view),
      isEnabled: ({ view }) =>
        view.state.facet(htmlCopyRendererFacet) !== null
        && !view.state.selection.main.empty,
    },
    {
      id: "paste-as-plain-text",
      label: "Paste as Plain Text",
      description: "Paste the clipboard text verbatim, skipping HTML conversion",
      keywords: ["paste", "plain", "clipboard", "verbatim"],
      key: "Mod-Shift-v",
      run: ({ view }) => pastePlainText(view),
    },
  ];
}

/**
 * Rich-paste extension bundle: the paste handler plus the Mod-Shift-v
 * paste-plain keybinding.
 */
export function richPasteExtension(): Extension {
  return [
    EditorView.domEventHandlers({ paste: handleRichPaste }),
    Prec.high(keymap.of([{ key: "Mod-Shift-v", run: pastePlainText }])),
  ];
}
