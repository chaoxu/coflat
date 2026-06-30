import "katex/dist/katex.min.css";
import { type EditorView, type PluginValue, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import "../../src/editor/editor-theme.css";
import { mountEditor } from "../../editor";
import formatDoc from "../../FORMAT.md?raw";
import { buildReferenceCatalog } from "../../parse";
import {
  hydrateMath,
  hydrateMedia,
  hydrateReaderDisclosures,
  hydrateReaderHoverPreviews,
  hydrateReferences,
  renderToHtml,
  type SourcePosition,
  sourceElementAtPosition,
  visibleSourcePositionInScroller,
} from "../../reader";
import { parseBibTeX } from "../../src/core/citations/bibtex-parser";
import type { BibStore } from "../../src/core/citations/csl-json";
import { extractYear, formatCslAuthors } from "../../src/core/citations/csl-json";
import {
  createNumericCitationFormatter,
} from "../../src/core/citations/numeric";
import { CSS } from "../../src/core/constants/css-classes";
import type { DocumentContext, RefResolver } from "../../src/core/document-context-types";
import type { FileEntry, FileSystem } from "../../src/core/lib/file-system-types";
import { fileSystemFacet } from "../../src/editor/lib/types";
import { bibDataEffect } from "../../src/editor/state/bib-data";
import initialDoc from "./showcase.md?raw";
import "./style.css";

const editorRoot = document.querySelector<HTMLElement>("#editor");
const readerViewport = document.querySelector<HTMLElement>("#reader-viewport");
const readerRoot = document.querySelector<HTMLElement>("#reader");
const assetBaseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
const docLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>(".demo-doc-link"));
const surfaceLinks = Array.from(document.querySelectorAll<HTMLButtonElement>(".demo-surface-link"));
const docs = {
  showcase: {
    title: "Coflat Editor Showcase",
    source: initialDoc,
  },
  format: {
    title: "Coflat Format Guide",
    source: formatDoc,
  },
} as const;
type DemoDocId = keyof typeof docs;
type DemoSurfaceId = "editor" | "readonly" | "reader";
let currentDocId: DemoDocId = "showcase";
let currentSurfaceId: DemoSurfaceId = "editor";
let cleanupReaderHover: (() => void) | null = null;
let surfaceSwitchVersion = 0;
const SURFACE_SCROLL_ANCHOR_RATIO = 0.2;
const readerDocCache = new Map<DemoDocId, {
  readonly html: string;
  readonly mathMacros?: Record<string, string>;
}>();

if (!editorRoot || !readerViewport || !readerRoot) {
  throw new Error("Missing simple example roots.");
}
const mountedEditorRoot = editorRoot;
const mountedReaderViewport = readerViewport;
const mountedReaderRoot = readerRoot;

async function fetchPublicFile(path: string): Promise<Response> {
  const candidates = [
    new URL(path, assetBaseUrl),
    new URL(`examples/simple/public/${path}`, window.location.origin),
  ];
  for (const url of candidates) {
    const response = await fetch(url);
    if (response.ok) return response;
  }
  return fetch(candidates[0]);
}

const publicFileSystem: FileSystem = {
  async listTree(): Promise<FileEntry> {
    return { name: "", path: "", isDirectory: true };
  },
  async readFile(path: string): Promise<string> {
    const response = await fetchPublicFile(path);
    if (!response.ok) throw new Error(`Unable to load ${path}`);
    return response.text();
  },
  async readFileBinary(path: string): Promise<Uint8Array> {
    const response = await fetchPublicFile(path);
    if (!response.ok) throw new Error(`Unable to load ${path}`);
    return new Uint8Array(await response.arrayBuffer());
  },
  async writeFile(): Promise<void> {},
  async createFile(): Promise<void> {},
  async exists(path: string): Promise<boolean> {
    return (await fetchPublicFile(path)).ok;
  },
  async renameFile(): Promise<void> {},
  async createDirectory(): Promise<void> {},
  async deleteFile(): Promise<void> {},
  async writeFileBinary(): Promise<void> {},
  resolveAssetUrl(path: string): string {
    return new URL(path, assetBaseUrl).toString();
  },
};

