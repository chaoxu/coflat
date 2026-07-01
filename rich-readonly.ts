/**
 * `@chaoxu/coflat/rich-readonly` — fast document-first workbench surface.
 *
 * This entrypoint is intentionally reader-first: it mounts the shared Coflat
 * document surface without importing CodeMirror, React, autocomplete, pdfjs, or
 * citation-js. Hosts can dynamically upgrade to the editor afterward.
 */

import type {
  MountEditorOptions,
  MountedEditor,
} from "./editor";
import {
  COFLAT_READER_CLASS,
  type DocumentContext,
  type HydrateMathOptions,
  type HydrateReferencesOptions,
  hydrateMath,
  hydrateMedia,
  hydrateReaderDisclosures,
  hydrateReaderHoverPreviews,
  hydrateReferences,
  type ReaderHoverPreviewOptions,
  type ReaderHtmlResult,
  renderToHtml,
} from "./reader";
import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "./src/core/document-surface-classes";

export type RichReadonlyLifecyclePhase =
  | "first-document-pixels"
  | "rich-readonly-ready"
  | "outline-ready"
  | "citations-ready"
  | "math-ready"
  | "editor-ready";

export interface RichReadonlyLifecycleEvent {
  readonly phase: RichReadonlyLifecyclePhase;
  readonly time: number;
  readonly root: HTMLElement;
  readonly result?: ReaderHtmlResult;
}

export type RichReadonlyLifecycleCallback = (event: RichReadonlyLifecycleEvent) => void;

export interface RichReadonlyHydrationOptions {
  /**
   * Attach semantic block and section disclosure controls. Defaults to true.
   */
  readonly disclosures?: boolean;
  /**
   * Sync rendered image dimensions. Defaults to true.
   */
  readonly media?: boolean;
  /**
   * Resolve host-backed links and references. Defaults to true when `context`
   * is supplied.
   */
  readonly references?: boolean;
  /**
   * Hydrate KaTeX placeholders. Defaults to true when the render result reports
   * math. KaTeX remains a dynamic import.
   */
  readonly math?: boolean;
  /**
   * Attach lazy hover previews. Defaults to false.
   */
  readonly hoverPreviews?: boolean | ReaderHoverPreviewOptions;
}

export interface FastRichReadonlyRenderOptions {
  readonly documentPath?: string;
  readonly outline?: boolean;
  readonly referencePreviews?: boolean;
  readonly resolveReferences?: boolean;
  readonly sectionNumbering?: boolean;
  readonly sourceLineAttribution?: boolean;
  readonly sourcePositions?: boolean;
}

export interface MountRichReadonlyDocumentOptions {
  readonly root: HTMLElement;
  readonly source: string;
  readonly context?: DocumentContext;
  readonly renderOptions?: FastRichReadonlyRenderOptions;
  readonly hydration?: RichReadonlyHydrationOptions;
  readonly onLifecycle?: RichReadonlyLifecycleCallback;
}

export interface HydrateRichReadonlyDocumentOptions {
  readonly root: HTMLElement;
  readonly source?: string;
  readonly context?: DocumentContext;
  readonly result?: ReaderHtmlResult;
  readonly hydration?: RichReadonlyHydrationOptions;
  readonly documentPath?: string;
  readonly onLifecycle?: RichReadonlyLifecycleCallback;
}

export interface MountedRichReadonlyDocument {
  readonly root: HTMLElement;
  readonly result: ReaderHtmlResult;
  readonly ready: Promise<void>;
  readonly dispose: () => void;
  upgradeToEditor(options?: UpgradeRichReadonlyToEditorOptions): Promise<MountedEditor>;
}

export type UpgradeRichReadonlyToEditorOptions =
  Omit<MountEditorOptions, "parent" | "doc" | "context"> &
  Partial<Pick<MountEditorOptions, "parent" | "doc" | "context">> & {
    readonly onLifecycle?: RichReadonlyLifecycleCallback;
  };

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function emitLifecycle(
  callback: RichReadonlyLifecycleCallback | undefined,
  phase: RichReadonlyLifecyclePhase,
  root: HTMLElement,
  result?: ReaderHtmlResult,
): void {
  callback?.({ phase, time: now(), root, result });
}

function afterPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== "function") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function ensureDocumentSurfaceClasses(root: HTMLElement): void {
  root.className = documentSurfaceClassNames(
    root.className,
    COFLAT_READER_CLASS,
    DOCUMENT_SURFACE_CLASS.surface,
    DOCUMENT_SURFACE_CLASS.flow,
  );
}

function shouldHydrate(
  options: RichReadonlyHydrationOptions | undefined,
  key: keyof RichReadonlyHydrationOptions,
  defaultValue: boolean,
): boolean {
  const value = options?.[key];
  return typeof value === "boolean" ? value : defaultValue;
}

