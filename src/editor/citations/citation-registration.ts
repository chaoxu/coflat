import type { DocumentAnalysis } from "../semantics/document";
import { type BibStore } from "../state/bib-data";
import {
  collectCitationMatchesFromAnalysis,
  getCitationRegistrationKey,
} from "./citation-matching";
import {
  type CslProcessor,
  registerCitationsWithProcessor,
} from "./csl-processor";

/**
 * Ensure citations from the current document analysis are registered with the
 * CSL processor. Registration state is tracked on the processor itself so
 * shared render surfaces can reuse one authoritative cache key.
 */
export function ensureCitationsRegistered(
  analysis: DocumentAnalysis,
  store: BibStore,
  processor: CslProcessor,
): void {
  const matches = collectCitationMatchesFromAnalysis(analysis, store);
  const registrationKey = getCitationRegistrationKey(matches);
  if (processor.citationRegistrationKey === registrationKey) {
    return;
  }

  registerCitationsWithProcessor(matches, processor);
}
