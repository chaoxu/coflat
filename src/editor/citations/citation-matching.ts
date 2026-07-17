import {
  type CitationCluster,
  type CitationCollectionOptions,
  type CitationIdLookup,
  type CitationReferenceCluster,
  collectCitationMatches as coreCollectCitationMatches,
  collectCitedIdsFromClusters as coreCollectCitedIdsFromClusters,
  collectCitedIdsFromReferences as coreCollectCitedIdsFromReferences,
  getCitationRegistrationKey as coreGetCitationRegistrationKey,
  isCitationId as coreIsCitationId,
} from "../../core/references/citation-rendering";
import type { ReferenceIndexModel } from "../../core/references/model";
import {
  type NociteKeyLookup,
  resolveNociteIds,
} from "../../core/references/nocite";
import type {
  DocumentAnalysis,
  ReferenceSemantics,
} from "../semantics/document";

export type {
  CitationCluster,
  CitationCollectionOptions,
  CitationIdLookup,
  CitationReferenceCluster,
} from "../../core/references/citation-rendering";

export interface CitationBacklink {
  readonly occurrence: number;
  readonly from: number;
  readonly to: number;
}

export interface CitationBacklinkIndex {
  readonly backlinks: ReadonlyMap<string, readonly CitationBacklink[]>;
}

/** Shape of parsed markdown reference tokens grouped by cluster positions. */
export interface CitationReferenceToken {
  readonly id: string;
  readonly clusterFrom: number;
  readonly clusterTo: number;
  readonly clusterIndex: number;
  readonly locator?: string;
}

export interface CitationLocalTargetSnapshot {
  readonly headings: readonly { readonly id?: string }[];
  readonly blocks: readonly { readonly id?: string }[];
  readonly equations: readonly { readonly id?: string }[];
}

export function getCitationRegistrationKey(
  clusters: readonly CitationCluster[],
): string {
  return coreGetCitationRegistrationKey(clusters);
}

export function isCitationId(
  id: string,
  store: CitationIdLookup,
  options?: CitationCollectionOptions,
): boolean {
  return coreIsCitationId(id, store, options);
}

export function isLocalReferenceIndexTarget(
  referenceIndex: ReferenceIndexModel,
  id: string,
): boolean {
  const entry = referenceIndex.get(id);
  return entry !== undefined && entry.type !== "citation";
}

export function createReferenceIndexLocalTargetLookup(
  referenceIndex: ReferenceIndexModel,
): (id: string) => boolean {
  return (id) => isLocalReferenceIndexTarget(referenceIndex, id);
}

export function createSnapshotLocalTargetLookup(
  snapshot: CitationLocalTargetSnapshot,
): (id: string) => boolean {
  const ids = new Set<string>();
  for (const collection of [snapshot.headings, snapshot.blocks, snapshot.equations]) {
    for (const item of collection) {
      if (item.id) ids.add(item.id);
    }
  }
  return (id) => ids.has(id);
}

export function collectCitationMatches(
  references: readonly CitationReferenceCluster[],
  store: CitationIdLookup,
  options?: CitationCollectionOptions,
): CitationCluster[] {
  return coreCollectCitationMatches(references, store, options);
}

export function collectCitationMatchesFromAnalysis(
  analysis: Pick<DocumentAnalysis, "references" | "referenceIndex">,
  store: CitationIdLookup,
): CitationCluster[] {
  return collectCitationMatches(analysis.references, store, {
    isLocalTarget: createReferenceIndexLocalTargetLookup(analysis.referenceIndex),
  });
}

export function collectCitedIdsFromReferences(
  references: readonly CitationReferenceCluster[],
  store: CitationIdLookup,
  options?: CitationCollectionOptions,
): string[] {
  return coreCollectCitedIdsFromReferences(references, store, options);
}

export function collectCitedIdsFromReferenceIndex(
  referenceIndex: ReferenceIndexModel,
  store: CitationIdLookup,
): string[] {
  const citedIds: string[] = [];
  for (const entry of referenceIndex.values()) {
    if (entry.type !== "citation" || !store.has(entry.id)) continue;
    citedIds.push(entry.id);
  }
  return citedIds;
}

export function collectCitationBacklinksFromReferences(
  references: readonly CitationReferenceCluster[],
  store: CitationIdLookup,
  options?: CitationCollectionOptions,
): ReadonlyMap<string, readonly CitationBacklink[]> {
  return collectCitationBacklinkIndexFromReferences(references, store, options).backlinks;
}

export function collectCitationBacklinksFromAnalysis(
  analysis: Pick<DocumentAnalysis, "references" | "referenceIndex">,
  store: CitationIdLookup,
): ReadonlyMap<string, readonly CitationBacklink[]> {
  return collectCitationBacklinksFromReferences(analysis.references, store, {
    isLocalTarget: createReferenceIndexLocalTargetLookup(analysis.referenceIndex),
  });
}