const bibliographyText = await publicFileSystem.readFile("reference.bib");
const bibliographyItems = parseBibTeX(bibliographyText);
const bibliographyStore: BibStore = new Map(bibliographyItems.map((item) => [item.id, item]));
const citationKeys = new Set(bibliographyStore.keys());
const citationFormatter = createNumericCitationFormatter(bibliographyItems);
const referenceCatalogs = new Map<DemoDocId, ReturnType<typeof buildReferenceCatalog>>();

function referenceCatalogForDoc(id: DemoDocId): ReturnType<typeof buildReferenceCatalog> {
  const cached = referenceCatalogs.get(id);
  if (cached) return cached;
  const catalog = buildReferenceCatalog(docs[id].source);
  referenceCatalogs.set(id, catalog);
  return catalog;
}

const demoRefResolver: RefResolver = {
  resolve(key, _mode, env) {
    if (bibliographyStore.has(key)) {
      return {
        className: "cf-citation",
        content: citationFormatter.cite([key], env?.locator ? [env.locator] : []),
      };
    }

    const target = referenceCatalogForDoc(currentDocId).uniqueTargetById.get(key);
    return target
      ? { className: CSS.crossref, content: target.displayLabel }
      : null;
  },
};
const documentContext = {
  fileSystem: publicFileSystem,
  refResolver: demoRefResolver,
  citationFormatter,
  citationKeys,
} satisfies DocumentContext;
const bibliographyBootstrap = ViewPlugin.define((view) => {
  queueMicrotask(() => {
    view.dispatch({
      effects: bibDataEffect.of({
        store: bibliographyStore,
        formatter: citationFormatter,
        status: { state: "ok", bibPath: "reference.bib" },
      }),
    });
  });
  return {};
});
type FullDocumentEditorView = EditorView & {
  viewState?: {
    printing?: boolean;
  };
  measure?: () => void;
};
const fullDocumentViewportPlugin = ViewPlugin.fromClass(class implements PluginValue {
  private destroyed = false;

  constructor(private readonly view: EditorView) {
    this.enable();
  }

  update(_update: ViewUpdate): void {
    this.enable();
  }

  destroy(): void {
    this.destroyed = true;
    const view = this.view as FullDocumentEditorView;
    if (view.viewState) {
      view.viewState.printing = false;
    }
    view.requestMeasure();
  }

  private enable(): void {
    const view = this.view as FullDocumentEditorView;
    if (!view.viewState) return;
    view.viewState.printing = true;
    view.requestMeasure();
    queueMicrotask(() => {
      if (!this.destroyed) {
        view.measure?.();
      }
    });
  }
});

function setCurrentPageAttribute(el: HTMLElement, active: boolean): void {
  if (active) {
    el.setAttribute("aria-current", "page");
  } else {
    el.removeAttribute("aria-current");
  }
}

function demoUrl(docId: DemoDocId, surfaceId: DemoSurfaceId): string {
  return `?doc=${docId}&surface=${surfaceId}`;
}

function updateDocLinkHrefs(): void {
  for (const link of docLinks) {
    const docId = link.dataset.docId ?? null;
    if (isDemoDocId(docId)) {
      link.href = demoUrl(docId, currentSurfaceId);
    }
  }
}

function resetSurfaceScroll(): void {
  mountedReaderViewport.scrollTop = 0;
  const editorScroller = mountedEditorRoot.querySelector<HTMLElement>(".cm-scroller");
  if (editorScroller) editorScroller.scrollTop = 0;
}

function currentSurfaceScrollAnchor(): SourcePosition | null {
  return currentSurfaceId === "reader"
    ? visibleSourcePositionInScroller(mountedReaderViewport, {
      viewportRatio: SURFACE_SCROLL_ANCHOR_RATIO,
    })
    : editor.getVisibleSourcePosition({ viewportRatio: SURFACE_SCROLL_ANCHOR_RATIO });
}

