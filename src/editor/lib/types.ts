/**
 * CM6 Facets that distribute filesystem-related values to render plugins.
 *
 * The pure type definitions live in src/core/lib/file-system-types.ts. This
 * file adds the CM6 Facet machinery that requires @codemirror/state.
 */

import { Facet } from "@codemirror/state";
import type { FileSystem } from "../../core/lib/file-system-types";

/**
 * CM6 Facet that provides a FileSystem instance to render plugins.
 *
 * The app layer provides `fileSystemFacet.of(fs)` when creating the editor.
 * Render plugins (e.g., image-render for PDF preview) read it to perform
 * binary file I/O without importing from the app layer.
 *
 * Pattern follows projectConfigFacet: at most one provider, last wins.
 */
export const fileSystemFacet = Facet.define<FileSystem | null, FileSystem | null>({
  combine(values) {
    // There should be at most one provider. Take the last non-null one.
    for (let i = values.length - 1; i >= 0; i--) {
      if (values[i] !== null) return values[i];
    }
    return null;
  },
});

/**
 * CM6 Facet that provides the current document's project-relative path.
 *
 * Render plugins (e.g., image-render for PDF preview) use it to resolve
 * relative media paths against the document's directory, so that
 * `![](diagram.pdf)` in `posts/math.md` resolves to `posts/diagram.pdf`.
 *
 * Pattern follows fileSystemFacet: at most one provider, last wins.
 * Default is "" (project root), which means relative paths resolve from root.
 */
export const documentPathFacet = Facet.define<string, string>({
  combine(values) {
    for (let i = values.length - 1; i >= 0; i--) {
      if (values[i]) return values[i];
    }
    return "";
  },
});
