import "katex/dist/katex.min.css";
import "../../../src/editor/editor-theme.css";
import { EditorView } from "@codemirror/view";
import { mountEditor, type EditorMode } from "../../../editor";
import { buildReferenceCatalog } from "../../../parse";
import {
  hydrateMath,
  hydrateMedia,
  hydrateReaderDisclosures,
  renderToHtml,
} from "../../../reader";
import { mountRichReadonlyDocument } from "../../../rich-readonly";
import { CSS } from "../../../src/core/constants/css-classes";
import { parseFrontmatter } from "../../../src/core/parser";
import { applyThemePreset, themePresets } from "../../../src/editor/theme-config";
import {
  DEFAULT_PARITY_SOURCE,
  PARITY_SOURCE_KEY,
} from "./parity-fixture-data";
import { requiredHTMLElement } from "./utils";

const params = new URLSearchParams(window.location.search);
const presetKey = params.get("preset");
if (presetKey && presetKey in themePresets) {
  applyThemePreset(themePresets[presetKey]);
}
document.body.dataset.surface = params.get("surface") ?? "split";
const requestedMode = params.get("mode");
const editorMode: EditorMode =
  requestedMode === "source" || requestedMode === "rich-readonly" ? requestedMode : "rich";
const readerMode = params.get("reader");

const source = window.localStorage.getItem(PARITY_SOURCE_KEY) ?? DEFAULT_PARITY_SOURCE;

const catalog = buildReferenceCatalog(source);
const frontmatter = parseFrontmatter(source);
const context = {
  mathMacros: frontmatter.config.math ?? {},
  refResolver: {
    resolve(key: string) {
      const target = catalog.uniqueTargetById.get(key);
      if (target) return { content: target.displayLabel, className: CSS.crossref };
      if (key === "karger2000") return { content: "[1]" };
      if (key === "cormen2009") return { content: "[1]" };
      if (key === "external-page") return { content: "External Page" };
      return null;
    },
  },
};

const readerRoot = requiredHTMLElement("reader-root");
const editorRoot = requiredHTMLElement("editor-root");

const mountedRichReadonly = readerMode === "rich-readonly"
  ? mountRichReadonlyDocument({
      root: readerRoot,
      source,
      context,
      renderOptions: { sourcePositions: true },
      hydration: { math: false },
    })
  : null;
const readerResult = mountedRichReadonly?.result ?? renderToHtml(source, context, { sourcePositions: true });

if (readerMode !== "rich-readonly") {
  readerRoot.innerHTML = readerResult.html;
  hydrateReaderDisclosures(readerRoot);
  hydrateMedia(readerRoot);
}

for (const textSpan of Array.from(readerRoot.querySelectorAll("span.cf-text"))) {
  textSpan.replaceWith(document.createTextNode(textSpan.textContent ?? ""));
}
await mountedRichReadonly?.ready;
await hydrateMath(readerRoot, { mathMacros: context.mathMacros });

const mounted = mountEditor({
  parent: editorRoot,
  doc: source,
  mode: editorMode,
  context,
});
const editorView = EditorView.findFromDOM(editorRoot.querySelector(".cm-editor") ?? editorRoot);

(window as unknown as {
  __coflatEditor: typeof mounted;
  __coflatEditorView: EditorView | null;
  __coflatScrollEditorToPosition: (from: number) => void;
}).__coflatEditor = mounted;
(window as unknown as {
  __coflatEditorView: EditorView | null;
}).__coflatEditorView = editorView;
(window as unknown as {
  __coflatScrollEditorToPosition: (from: number) => void;
}).__coflatScrollEditorToPosition = (from: number) => {
  editorView?.dispatch({
    effects: EditorView.scrollIntoView(from, { y: "center" }),
  });
};
