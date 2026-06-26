/**
 * CM6 bibliography section renderer.
 *
 * Renders a "References" section at the end of the document listing all cited
 * entries. Implemented as a CM6 StateField so it can use a block widget at
 * document end without inheriting the final line's styles.
 */
import { type EditorState, type Extension, type Transaction } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";

import {
  buildCitationBacklinkAriaLabel,
  buildCitationBacklinkContextFromDoc,
} from "../citations/bibliography-backlinks";
import { formatBibEntry, sortBibEntries } from "../citations/bibliography";
import {
  type CitationBacklink,
  collectCitationBacklinksFromAnalysis,
  collectCitationBacklinksFromTokens,
  collectCitationClusters,
  collectCitationMatchesFromAnalysis,
  collectCitedIdsFromReferenceIndex,
  collectCitedIdsFromClusters,
  createReferenceIndexLocalTargetLookup,
  getAnalysisCitationBacklinkKey,
  getAnalysisCitationRegistrationKey,
  getCitationRegistrationKey,
  type CitationReferenceToken,
} from "../citations/citation-matching";
import type { CitationFormatter } from "../../core/document-context-types";
import { type CslJsonItem } from "../../core/citations/csl-json";
import {
  appendBibliographyBacklinks,
  bibliographyListElement,
  createBibliographyEntryElement,
  createBibliographySectionElement,
} from "../../core/bibliography-surface";
import { CSS } from "../../core/constants/css-classes";
import { sanitizeCslHtml } from "../lib/sanitize-csl-html";
import { type BibStore, bibDataEffect, bibDataField } from "../state/bib-data";
import {
  documentAnalysisField,
} from "../state/document-analysis";
import type { FootnoteSemantics } from "../semantics/document";
import { scanReferenceTokens } from "../lib/reference-tokens";
import { mathMacrosField } from "../state/math-macros";
import { HOVER_DELAY_MS } from "../../core/constants";
import { createPreviewSurfaceBody } from "../../core/preview-surface";
import { renderPreviewBlockContentToDom } from "./preview-block-renderer";
import { buildPreviewBlockOptions } from "./hover-preview-block-options";
import {
  createHoverPreviewContent,
  createHoverPreviewHeader,
} from "./hover-preview-elements";
import {
  floatingTooltipContains,
  hideFloatingTooltip,
  showFloatingTooltip,
  type TooltipPlan,
} from "./hover-tooltip";
import { EMPTY_LOCAL_MEDIA_DEPENDENCIES } from "./media-preview";
import { buildDecorations, createDecorationsField, RenderWidget } from "./render-core";

/** Widget that renders the full bibliography section. */
export class BibliographyWidget extends RenderWidget {
  private readonly domEventHandlers = new WeakMap<HTMLElement, {
    mouseDown: (event: MouseEvent) => void;
    mouseOver: (event: MouseEvent) => void;
    mouseOut: (event: MouseEvent) => void;
    focusIn: (event: FocusEvent) => void;
    focusOut: (event: FocusEvent) => void;
    destroy: () => void;
  }>();

  constructor(
    private readonly entries: readonly CslJsonItem[],
    private readonly cslHtml: readonly string[],
    private readonly backlinks: ReadonlyMap<string, readonly CitationBacklink[]>,
  ) {
    super();
  }

  createDOM(): HTMLElement {
    const section = createBibliographySectionElement(document);
    const list = bibliographyListElement(section);

    if (this.cslHtml.length > 0) {
      // Use CSL-formatted entries (already include [1] numbering for IEEE).
      for (let i = 0; i < this.cslHtml.length; i++) {
        const entry = this.entries[i];
        const div = createBibliographyEntryElement(document, entry.id);
        div.innerHTML = sanitizeCslHtml(this.cslHtml[i]);
        appendBacklinks(div, entry.id, this.backlinks);
        list.appendChild(div);
      }
    } else {
      for (let i = 0; i < this.entries.length; i++) {
        const entry = this.entries[i];
        const div = createBibliographyEntryElement(document, entry.id);
        div.textContent = `[${i + 1}] ${formatBibEntry(entry)}`;
        appendBacklinks(div, entry.id, this.backlinks);
        list.appendChild(div);
      }
    }

    return section;
  }

