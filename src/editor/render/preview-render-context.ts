import type { CitationFormatter } from "../../core/document-context-types";
import type { DocumentSurfacePolicy } from "../../core/document-surface-policy";
import type { BlockCounterEntry } from "../../core/lib/file-system-types";
import type { NumberedBlock } from "../../core/semantics/block-numbering";
import type { DocumentSemantics } from "../semantics/document";
import type { BibStore } from "../state/bib-data";
import type { InlineReferenceRenderContext } from "./inline-render";

export interface PreviewRenderContext {
  readonly doc: string;
  readonly macros: Record<string, string>;
  readonly semantics: DocumentSemantics;
  readonly referenceSemantics: DocumentSemantics;
  readonly bibliography?: BibStore;
  readonly formatter?: CitationFormatter | null;
  readonly blockCounters?: ReadonlyMap<string, BlockCounterEntry>;
  readonly documentBlockNumbers: ReadonlyMap<number, NumberedBlock>;
  readonly blockTitleOverrides: ReadonlyMap<string, string>;
  readonly documentPath?: string;
  readonly imageUrlOverrides?: ReadonlyMap<string, string>;
  readonly footnoteNumbers: ReadonlyMap<string, number>;
  readonly referenceContext: InlineReferenceRenderContext;
  readonly surfacePolicy: DocumentSurfacePolicy;
  readonly paragraphSourceOffset: number;
  readonly paragraphSourcePositions: boolean;
}
