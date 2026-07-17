import { useEffect, useMemo, useState } from "react";
import type { BibStore, CslJsonItem } from "../../core/citations/csl-json";
import type { FrontmatterConfig } from "../../core/parser/frontmatter";
import type { DocumentAnalysis } from "../semantics/document";
import { analyzeMarkdownSemantics } from "../semantics/markdown-analysis";
import { buildCitationBacklinkMap } from "./bibliography";
import {
  type CitationBacklink,
  type CitationCollectionOptions,
  type CitationReferenceToken,
  collectCitationBacklinksFromAnalysis,
  collectCitationBacklinksFromTokens,
  collectCitationClusters,
  collectCitationMatchesFromAnalysis,
  collectCitedIdsFromClusters,
  createReferenceIndexLocalTargetLookup,
  getCitationRegistrationKey,
} from "./citation-matching";
import type { BibliographyStatus } from "../state/bib-data";
import { CslProcessor } from "./csl-processor";

export interface CitationTextResourceResolver {
  readonly readProjectTextFile: (path: string) => Promise<string | null>;
}

export interface CitationRenderData {
  readonly backlinks: ReadonlyMap<string, readonly CitationBacklink[]>;
  readonly citedIds: readonly string[];
  readonly cslProcessor?: CslProcessor;
  readonly rawStore?: BibStore;
  readonly store: BibStore;
}

export interface LoadedBibliography {
  readonly cslProcessor?: CslProcessor;
  readonly store: BibStore;
  /** Load/parse status for hosts that surface bibliography diagnostics. */
  readonly status?: BibliographyStatus;
}

const EMPTY_STORE: BibStore = new Map<string, CslJsonItem>();

// Lazy import keeps citation-js (pulled in transitively via the BibTeX
// parser) out of the main bundle, matching the old parseBibTeX path.
async function parseBibliographyLazy(
  content: string,
  path: string,
): Promise<import("../../core/citations/bibliography-parser").BibliographyParseResult> {
  const { parseBibliography } = await import("../../core/citations/bibliography-parser");
  return parseBibliography(content, { path });
}

export const EMPTY_BIBLIOGRAPHY: LoadedBibliography = {
  store: EMPTY_STORE,
  status: { state: "idle" },
};

export const EMPTY_CITATIONS: CitationRenderData = {
  backlinks: new Map(),
  citedIds: [],
  rawStore: EMPTY_STORE,
  store: EMPTY_STORE,
};

function filterCitationStore(
  store: BibStore,
  options?: CitationCollectionOptions,
): BibStore {
  if (!options?.isLocalTarget) return store;
  const filtered = new Map<string, CslJsonItem>();
  for (const [id, item] of store) {
    if (!options.isLocalTarget(id)) {
      filtered.set(id, item);
    }
  }
  return filtered;
}

export async function loadBibliographyResource(
  config: FrontmatterConfig,
  resolver: CitationTextResourceResolver,
): Promise<LoadedBibliography> {
  const bibliographyPath = config.bibliography?.trim();
  if (!bibliographyPath) {
    return EMPTY_BIBLIOGRAPHY;
  }

  const bibText = await resolver.readProjectTextFile(bibliographyPath);
  if (bibText == null) {
    return {
      store: EMPTY_STORE,
      status: {
        state: "error",
        kind: "read-bib",
        bibPath: bibliographyPath,
        message: `Could not read bibliography file "${bibliographyPath}"`,
      },
    };
  }

  const parsed = await parseBibliographyLazy(bibText, bibliographyPath);
  if (parsed.error) {
    return {
      store: EMPTY_STORE,
      status: {
        state: "error",
        kind: parsed.format === null ? "detect-format" : "parse-bib",
        bibPath: bibliographyPath,
        message: parsed.error,
      },
    };
  }

  const items = parsed.items;
  const store: BibStore = new Map(items.map((item) => [item.id, item]));
  const cslPath = config.csl?.trim();
  const cslXml = cslPath
    ? await resolver.readProjectTextFile(cslPath) ?? undefined
    : undefined;
  const cslProcessor = items.length > 0
    ? await CslProcessor.create(items, cslXml)
    : undefined;

  let status: BibliographyStatus = parsed.skippedEntries > 0
    ? {
      state: "warning",
      kind: "parse-bib",
      bibPath: bibliographyPath,
      ...(cslPath ? { cslPath } : {}),
      message: `Skipped ${parsed.skippedEntries} invalid bibliography ${parsed.skippedEntries === 1 ? "entry" : "entries"}`,
      entryCount: items.length,
      skippedEntries: parsed.skippedEntries,
    }
    : {
      state: "ok",
      bibPath: bibliographyPath,
      ...(cslPath ? { cslPath } : {}),
      entryCount: items.length,
    };
  const styleStatus = cslProcessor?.styleStatus;
  if (cslPath && cslXml === undefined) {
    status = {
      state: "warning",
      kind: "read-csl",
      bibPath: bibliographyPath,
      cslPath,
      message: `Could not read CSL style "${cslPath}"; using the default style`,
      entryCount: items.length,
    };
  } else if (cslXml !== undefined && styleStatus?.state === "error") {
    status = {
      state: "warning",
      kind: "style-csl",
      bibPath: bibliographyPath,
      cslPath,
      message: styleStatus.message,
      entryCount: items.length,
    };
  }

  return { cslProcessor, store, status };
}