  override toDOM(view?: EditorView): HTMLElement {
    const section = this.createDOM();
    if (!view) return section;
    let hoverTimer: ReturnType<typeof setTimeout> | null = null;
    let currentPreviewLink: HTMLElement | null = null;

    const clearHoverTimer = (): void => {
      if (hoverTimer === null) return;
      clearTimeout(hoverTimer);
      hoverTimer = null;
    };

    const refreshBacklinkContext = (link: HTMLElement): void => {
      const from = Number(link.dataset.sourceFrom ?? "-1");
      if (from < 0) return;
      const context = buildCitationBacklinkContextFromDoc(view.state.doc, { from });
      link.setAttribute("aria-label", buildCitationBacklinkAriaLabel(context));
    };

    const getBacklink = (target: EventTarget | null): HTMLElement | null => {
      const origin = target instanceof Element
        ? target
        : target instanceof Node
          ? target.parentElement
          : null;
      const link = origin?.closest<HTMLElement>(`.${CSS.bibliographyBacklink}`);
      return link && section.contains(link) ? link : null;
    };

    const showBacklinkPreview = (link: HTMLElement, delay: number): void => {
      refreshBacklinkContext(link);
      clearHoverTimer();
      currentPreviewLink = link;
      hoverTimer = setTimeout(() => {
        if (!link.isConnected || currentPreviewLink !== link) return;
        const plan = buildCitationBacklinkTooltipPlan(view, link);
        if (!plan) return;
        showFloatingTooltip(link, plan);
      }, delay);
    };

    const hideBacklinkPreview = (): void => {
      clearHoverTimer();
      currentPreviewLink = null;
      hideFloatingTooltip();
    };

    const handleMouseDown = (event: MouseEvent): void => {
      const link = getBacklink(event.target);
      if (!link) return;
      const from = Number(link.dataset.sourceFrom ?? "-1");
      event.preventDefault();
      if (from < 0) return;
      view.focus();
      view.dispatch({
        selection: { anchor: from },
        scrollIntoView: true,
      });
    };

    const handleMouseOver = (event: MouseEvent): void => {
      const link = getBacklink(event.target);
      if (!link) return;
      if (link === currentPreviewLink) return;
      showBacklinkPreview(link, HOVER_DELAY_MS);
    };

    const handleMouseOut = (event: MouseEvent): void => {
      const relatedTarget = event.relatedTarget;
      if (floatingTooltipContains(relatedTarget)) return;
      if (getBacklink(relatedTarget)) return;
      hideBacklinkPreview();
    };

    const handleFocusIn = (event: FocusEvent): void => {
      const link = getBacklink(event.target);
      if (!link) return;
      showBacklinkPreview(link, 0);
    };

    const handleFocusOut = (event: FocusEvent): void => {
      const relatedTarget = event.relatedTarget;
      if (floatingTooltipContains(relatedTarget)) return;
      if (getBacklink(relatedTarget)) return;
      hideBacklinkPreview();
    };

    section.querySelectorAll<HTMLElement>(`.${CSS.bibliographyBacklink}`)
      .forEach((link) => refreshBacklinkContext(link));

    this.domEventHandlers.set(section, {
      mouseDown: handleMouseDown,
      mouseOver: handleMouseOver,
      mouseOut: handleMouseOut,
      focusIn: handleFocusIn,
      focusOut: handleFocusOut,
      destroy: hideBacklinkPreview,
    });
    section.addEventListener("mousedown", handleMouseDown);
    section.addEventListener("mouseover", handleMouseOver);
    section.addEventListener("mouseout", handleMouseOut);
    section.addEventListener("focusin", handleFocusIn);
    section.addEventListener("focusout", handleFocusOut);
    return section;
  }

  override destroy(dom: HTMLElement): void {
    const handlers = this.domEventHandlers.get(dom);
    if (!handlers) return;
    dom.removeEventListener("mousedown", handlers.mouseDown);
    dom.removeEventListener("mouseover", handlers.mouseOver);
    dom.removeEventListener("mouseout", handlers.mouseOut);
    dom.removeEventListener("focusin", handlers.focusIn);
    dom.removeEventListener("focusout", handlers.focusOut);
    handlers.destroy();
    this.domEventHandlers.delete(dom);
  }

  eq(other: BibliographyWidget): boolean {
    if (this.entries.length !== other.entries.length) return false;
    if (this.cslHtml.length !== other.cslHtml.length) return false;
    if (!this.entries.every((e, i) => e.id === other.entries[i].id)) return false;
    if (!this.cslHtml.every((html, i) => html === other.cslHtml[i])) return false;
    return this.entries.every((entry) => sameBacklinks(this.backlinks.get(entry.id), other.backlinks.get(entry.id)));
  }
}

