import "katex/dist/katex.min.css";
import "../../src/editor/editor-theme.css";
import { mountEditor } from "../../editor";
import type { FileEntry, FileSystem } from "../../src/core/lib/file-system-types";
import { fileSystemFacet } from "../../src/editor/lib/types";
import initialDoc from "./showcase.md?raw";
import "./style.css";

const editorRoot = document.querySelector<HTMLElement>("#editor");
const assetBaseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);

if (!editorRoot) {
  throw new Error("Missing simple example roots.");
}

const publicFileSystem: FileSystem = {
  async listTree(): Promise<FileEntry> {
    return { name: "", path: "", isDirectory: true };
  },
  async readFile(path: string): Promise<string> {
    const response = await fetch(new URL(path, assetBaseUrl));
    if (!response.ok) throw new Error(`Unable to load ${path}`);
    return response.text();
  },
  async readFileBinary(path: string): Promise<Uint8Array> {
    const response = await fetch(new URL(path, assetBaseUrl));
    if (!response.ok) throw new Error(`Unable to load ${path}`);
    return new Uint8Array(await response.arrayBuffer());
  },
  async writeFile(): Promise<void> {},
  async createFile(): Promise<void> {},
  async exists(path: string): Promise<boolean> {
    const response = await fetch(new URL(path, assetBaseUrl), { method: "HEAD" });
    return response.ok;
  },
  async renameFile(): Promise<void> {},
  async createDirectory(): Promise<void> {},
  async deleteFile(): Promise<void> {},
  async writeFileBinary(): Promise<void> {},
  resolveAssetUrl(path: string): string {
    return new URL(path, assetBaseUrl).toString();
  },
};

const editor = mountEditor({
  parent: editorRoot,
  doc: initialDoc,
  mode: "rich",
  extensions: [fileSystemFacet.of(publicFileSystem)],
});

editor.focus();
