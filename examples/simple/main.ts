import "katex/dist/katex.min.css";
import { ViewPlugin } from "@codemirror/view";
import "../../src/editor/editor-theme.css";
import { mountEditor } from "../../editor";
import {
  hydrateMath,
  hydrateReaderHoverPreviews,
  hydrateReferences,
  renderToHtml,
} from "../../reader";
import {
  createNumericCitationFormatter,
} from "../../src/core/citations/numeric";
import { parseBibTeX } from "../../src/core/citations/bibtex-parser";
import type { BibStore } from "../../src/core/citations/csl-json";
import { extractYear, formatCslAuthors } from "../../src/core/citations/csl-json";
import type { RefResolver } from "../../src/core/document-context-types";
import type { FileEntry, FileSystem } from "../../src/core/lib/file-system-types";
import { fileSystemFacet } from "../../src/editor/lib/types";
import { bibDataEffect } from "../../src/editor/state/bib-data";
import initialDoc from "./showcase.md?raw";
import formatDoc from "../../FORMAT.md?raw";
import "./style.css";

const editorRoot = document.querySelector<HTMLElement>("#editor");
const readerRoot = document.querySelector<HTMLElement>("#reader");
const assetBaseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
const docLinks = Array.from(document.querySelectorAll<HTMLButtonElement>(".demo-doc-link"));
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
type DemoSurfaceId = "editor" | "reader";

if (!editorRoot || !readerRoot) {
  throw new Error("Missing simple example roots.");
}
const mountedEditorRoot = editorRoot;
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
const citationFormatter = createNumericCitationFormatter(bibliographyItems);
const demoRefResolver: RefResolver = {
  resolve(key, _mode, env) {
    if (!bibliographyStore.has(key)) return null;
    return {
      className: "cf-citation",
      content: citationFormatter.cite([key], env?.locator ? [env.locator] : []),
    };
  },
};
const documentContext = {
  refResolver: demoRefResolver,
};
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

function setCurrentPageAttribute(el: HTMLElement, active: boolean): void {
  if (active) {
    el.setAttribute("aria-current", "page");
  } else {
    el.removeAttribute("aria-current");
  }
}

const editor = mountEditor({
  parent: mountedEditorRoot,
  doc: initialDoc,
  mode: "rich",
  context: documentContext,
  extensions: [
    fileSystemFacet.of(publicFileSystem),
    bibliographyBootstrap,
  ],
});

let currentDocId: DemoDocId = "showcase";
let currentSurfaceId: DemoSurfaceId = "editor";
let cleanupReaderHover: (() => void) | null = null;

function isDemoDocId(value: string | null): value is DemoDocId {
  return value === "showcase" || value === "format";
}

function isDemoSurfaceId(value: string | null): value is DemoSurfaceId {
  return value === "editor" || value === "reader";
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

function renderReaderDoc(): void {
  const doc = docs[currentDocId];
  cleanupReaderHover?.();
  const result = renderToHtml(doc.source, documentContext, { sourcePositions: true });
  mountedReaderRoot.innerHTML = result.html;
  hydrateReferences(mountedReaderRoot, documentContext, { source: doc.source });
  void hydrateMath(mountedReaderRoot);
  cleanupReaderHover = hydrateReaderHoverPreviews(mountedReaderRoot, {
    context: documentContext,
    previewForReference: formatBibliographyPreview,
    source: doc.source,
  });
}

function setActiveSurface(id: DemoSurfaceId): void {
  currentSurfaceId = id;
  const isEditor = id === "editor";
  mountedEditorRoot.hidden = !isEditor;
  mountedReaderRoot.hidden = isEditor;
  for (const link of surfaceLinks) {
    setCurrentPageAttribute(link, link.dataset.surfaceId === id);
  }
  const url = new URL(window.location.href);
  url.searchParams.set("surface", id);
  window.history.replaceState(null, "", url);
  if (isEditor) {
    editor.focus();
  } else {
    renderReaderDoc();
  }
}

function setActiveDoc(id: DemoDocId): void {
  currentDocId = id;
  const doc = docs[id];
  editor.setDoc(doc.source);
  editor.setMode("rich");
  document.title = doc.title;
  for (const link of docLinks) {
    const isActive = link.dataset.docId === id;
    setCurrentPageAttribute(link, isActive);
  }
  const url = new URL(window.location.href);
  url.searchParams.set("doc", id);
  window.history.replaceState(null, "", url);
  window.scrollTo({ top: 0, left: 0 });
  if (currentSurfaceId === "reader") {
    renderReaderDoc();
  } else {
    editor.focus();
  }
}

for (const link of docLinks) {
  link.addEventListener("click", () => {
    const docId = link.dataset.docId ?? null;
    if (isDemoDocId(docId)) {
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
setActiveSurface(isDemoSurfaceId(requestedSurface) ? requestedSurface : "editor");
