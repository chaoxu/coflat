import { test } from "@playwright/test";
import {
  corpusDocuments,
  corpusSources,
  expectLoadedCorpusMathSemanticsMatch,
  expectLoadedSplitContentPixelsMatch,
  loadParityPairSurface,
  PARITY_PIXEL_PRESETS,
} from "./parity-harness";

const CORPUS_PARITY_DOCUMENTS = corpusDocuments();
const CORPUS_PARITY_SOURCES = corpusSources();
const CORPUS_PIXEL_PRESETS = PARITY_PIXEL_PRESETS;
const CORPUS_CHUNK_COUNTS = new Map<string, number>();
for (const { name } of CORPUS_PARITY_SOURCES) {
  const documentName = documentNameForChunk(name);
  CORPUS_CHUNK_COUNTS.set(documentName, (CORPUS_CHUNK_COUNTS.get(documentName) ?? 0) + 1);
}
const SINGLE_CHUNK_DOCUMENTS = new Set(
  Array.from(CORPUS_CHUNK_COUNTS)
    .filter(([, count]) => count === 1)
    .map(([name]) => name),
);
const CORPUS_FULL_DOCUMENT_SEMANTIC_SOURCES = CORPUS_PARITY_DOCUMENTS
  .filter(({ name }) => !SINGLE_CHUNK_DOCUMENTS.has(name));

function documentNameForChunk(name: string): string {
  return name.replace(/:\d+-\d+$/, "");
}

test.describe("Cosheaf corpus reader/CM6 parity @corpus", () => {
  if (CORPUS_PARITY_DOCUMENTS.length === 0) {
    test("requires COFLAT_PARITY_CORPUS_DIR", async () => {
      throw new Error("Set COFLAT_PARITY_CORPUS_DIR to a checked-out Cosheaf markdown corpus.");
    });
  } else {
    for (const { name, source } of CORPUS_FULL_DOCUMENT_SEMANTIC_SOURCES) {
      test(`default full-document semantic parity ${name}`, async ({ page }) => {
        test.setTimeout(60_000);
        await page.setViewportSize({ width: 2560, height: 3600 });
        await loadParityPairSurface(page, "default", source);
        await expectLoadedCorpusMathSemanticsMatch(page, name);
      });
    }

    for (const { name, pixelRange, source } of CORPUS_PARITY_SOURCES) {
      const coversFullDocumentSemantics = SINGLE_CHUNK_DOCUMENTS.has(documentNameForChunk(name));
      const testName = coversFullDocumentSemantics
        ? `default semantic and pixel parity ${name}`
        : `default pixel parity ${name}`;

      test(testName, async ({ page }) => {
        test.setTimeout(60_000);
        await page.setViewportSize({ width: 2560, height: 3600 });
        await loadParityPairSurface(page, "default", source);
        if (coversFullDocumentSemantics) {
          await expectLoadedCorpusMathSemanticsMatch(page, name);
        }
        await expectLoadedSplitContentPixelsMatch(page, `${name} default`, pixelRange);
      });

      for (const preset of CORPUS_PIXEL_PRESETS.filter((preset) => preset !== "default")) {
        test(`${preset} pixel parity ${name}`, async ({ page }) => {
          test.setTimeout(60_000);
          await page.setViewportSize({ width: 2560, height: 3600 });
          await loadParityPairSurface(page, preset, source);
          await expectLoadedSplitContentPixelsMatch(page, `${name} ${preset}`, pixelRange);
        });
      }
    }
  }
});
