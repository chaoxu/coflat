import "katex/dist/katex.min.css";
import { ViewPlugin } from "@codemirror/view";
import "../../src/editor/editor-theme.css";
import { mountEditor } from "../../editor";
import {
  createNumericCitationFormatter,
} from "../../src/core/citations/numeric";
import { parseBibTeX } from "../../src/core/citations/bibtex-parser";
import type { BibStore } from "../../src/core/citations/csl-json";
import type { RefResolver } from "../../src/core/document-context-types";
import type { FileEntry, FileSystem } from "../../src/core/lib/file-system-types";
import { fileSystemFacet } from "../../src/editor/lib/types";
import { hoverPreviewExtension } from "../../src/editor/render/hover-preview";
import { bibDataEffect } from "../../src/editor/state/bib-data";
import initialDoc from "./showcase.md?raw";
import "./style.css";

const editorRoot = document.querySelector<HTMLElement>("#editor");
const assetBaseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);

if (!editorRoot) {
  throw new Error("Missing simple example roots.");
}

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

const editor = mountEditor({
  parent: editorRoot,
  doc: initialDoc,
  mode: "rich",
  context: {
    refResolver: demoRefResolver,
  },
  extensions: [
    fileSystemFacet.of(publicFileSystem),
    hoverPreviewExtension,
    bibliographyBootstrap,
  ],
});

editor.focus();