function aggregateBacklinksFromMatches<T>(
  matches: readonly T[],
  extractIds: (match: T) => readonly string[],
  extractPosition: (match: T) => { readonly from: number; readonly to: number },
): CitationBacklinkIndex {
  const backlinks = new Map<string, CitationBacklink[]>();
  let occurrence = 0;

  for (const match of matches) {
    const ids = extractIds(match);
    if (ids.length === 0) continue;

    occurrence += 1;
    const position = extractPosition(match);
    const backlink: CitationBacklink = {
      occurrence,
      from: position.from,
      to: position.to,
    };

    for (const id of ids) {
      const entries = backlinks.get(id);
      if (entries) {
        entries.push(backlink);
      } else {
        backlinks.set(id, [backlink]);
      }
    }
  }

  return { backlinks };
}

export function collectCitationBacklinkIndexFromReferences(
  references: readonly CitationReferenceCluster[],
  store: CitationIdLookup,
  options?: CitationCollectionOptions,
): CitationBacklinkIndex {
  return aggregateBacklinksFromMatches(
    references,
    (ref) => ref.ids.filter((id) => isCitationId(id, store, options)),
    (ref) => ({ from: ref.from ?? 0, to: ref.to ?? 0 }),
  );
}

function collectTokenBuckets(
  references: readonly CitationReferenceToken[],
  store: CitationIdLookup,
  options?: CitationCollectionOptions,
): CitationReferenceToken[][] {
  const buckets = new Map<string, CitationReferenceToken[]>();

  for (const reference of references) {
    if (!isCitationId(reference.id, store, options)) {
      continue;
    }
    const key = `${reference.clusterFrom}:${reference.clusterTo}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(reference);
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .map((bucket) => [...bucket].sort((left, right) => left.clusterIndex - right.clusterIndex))
    .sort((left, right) => left[0].clusterFrom - right[0].clusterFrom);
}

export function collectCitationClusters(
  references: readonly CitationReferenceToken[],
  store: CitationIdLookup,
  options?: CitationCollectionOptions,
): CitationCluster[] {
  return collectTokenBuckets(references, store, options)
    .map((bucket) => ({
      ids: bucket.map((reference) => reference.id),
      locators: bucket.map((reference) => reference.locator),
    }));
}

export function collectCitedIdsFromClusters(
  clusters: readonly CitationCluster[],
): string[] {
  return coreCollectCitedIdsFromClusters(clusters);
}

/**
 * Append the trailing Pandoc `nocite` cluster shared by every registration
 * path: `nocite` keys resolve against the bibliography, ids already cited
 * in-text are dropped, and the cluster registers last so numeric styles
 * number nocite entries after all in-text citations, matching Pandoc.
 * Mutates `clusters` in place and returns the appended ids (empty when
 * there is nothing new to register).
 */
export function appendNociteRegistrationCluster(
  clusters: CitationCluster[],
  nocite: readonly string[] | undefined,
  bibliography: NociteKeyLookup,
  options?: CitationCollectionOptions,
): string[] {
  const cited = new Set(clusters.flatMap((cluster) => cluster.ids));
  const nociteIds = resolveNociteIds(nocite, bibliography, options)
    .filter((id) => !cited.has(id));
  if (nociteIds.length > 0) {
    clusters.push({ ids: nociteIds, locators: [] });
  }
  return nociteIds;
}

export function collectCitationBacklinksFromTokens(
  references: readonly CitationReferenceToken[],
  store: CitationIdLookup,
  options?: CitationCollectionOptions,
): ReadonlyMap<string, readonly CitationBacklink[]> {
  return aggregateBacklinksFromMatches(
    collectTokenBuckets(references, store, options),
    (bucket) => bucket.map((reference) => reference.id),
    (bucket) => ({ from: bucket[0].clusterFrom, to: bucket[0].clusterTo }),
  ).backlinks;
}

export function getAnalysisCitationRegistrationKey(
  analysis: Pick<DocumentAnalysis, "references" | "referenceIndex">,
  store: CitationIdLookup,
): string {
  return getCitationRegistrationKey(collectCitationMatchesFromAnalysis(analysis, store));
}

export function getAnalysisCitationBacklinkKey(
  analysis: Pick<DocumentAnalysis, "references" | "referenceIndex">,
  store: CitationIdLookup,
): string {
  const options = {
    isLocalTarget: createReferenceIndexLocalTargetLookup(analysis.referenceIndex),
  };
  const parts: string[] = [];

  for (const reference of analysis.references) {
    const ids = reference.ids.filter((id) => isCitationId(id, store, options));
    if (ids.length === 0) continue;
    parts.push([
      reference.from,
      reference.to,
      ids.join("\u0001"),
    ].join("\0"));
  }

  return parts.join("\u0002");
}

export function getReferenceCitationRegistrationKey(
  references: readonly ReferenceSemantics[],
  store: CitationIdLookup,
  options?: CitationCollectionOptions,
): string {
  return getCitationRegistrationKey(collectCitationMatches(references, store, options));
}