function buildCitationBacklinkTooltipPlan(
  view: EditorView,
  link: HTMLElement,
): TooltipPlan | null {
  const from = Number(link.dataset.sourceFrom ?? "-1");
  if (from < 0) return null;

  const position = Math.max(0, Math.min(from, view.state.doc.length));
  const line = view.state.doc.lineAt(position);
  const macros = view.state.field(mathMacrosField, false) ?? {};

  return {
    buildContent: () => {
      const container = createHoverPreviewContent();
      container.appendChild(createHoverPreviewHeader(`Line ${line.number}`));

      const body = createPreviewSurfaceBody(CSS.hoverPreviewBody);
      renderPreviewBlockContentToDom(
        body,
        line.text,
        buildPreviewBlockOptions(view, macros),
      );
      container.appendChild(body);
      return container;
    },
    cacheScope: view.state,
    dependsOnBibliography: true,
    dependsOnMacros: true,
    key: `citation-backlink\0${from}\0${line.number}\0${line.text}`,
    mediaDependencies: EMPTY_LOCAL_MEDIA_DEPENDENCIES,
  };
}

function sameBacklinks(
  left: readonly CitationBacklink[] | undefined,
  right: readonly CitationBacklink[] | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((backlink, index) =>
    backlink.occurrence === right[index].occurrence &&
    backlink.from === right[index].from &&
    backlink.to === right[index].to,
  );
}

function appendBacklinks(
  entryEl: HTMLElement,
  id: string,
  backlinks: ReadonlyMap<string, readonly CitationBacklink[]>,
): void {
  const refs = backlinks.get(id);
  if (!refs || refs.length === 0) return;
  appendBibliographyBacklinks(
    entryEl,
    refs.map((backlink) => ({
      occurrence: backlink.occurrence,
      sourceFrom: backlink.from,
    })),
  );
}

export function buildBibliographyDecorations(
  state: EditorState,
  entries: readonly CslJsonItem[],
  cslHtml: readonly string[],
  backlinks: ReadonlyMap<string, readonly CitationBacklink[]>,
): DecorationSet {
  const widget = new BibliographyWidget(entries, cslHtml, backlinks);
  return buildDecorations([
    Decoration.widget({ widget, side: 1, block: true }).range(state.doc.length),
  ]);
}

interface BibliographyCacheEntry {
  readonly citedKey: string;
  readonly cslEntries: readonly { readonly id: string; readonly html: string }[];
  readonly formatterRevision: number;
  readonly store: BibStore;
}

const bibliographyCache = new WeakMap<CitationFormatter, BibliographyCacheEntry>();

function getCitedIdsKey(citedIds: readonly string[]): string {
  return citedIds.join("\0");
}

function footnoteCitationTokens(footnotes: FootnoteSemantics): CitationReferenceToken[] {
  const tokens: CitationReferenceToken[] = [];
  for (const def of footnotes.defs.values()) {
    for (const token of scanReferenceTokens(def.content)) {
      tokens.push({
        id: token.id,
        clusterFrom: def.bodyFrom + token.clusterFrom,
        clusterTo: def.bodyFrom + token.clusterTo,
        clusterIndex: token.clusterIndex,
        locator: token.locator,
      });
    }
  }
  return tokens;
}

function appendUnique<T>(target: T[], values: readonly T[]): void {
  for (const value of values) {
    if (!target.includes(value)) target.push(value);
  }
}