function alignReaderToSourcePosition(position: SourcePosition): boolean {
  const element = sourceElementAtPosition(mountedReaderRoot, position);
  if (!element) return false;
  const viewportRect = mountedReaderViewport.getBoundingClientRect();
  const targetY = typeof position.viewportY === "number" && Number.isFinite(position.viewportY)
    ? position.viewportY
    : viewportRect.top + viewportRect.height * (position.viewportRatio ?? SURFACE_SCROLL_ANCHOR_RATIO);
  mountedReaderViewport.scrollTop += element.getBoundingClientRect().top - targetY;
  return true;
}

function restoreReaderSourcePosition(position: SourcePosition, switchVersion: number): void {
  if (switchVersion !== surfaceSwitchVersion || currentSurfaceId !== "reader") return;
  alignReaderToSourcePosition(position);
  let frames = 0;
  const alignFrame = () => {
    if (switchVersion !== surfaceSwitchVersion || currentSurfaceId !== "reader") return;
    alignReaderToSourcePosition(position);
    frames += 1;
    if (frames < 8) requestAnimationFrame(alignFrame);
  };
  requestAnimationFrame(alignFrame);
}

function restoreSurfaceScroll(anchor: SourcePosition | null, isReader: boolean, switchVersion: number): void {
  if (!anchor) return;
  if (switchVersion !== surfaceSwitchVersion) return;
  if (isReader !== (currentSurfaceId === "reader")) return;
  if (isReader) {
    restoreReaderSourcePosition(anchor, switchVersion);
  } else {
    editor.scrollToSourcePosition({ ...anchor, select: false });
  }
}

function focusEditorForKeyboardInput(): void {
  if (window.matchMedia("(max-width: 760px), (pointer: coarse)").matches) return;
  editor.focus();
}

const editor = mountEditor({
  parent: mountedEditorRoot,
  doc: initialDoc,
  mode: "rich",
  sidenotesCollapsed: true,
  context: documentContext,
  extensions: [
    fullDocumentViewportPlugin,
    fileSystemFacet.of(publicFileSystem),
    bibliographyBootstrap,
  ],
});

function isDemoDocId(value: string | null): value is DemoDocId {
  return value === "showcase" || value === "format";
}

function isDemoSurfaceId(value: string | null): value is DemoSurfaceId {
  return value === "editor" || value === "readonly" || value === "reader";
}

function formatBibliographyPreview(key: string): string | null {
  const item = bibliographyStore.get(key);
  if (!item) return null;
  const authors = formatCslAuthors(item.author);
  const year = extractYear(item);
  return [
    authors,
    item.title,
    item["container-title"],
    item.publisher,
    year,
  ].filter(Boolean).join(". ");
}

function attachReaderBehavior(doc: { readonly source: string }, mathMacros?: Record<string, string>): void {
  hydrateReaderDisclosures(mountedReaderRoot);
  hydrateMedia(mountedReaderRoot);
  hydrateReferences(mountedReaderRoot, documentContext, { source: doc.source });
  cleanupReaderHover = hydrateReaderHoverPreviews(mountedReaderRoot, {
    context: documentContext,
    previewForReference: formatBibliographyPreview,
    source: doc.source,
    // Forward frontmatter macros so custom definitions also render inside
    // equation/heading hover previews, matching the main reader surface.
    mathMacros,
  });
}

function mountPreparedReaderDoc(
  id: DemoDocId,
  prepared: { readonly html: string; readonly mathMacros?: Record<string, string> },
): void {
  const doc = docs[id];
  cleanupReaderHover?.();
  cleanupReaderHover = null;
  mountedReaderRoot.innerHTML = prepared.html;
  attachReaderBehavior(doc, prepared.mathMacros);
}

async function prepareReaderDoc(id: DemoDocId): Promise<{
  readonly html: string;
  readonly mathMacros?: Record<string, string>;
}> {
  const cached = readerDocCache.get(id);
  if (cached) return cached;
  const doc = docs[id];
  const result = renderToHtml(doc.source, documentContext, {
    resolveReferences: true,
    sourcePositions: true,
  });
  const scratchRoot = document.createElement("div");
  scratchRoot.innerHTML = result.html;
  // Forward the document's frontmatter `math:` macros so custom definitions
  // render in the title and body, matching the editor surface.
  await hydrateMath(
    scratchRoot,
    result.mathMacros ? { mathMacros: result.mathMacros } : undefined,
  );
  const prepared = {
    html: scratchRoot.innerHTML,
    mathMacros: result.mathMacros,
  };
  readerDocCache.set(id, prepared);
  return prepared;
}