export function renderFastRichReadonlyHtml(
  source: string,
  context?: DocumentContext,
  options: FastRichReadonlyRenderOptions = {},
): ReaderHtmlResult {
  return renderToHtml(source, context, options);
}

export function mountRichReadonlyDocument(
  options: MountRichReadonlyDocumentOptions,
): MountedRichReadonlyDocument {
  const result = renderFastRichReadonlyHtml(
    options.source,
    options.context,
    options.renderOptions,
  );

  ensureDocumentSurfaceClasses(options.root);
  options.root.innerHTML = result.html;

  let disposed = false;
  let cleanupHydration: (() => void) | null = null;
  const dispose = () => {
    disposed = true;
    cleanupHydration?.();
    cleanupHydration = null;
    options.root.replaceChildren();
  };

  const ready = hydrateRichReadonlyDocumentWithCleanup({
    root: options.root,
    source: options.source,
    context: options.context,
    result,
    hydration: options.hydration,
    documentPath: options.renderOptions?.documentPath,
    onLifecycle: options.onLifecycle,
  }).then((cleanup) => {
    if (disposed) {
      cleanup();
      return;
    }
    cleanupHydration = cleanup;
  });

  return {
    root: options.root,
    result,
    ready,
    dispose,
    upgradeToEditor(upgradeOptions = {}) {
      dispose();
      return upgradeRichReadonlyToEditor(options.root, {
        ...upgradeOptions,
        doc: upgradeOptions.doc ?? options.source,
        context: upgradeOptions.context ?? options.context,
        onLifecycle: upgradeOptions.onLifecycle ?? options.onLifecycle,
      });
    },
  };
}

export async function hydrateRichReadonlyDocument(
  options: HydrateRichReadonlyDocumentOptions,
): Promise<void> {
  await hydrateRichReadonlyDocumentWithCleanup(options);
}

async function hydrateRichReadonlyDocumentWithCleanup(
  options: HydrateRichReadonlyDocumentOptions,
): Promise<() => void> {
  const cleanups: Array<() => void> = [];
  const hydration = options.hydration;
  ensureDocumentSurfaceClasses(options.root);
  await afterPaint();
  emitLifecycle(options.onLifecycle, "first-document-pixels", options.root, options.result);

  if (shouldHydrate(hydration, "disclosures", true)) {
    hydrateReaderDisclosures(options.root);
  }

  if (shouldHydrate(hydration, "media", true)) {
    hydrateMedia(options.root);
  }

  const hydrateRefs = shouldHydrate(hydration, "references", Boolean(options.context));
  if (hydrateRefs && options.context) {
    hydrateReferences(options.root, options.context, {
      documentPath: options.documentPath,
      source: options.source,
    } satisfies HydrateReferencesOptions);
    if (
      options.context.citationFormatter ||
      options.root.querySelector(".cf-citation, .cf-citation-unresolved")
    ) {
      emitLifecycle(options.onLifecycle, "citations-ready", options.root, options.result);
    }
  }

  if (options.result?.outline) {
    emitLifecycle(options.onLifecycle, "outline-ready", options.root, options.result);
  }

  const hoverPreviews = hydration?.hoverPreviews;
  if (hoverPreviews) {
    const hoverOptions = typeof hoverPreviews === "object" ? hoverPreviews : {};
    cleanups.push(hydrateReaderHoverPreviews(options.root, {
      context: options.context,
      mathMacros: options.result?.mathMacros ?? options.context?.mathMacros,
      referencePreviewIndex: options.result?.referencePreviewIndex,
      source: options.source,
      ...hoverOptions,
    }));
  }

  const hydrateMathEnabled = shouldHydrate(hydration, "math", Boolean(options.result?.hasMath));
  if (hydrateMathEnabled) {
    const mathOptions: HydrateMathOptions | undefined =
      options.result?.mathMacros || options.context?.mathMacros
        ? { mathMacros: { ...options.result?.mathMacros, ...options.context?.mathMacros } }
        : undefined;
    await hydrateMath(options.root, mathOptions);
    emitLifecycle(options.onLifecycle, "math-ready", options.root, options.result);
  }

  emitLifecycle(options.onLifecycle, "rich-readonly-ready", options.root, options.result);
  return () => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  };
}

export async function upgradeRichReadonlyToEditor(
  root: HTMLElement,
  options: UpgradeRichReadonlyToEditorOptions = {},
): Promise<MountedEditor> {
  const editorModule = await import("./editor");
  const parent = options.parent ?? root;
  const mounted = editorModule.mountEditor({
    ...options,
    parent,
    doc: options.doc ?? "",
    context: options.context,
    mode: options.mode ?? "rich-readonly",
  });
  emitLifecycle(options.onLifecycle, "editor-ready", parent);
  return mounted;
}

export type {
  DocumentContext,
  ReaderHtmlResult,
};