function mergeBacklinks(
  left: ReadonlyMap<string, readonly CitationBacklink[]>,
  right: ReadonlyMap<string, readonly CitationBacklink[]>,
): ReadonlyMap<string, readonly CitationBacklink[]> {
  if (right.size === 0) return left;
  if (left.size === 0) return right;
  const merged = new Map<string, CitationBacklink[]>();
  for (const [id, backlinks] of left) merged.set(id, [...backlinks]);
  for (const [id, backlinks] of right) {
    const bucket = merged.get(id);
    if (!bucket) {
      merged.set(id, [...backlinks]);
      continue;
    }
    const seen = new Set(bucket.map((backlink) => `${backlink.from}:${backlink.to}`));
    for (const backlink of backlinks) {
      const key = `${backlink.from}:${backlink.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      bucket.push(backlink);
    }
  }
  return merged;
}

function getBibliographyDependencyKey(state: EditorState): string {
  const { store } = state.field(bibDataField);
  const analysis = state.field(documentAnalysisField);
  const footnoteTokens = footnoteCitationTokens(analysis.footnotes);
  return [
    getAnalysisCitationRegistrationKey(analysis, store),
    getAnalysisCitationBacklinkKey(analysis, store),
    footnoteTokens.map((token) => `${token.id}\0${token.clusterFrom}\0${token.clusterTo}\0${token.clusterIndex}\0${token.locator ?? ""}`).join("\u0002"),
  ].join("\u0003");
}

export function bibliographyDependenciesChanged(
  beforeState: EditorState,
  afterState: EditorState,
): boolean {
  const beforeBib = beforeState.field(bibDataField);
  const afterBib = afterState.field(bibDataField);
  if (
    beforeBib.store !== afterBib.store ||
    beforeBib.formatter !== afterBib.formatter ||
    beforeBib.formatterRevision !== afterBib.formatterRevision
  ) {
    return true;
  }

  return getBibliographyDependencyKey(beforeState) !== getBibliographyDependencyKey(afterState);
}

export function bibliographyShouldRebuild(tr: Transaction): boolean {
  return (
    tr.effects.some((effect) => effect.is(bibDataEffect)) ||
    bibliographyDependenciesChanged(tr.startState, tr.state)
  );
}

function buildBibliographyDecorationsFromState(state: EditorState): DecorationSet {
  const widget = createBibliographyWidgetFromState(state);
  if (!widget) return Decoration.none;
  return buildDecorations([
    Decoration.widget({ widget, side: 1, block: true }).range(state.doc.length),
  ]);
}

export function createBibliographyWidgetFromState(state: EditorState): BibliographyWidget | null {
  const { store, formatter, formatterRevision } = state.field(bibDataField);
  if (store.size === 0) return null;

  // Use the incrementally-maintained document analysis instead of
  // re-parsing the entire document from scratch (#514).
  const analysis = state.field(documentAnalysisField);
  const footnoteTokens = footnoteCitationTokens(analysis.footnotes);
  const citedIds = collectCitedIdsFromReferenceIndex(analysis.referenceIndex, store);
  appendUnique(citedIds, collectCitedIdsFromClusters(collectCitationClusters(footnoteTokens, store, {
    isLocalTarget: createReferenceIndexLocalTargetLookup(analysis.referenceIndex),
  })));
  if (citedIds.length === 0) return null;
  const backlinks = mergeBacklinks(
    collectCitationBacklinksFromAnalysis(analysis, store),
    collectCitationBacklinksFromTokens(footnoteTokens, store, {
      isLocalTarget: createReferenceIndexLocalTargetLookup(analysis.referenceIndex),
    }),
  );

  let cslEntries: readonly { readonly id: string; readonly html: string }[] = [];
  if (formatter) {
    const citedKey = getCitedIdsKey(citedIds);
    const cached = bibliographyCache.get(formatter);
    if (
      !cached ||
      cached.citedKey !== citedKey ||
      cached.formatterRevision !== formatterRevision ||
      cached.store !== store
    ) {
      // Inline registration: avoid pulling the citation-registration module
      // (which transitively reaches CslProcessor) from the main bundle.
      const matches = collectCitationMatchesFromAnalysis(analysis, store);
      const registrationKey = getCitationRegistrationKey(matches);
      if (formatter.citationRegistrationKey !== registrationKey) {
        formatter.registerCitations(matches);
      }
      cslEntries = formatter.bibliographyEntries(citedIds);
      bibliographyCache.set(formatter, {
        citedKey,
        cslEntries,
        formatterRevision,
        store,
      });
    } else {
      cslEntries = cached.cslEntries;
    }
  }

  const cslRows = cslEntries
    .map((entry) => ({ entry: store.get(entry.id), html: entry.html }))
    .filter((row): row is { readonly entry: CslJsonItem; readonly html: string } => row.entry !== undefined);
  const cslHtml = cslRows.map((row) => row.html);
  const entries = cslRows.length > 0
    ? cslRows.map((row) => row.entry)
    : sortBibEntries(
        citedIds.map((id) => store.get(id)).filter((e): e is CslJsonItem => e !== undefined),
      );

  return new BibliographyWidget(entries, cslHtml, backlinks);
}

/** CM6 extension that renders a bibliography section at the end of the document. */
export const bibliographyPlugin: Extension = createDecorationsField(
  buildBibliographyDecorationsFromState,
  bibliographyShouldRebuild,
  true,
);
