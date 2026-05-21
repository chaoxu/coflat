/**
 * Public theme contract for hosts that manage Coflat themes outside this
 * package.
 *
 * Coflat owns stable surface classes and CSS custom-property names. Hosts own
 * discovery, persistence, user selection, loading remote/local CSS, and any UI
 * for switching themes.
 */

export type CoflatThemeTarget = "reader" | "editor";

export interface CoflatThemeManifest {
  /** Stable host-facing id, for example "blueprint-book" or "lab-dark". */
  id: string;
  /** Human-readable label for menus owned by the host. */
  name: string;
  /** Optional version for host-side cache invalidation or marketplace metadata. */
  version?: string;
  /** Which Coflat surfaces this theme is intended to style. */
  targets: readonly CoflatThemeTarget[];
  /**
   * CSS module/specifier/URL that the host should load before applying the
   * theme. Coflat does not load these automatically.
   */
  css?: readonly string[];
  /** Class to place on the scoped theme root. */
  rootClass?: string;
  /** Optional data attribute value to place on the scoped theme root. */
  dataTheme?: string;
  /**
   * Inline variables the host may set on the scoped theme root. Useful for
   * user-authored token themes that do not need a full CSS file.
   */
  variables?: Partial<Record<string, string>>;
}

export const COFLAT_THEME_SCOPE_CLASS = "cf-theme-scope";
export const COFLAT_READER_CLASS = "cf-reader";
export const COFLAT_READER_SHELL_CLASS = "cf-reader-shell";
export const COFLAT_READER_TOC_CLASS = "cf-reader-toc";
export const COFLAT_READER_DOCUMENT_CLASS = "cf-reader-document";

export const blueprintBookThemeManifest = {
  id: "blueprint-book",
  name: "Blueprint Book",
  version: "0.1.0",
  targets: ["reader", "editor"],
  css: ["@chaoxu/coflat-editor/themes/blueprint-book.css"],
  rootClass: "cf-theme-blueprint-book",
  dataTheme: "blueprint-book",
} as const satisfies CoflatThemeManifest;
