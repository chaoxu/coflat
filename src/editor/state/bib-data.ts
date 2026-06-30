import { StateEffect, StateField } from "@codemirror/state";

import { type BibStore } from "../../core/citations/csl-json";
import type { CitationFormatter } from "../../core/document-context-types";

export { type BibStore };

export type BibliographyFailureKind =
  | "read-bib"
  | "parse-bib"
  | "read-csl"
  | "style-csl"
  | "unexpected";

export type BibliographyStatus =
  | { readonly state: "idle" }
  | {
    readonly state: "ok";
    readonly bibPath: string;
    readonly cslPath?: string;
  }
  | {
    readonly state: "warning";
    readonly kind: BibliographyFailureKind;
    readonly bibPath: string;
    readonly cslPath?: string;
    readonly message: string;
  }
  | {
    readonly state: "error";
    readonly kind: BibliographyFailureKind;
    readonly bibPath: string;
    readonly cslPath?: string;
    readonly message: string;
  };

/**
 * Bibliography data stored in the editor state.
 *
 * v0.2 chunk 3b: the `formatter` field replaced the old `cslProcessor` one.
 * The main bundle no longer imports a concrete CSL implementation; hosts that
 * want CSL formatting attach one via the `@chaoxu/coflat/citeproc`
 * helper.
 */
export interface BibData {
  store: BibStore;
  /**
   * Optional citation formatter state for hosts that explicitly build CSL
   * rendering on top of the default reference flow.
   */
  formatter?: CitationFormatter | null;
  status?: BibliographyStatus;
}

interface BibDataState extends BibData {
  readonly formatter: CitationFormatter | null;
  readonly formatterRevision: number;
  readonly status: BibliographyStatus;
}

/** StateEffect for updating bibliography data. */
export const bibDataEffect = StateEffect.define<BibData>();

function bibDataStatus(value: BibData): BibliographyStatus {
  return value.status ?? { state: "ok", bibPath: "" };
}

/** StateField that holds the current bibliography data. */
export const bibDataField = StateField.define<BibDataState>({
  create() {
    return {
      store: new Map(),
      formatter: null,
      formatterRevision: 0,
      status: { state: "idle" },
    };
  },

  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(bibDataEffect)) {
        const formatter = effect.value.formatter ?? null;
        return {
          ...effect.value,
          formatter,
          status: bibDataStatus(effect.value),
          formatterRevision: formatter?.revision ?? 0,
        };
      }
    }

    if (value.formatter && value.formatterRevision !== value.formatter.revision) {
      return {
        ...value,
        formatterRevision: value.formatter.revision,
      };
    }

    return value;
  },

  compare(a, b) {
    return (
      a.store === b.store &&
      a.formatter === b.formatter &&
      a.formatterRevision === b.formatterRevision &&
      a.status === b.status
    );
  },
});
