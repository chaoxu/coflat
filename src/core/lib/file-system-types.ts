/**
 * Pure type definitions for the filesystem abstraction.
 *
 * Lives in core/ so non-editor consumers (CLI, indexer, server-side
 * renderer) can describe a filesystem without importing CodeMirror. The
 * CM6 Facets that distribute these values to render plugins stay in
 * src/lib/types.ts.
 */

/** File entry representing a single file or directory in the tree. */
export interface FileEntry {
  /** File name (without path). */
  name: string;
  /** Full path from the project root. */
  path: string;
  /** Whether this entry is a directory. */
  isDirectory: boolean;
  /** Child entries (only populated for directories). */
  children?: FileEntry[];
}

export interface ConditionalWriteResult {
  written: boolean;
  missing?: boolean;
  currentContent?: string;
}

/**
 * Plain-data block counter entry for cross-reference resolution.
 *
 * Mirrors `NumberedBlock` from the CM6 block-counter state field but without
 * position data — only the fields needed for label formatting. Lives here so
 * that preview and editor render layers can share the type without crossing
 * app/editor boundaries.
 */
export interface BlockCounterEntry {
  /** The plugin class name (e.g. "theorem"). */
  readonly type: string;
  /** Display title for the block type (e.g. "Theorem"). */
  readonly title: string;
  /** The assigned number. */
  readonly number: number;
}

/** Abstract filesystem interface for different backends. */
export interface FileSystem {
  /** List all files/directories as a tree starting from root. */
  listTree(): Promise<FileEntry>;
  /**
   * List the direct children of a single directory (non-recursive).
   *
   * Directory entries are returned with `children` undefined (not yet loaded).
   * When absent, callers should fall back to `listTree()`.
   */
  listChildren?(path: string): Promise<FileEntry[]>;
  /** Read the content of a file at the given path. */
  readFile(path: string): Promise<string>;
  /** Write content to a file at the given path. */
  writeFile(path: string, content: string): Promise<void>;
  /**
   * Write text only when the current disk content still matches the expected
   * baseline hash. Implementations that cannot provide a conditional write may
   * omit this method; callers must then use a less strict fallback.
   */
  writeFileIfUnchanged?(
    path: string,
    content: string,
    expectedHash: string,
  ): Promise<ConditionalWriteResult>;
  /** Create a new file with optional initial content. */
  createFile(path: string, content?: string): Promise<void>;
  /** Check whether a file exists at the given path. */
  exists(path: string): Promise<boolean>;
  /** Rename a file from oldPath to newPath. */
  renameFile(oldPath: string, newPath: string): Promise<void>;
  /** Create a new directory at the given path. */
  createDirectory(path: string): Promise<void>;
  /** Delete a file at the given path. */
  deleteFile(path: string): Promise<void>;
  /**
   * Write binary data to a file at the given path.
   * Creates parent directories if needed. Overwrites if the file exists.
   *
   * @param path    Relative path within the project.
   * @param data    Binary data as a Uint8Array.
   */
  writeFileBinary(path: string, data: Uint8Array): Promise<void>;
  /**
   * Read binary data from a file at the given path.
   *
   * @param path    Relative path within the project.
   * @returns       The file contents as a Uint8Array.
   */
  readFileBinary(path: string): Promise<Uint8Array>;
  /**
   * Produce a URL the editor and reader emit into the DOM for asset
   * references (e.g. `<img src="...">`). Hosts can return CDN URLs,
   * blob URLs, or signed/auth'd URLs without coflat needing to know.
   * Receives the same workspace-relative path that appears in the
   * source — e.g. `![alt](images/foo.png)` calls `resolveAssetUrl("images/foo.png")`.
   *
   * @param path    Workspace-relative path as written in the source.
   * @returns       URL string to use as the resource's src.
   */
  resolveAssetUrl(path: string): string | Promise<string>;
}
