import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDocumentAnalysisCache,
  getCachedDocumentAnalysis,
  getCachedDocumentArtifacts,
  getDocumentAnalysis,
  getDocumentArtifacts,
  rememberDocumentAnalysis,
} from "./cached-document-analysis";
import {
  getDocumentAnalysisRevision,
  getDocumentAnalysisSliceRevision,
} from "./engine";

beforeEach(() => {
  clearDocumentAnalysisCache();
});

describe("shared document analysis cache", () => {
  it("reuses object identity for unchanged text at the same cache key", () => {
    const path = "notes/cache-identity.md";
    const first = getDocumentAnalysis("# Title\n", path);
    const second = getDocumentAnalysis("# Title\n", path);

    expect(second).toBe(first);
  });

  it("continues incremental updates after adopting external analysis", () => {
    const path = "notes/cache-adoption.md";
    const initialText = "# Title\n\nParagraph.\n";
    const external = getCachedDocumentAnalysis(initialText).analysis;

    expect(rememberDocumentAnalysis(initialText, external, path)).toBe(external);
    expect(getDocumentAnalysis(initialText, path)).toBe(external);

    const after = getDocumentAnalysis(
      "# Title\n\nParagraph with [@ref].\n",
      path,
    );
    const afterArtifacts = getDocumentArtifacts(
      "# Title\n\nParagraph with [@ref].\n",
      path,
    );

    expect(after).toBe(afterArtifacts.analysis);
    expect(getDocumentAnalysisRevision(afterArtifacts.analysisSnapshot)).toBe(
      getDocumentAnalysisRevision(external) + 1,
    );
    expect(getDocumentAnalysisSliceRevision(afterArtifacts.analysisSnapshot, "references")).toBe(
      getDocumentAnalysisSliceRevision(external, "references") + 1,
    );
    expect(getDocumentAnalysisSliceRevision(afterArtifacts.analysisSnapshot, "headings")).toBe(
      getDocumentAnalysisSliceRevision(external, "headings"),
    );
  });

  it("shares cached artifacts with the analysis cache for the same path", () => {
    const path = "notes/artifacts.md";
    const first = getDocumentArtifacts("# Title\n", path);
    const second = getDocumentAnalysis("# Title\n", path);

    expect(second).toBe(first.analysis);
  });

  it("rebuilds IR while reusing unchanged analysis slices", () => {
    const path = "notes/table-only.md";
    const before = getDocumentArtifacts([
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
    ].join("\n"), path);
    const after = getDocumentArtifacts([
      "| A | B |",
      "| --- | --- |",
      "| 9 | 2 |",
      "",
    ].join("\n"), path);

    expect(after.analysis).toBe(before.analysis);
    expect(before.ir.tables[0]?.rows[0]?.cells[0]?.content).toBe("1");
    expect(after.ir.tables[0]?.rows[0]?.cells[0]?.content).toBe("9");
  });

  it("converges unchanged-text reads after a structural edit defers pending work", () => {
    // The reader path has no tree-progress or idle-drain transactions: after
    // a fence opener reinterprets a >budget suffix, both the updating call
    // and later unchanged-text calls must return fully drained analyses
    // instead of short-circuiting to the stale snapshot forever.
    const path = "notes/pending-drain.md";
    const head = "# Intro {#sec:intro}\n\nintro para.\n\n";
    const tail = Array.from({ length: 1200 }, (_, index) =>
      index % 100 === 0
        ? `## Section ${index} {#sec:s${index}}`
        : `Filler prose line number ${index}.`,
    ).flatMap((line) => [line, ""]).join("\n");
    const before = head + tail;
    const after = `${head}\`\`\`\n${tail}`;
    expect(after.length).toBeGreaterThan(16384 * 2);

    expect(getDocumentAnalysis(before, path).headings.length).toBeGreaterThan(1);

    const updated = getDocumentAnalysis(after, path);
    const again = getDocumentAnalysis(after, path);
    const fresh = getDocumentAnalysis(after);

    expect(fresh.headings.map((heading) => heading.id)).toEqual(["sec:intro"]);
    expect(updated.headings).toEqual(fresh.headings);
    expect(again.headings).toEqual(fresh.headings);
    expect(again.references).toEqual(fresh.references);
    expect(again.fencedDivs).toEqual(fresh.fencedDivs);
  });

  it("builds artifacts from an adopted editor analysis without recomputing semantics", () => {
    const path = "notes/adopted-artifacts.md";
    const text = "# Title\n\nBody.\n";
    const external = getCachedDocumentAnalysis(text).analysis;

    expect(rememberDocumentAnalysis(text, external, path)).toBe(external);

    const artifacts = getDocumentArtifacts(text, path);

    expect(artifacts.analysis).toBe(external);
    expect(artifacts.ir.sections[0]?.heading).toBe("Title");
  });
});

describe("cached document artifacts", () => {
  it("updates semantic analysis incrementally while refreshing IR", () => {
    const before = getCachedDocumentArtifacts("# Title\n\nParagraph.\n");
    const after = getCachedDocumentArtifacts(
      "# Title\n\nParagraph with [@ref].\n",
      before,
    );

    expect(after.version).toBe(before.version + 1);
    expect(getDocumentAnalysisRevision(after.artifacts.analysisSnapshot)).toBe(
      getDocumentAnalysisRevision(before.artifacts.analysisSnapshot) + 1,
    );
    expect(getDocumentAnalysisSliceRevision(after.artifacts.analysisSnapshot, "references")).toBe(
      getDocumentAnalysisSliceRevision(before.artifacts.analysisSnapshot, "references") + 1,
    );
    expect(after.artifacts.ir.references[0]?.ids).toEqual(["ref"]);
  });
});