export function buildCitationRenderData(
  doc: string,
  loadedBibliography: LoadedBibliography,
): CitationRenderData {
  return buildCitationRenderDataFromAnalysis(
    analyzeMarkdownSemantics(doc),
    loadedBibliography,
  );
}

export function buildCitationRenderDataFromAnalysis(
  analysis: Pick<DocumentAnalysis, "references" | "referenceIndex">,
  loadedBibliography: LoadedBibliography,
): CitationRenderData {
  if (loadedBibliography.store.size === 0) {
    return EMPTY_CITATIONS;
  }

  const options = {
    isLocalTarget: createReferenceIndexLocalTargetLookup(analysis.referenceIndex),
  };
  const citationStore = filterCitationStore(loadedBibliography.store, options);
  const clusters = collectCitationMatchesFromAnalysis(analysis, loadedBibliography.store);
  const cslProcessor = loadedBibliography.cslProcessor;
  if (
    cslProcessor
    && cslProcessor.citationRegistrationKey !== getCitationRegistrationKey(clusters)
  ) {
    cslProcessor.registerCitations(clusters);
  }

  return {
    backlinks: buildCitationBacklinkMap(
      collectCitationBacklinksFromAnalysis(
        analysis,
        loadedBibliography.store,
      ),
    ),
    citedIds: collectCitedIdsFromClusters(clusters),
    cslProcessor,
    rawStore: loadedBibliography.store,
    store: citationStore,
  };
}

export function buildCitationRenderDataFromReferences(
  references: readonly CitationReferenceToken[],
  loadedBibliography: LoadedBibliography,
  options?: CitationCollectionOptions,
): CitationRenderData {
  if (loadedBibliography.store.size === 0) {
    return EMPTY_CITATIONS;
  }

  const citationStore = filterCitationStore(loadedBibliography.store, options);
  const clusters = collectCitationClusters(references, loadedBibliography.store, options);
  const cslProcessor = loadedBibliography.cslProcessor;
  if (
    cslProcessor
    && cslProcessor.citationRegistrationKey !== getCitationRegistrationKey(clusters)
  ) {
    cslProcessor.registerCitations(clusters);
  }

  return {
    backlinks: buildCitationBacklinkMap(
      collectCitationBacklinksFromTokens(
        references,
        loadedBibliography.store,
        options,
      ),
    ),
    citedIds: collectCitedIdsFromClusters(clusters),
    cslProcessor,
    rawStore: loadedBibliography.store,
    store: citationStore,
  };
}

export function useCitationRenderData(
  doc: string,
  config: FrontmatterConfig,
  resolver: CitationTextResourceResolver,
): CitationRenderData {
  const [loadedBibliography, setLoadedBibliography] = useState<LoadedBibliography>(EMPTY_BIBLIOGRAPHY);

  useEffect(() => {
    let cancelled = false;
    const bibliographyPath = config.bibliography?.trim();

    if (!bibliographyPath) {
      setLoadedBibliography(EMPTY_BIBLIOGRAPHY);
      return () => {
        cancelled = true;
      };
    }

    void loadBibliographyResource(config, resolver)
      .then((nextBibliography) => {
        if (!cancelled) {
          setLoadedBibliography(nextBibliography);
        }
      })
      .catch((error) => {
        console.warn("[bibliography] failed to load bibliography", error);
        if (!cancelled) {
          setLoadedBibliography(EMPTY_BIBLIOGRAPHY);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [config.bibliography, config.csl, resolver.readProjectTextFile]);

  return useMemo(
    () => buildCitationRenderData(doc, loadedBibliography),
    [doc, loadedBibliography],
  );
}