function setActiveSurface(id: DemoSurfaceId, options: { preserveScroll?: boolean } = {}): void {
  const switchVersion = surfaceSwitchVersion + 1;
  const preserveScroll = options.preserveScroll ?? true;
  const scrollAnchor = preserveScroll ? currentSurfaceScrollAnchor() : null;
  surfaceSwitchVersion = switchVersion;
  currentSurfaceId = id;
  const isReader = id === "reader";
  document.body.dataset.surface = id;
  for (const link of surfaceLinks) {
    setCurrentPageAttribute(link, link.dataset.surfaceId === id);
  }
  updateDocLinkHrefs();
  const url = new URL(window.location.href);
  url.searchParams.set("surface", id);
  window.history.replaceState(null, "", url);
  if (isReader) {
    mountedReaderViewport.hidden = true;
    void prepareReaderDoc(currentDocId).then((prepared) => {
      if (switchVersion !== surfaceSwitchVersion || currentSurfaceId !== "reader") return;
      mountPreparedReaderDoc(currentDocId, prepared);
      mountedEditorRoot.hidden = true;
      mountedReaderViewport.hidden = false;
      if (scrollAnchor) {
        restoreSurfaceScroll(scrollAnchor, true, switchVersion);
      } else {
        resetSurfaceScroll();
      }
    });
  } else {
    mountedEditorRoot.hidden = false;
    mountedReaderViewport.hidden = true;
    editor.setMode(id === "readonly" ? "rich-readonly" : "rich");
    focusEditorForKeyboardInput();
    if (scrollAnchor) {
      restoreSurfaceScroll(scrollAnchor, false, switchVersion);
    } else {
      resetSurfaceScroll();
    }
  }
}

function setActiveDoc(id: DemoDocId): void {
  const switchVersion = surfaceSwitchVersion + 1;
  surfaceSwitchVersion = switchVersion;
  currentDocId = id;
  const doc = docs[id];
  editor.setDoc(doc.source);
  editor.setMode(currentSurfaceId === "readonly" ? "rich-readonly" : "rich");
  document.title = doc.title;
  for (const link of docLinks) {
    const isActive = link.dataset.docId === id;
    setCurrentPageAttribute(link, isActive);
  }
  const url = new URL(window.location.href);
  url.searchParams.set("doc", id);
  window.history.replaceState(null, "", url);
  resetSurfaceScroll();
  if (currentSurfaceId === "reader") {
    mountedReaderViewport.hidden = true;
    void prepareReaderDoc(id).then((prepared) => {
      if (switchVersion !== surfaceSwitchVersion || currentDocId !== id || currentSurfaceId !== "reader") return;
      mountPreparedReaderDoc(id, prepared);
      mountedEditorRoot.hidden = true;
      mountedReaderViewport.hidden = false;
      resetSurfaceScroll();
    });
  } else {
    focusEditorForKeyboardInput();
  }
}

for (const link of docLinks) {
  link.addEventListener("click", (event) => {
    const docId = link.dataset.docId ?? null;
    if (isDemoDocId(docId)) {
      event.preventDefault();
      setActiveDoc(docId);
    }
  });
}

for (const link of surfaceLinks) {
  link.addEventListener("click", () => {
    const surfaceId = link.dataset.surfaceId ?? null;
    if (isDemoSurfaceId(surfaceId)) {
      setActiveSurface(surfaceId);
    }
  });
}

const requestedDoc = new URLSearchParams(window.location.search).get("doc");
if (isDemoDocId(requestedDoc) && requestedDoc !== "showcase") {
  setActiveDoc(requestedDoc);
} else {
  setActiveDoc("showcase");
}

const requestedSurface = new URLSearchParams(window.location.search).get("surface");
setActiveSurface(isDemoSurfaceId(requestedSurface) ? requestedSurface : "editor", {
  preserveScroll: false,
});
