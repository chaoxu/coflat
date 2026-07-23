#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPackageGraphBoundaries,
  formatPackageGraphReport,
  measurePackageGraph,
} from "./measure-package-graph.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function assertIncludes(value, needle, label) {
  if (!value.includes(needle)) {
    throw new Error(`${label} missing ${needle}`);
  }
}

function assertNotMatches(value, pattern, label) {
  if (pattern.test(value)) {
    throw new Error(`${label} matched forbidden pattern ${pattern}`);
  }
}

const source = read("tests/fixtures/coflat-showcase.md");
const css = read("dist/editor.css");
const surfaceCss = read("dist/document-surface.css");
const latexCsl = read("dist/latex/csl/ieee.csl");
const latexFilter = read("dist/latex/filter.lua");
const latexSyntaxManifest = read("dist/latex/syntax-manifest.lua");
const latexArticleTemplate = read("dist/latex/template/article.tex");
const jsExports = [
  "../dist/editor.mjs",
  "../dist/inline-render.mjs",
  "../dist/reader.mjs",
  "../dist/rich-readonly.mjs",
  "../dist/reader-worker.mjs",
  "../dist/parse.mjs",
  "../dist/citeproc.mjs",
  "../dist/numeric.mjs",
  "../dist/latex.mjs",
  "../dist/test-utils.js",
  "../dist/browser-test-utils.js",
];
for (const entry of jsExports) {
  await import(entry);
}
const packageExports = [
  "@chaoxu/coflat",
  "@chaoxu/coflat/reader",
  "@chaoxu/coflat/reader/worker",
  "@chaoxu/coflat/rich-readonly",
  "@chaoxu/coflat/inline-render",
  "@chaoxu/coflat/parse",
  "@chaoxu/coflat/citeproc",
  "@chaoxu/coflat/numeric",
  "@chaoxu/coflat/latex",
  "@chaoxu/coflat/test-utils",
  "@chaoxu/coflat/browser-test-utils",
];
for (const entry of packageExports) {
  await import(entry);
}
const { renderToHtml } = await import("../dist/reader.mjs");
const { renderFastRichReadonlyHtml } = await import("../dist/rich-readonly.mjs");
const rendered = renderToHtml(source, undefined, { sourceLineAttribution: true });
const richReadonly = renderFastRichReadonlyHtml(source, undefined, { outline: true });

assertIncludes(rendered.html, 'class="cf-doc-heading cf-doc-heading--h1"', "reader html");
assertIncludes(rendered.html, 'cf-doc-heading--unnumbered', "reader html");
assertIncludes(rendered.html, 'data-heading-numbering="none"', "reader html");
assertIncludes(rendered.html, 'class="cf-doc-list cf-doc-list--unordered', "reader html");
assertIncludes(rendered.html, 'class="cf-doc-code-block"', "reader html");
assertIncludes(rendered.html, 'class="cf-doc-table-block"', "reader html");
assertIncludes(rendered.html, 'cf-doc-block--theorem', "reader html");
assertIncludes(richReadonly.html, 'class="cf-doc-table-block"', "rich-readonly html");
if (!richReadonly.outline || richReadonly.outline.length === 0) {
  throw new Error("rich-readonly html did not expose outline metadata");
}
if (rendered.html.includes("{.unnumbered}") || rendered.html.includes("{-}")) {
  throw new Error("reader html leaked Pandoc heading attributes");
}
if (!rendered.hasMath) {
  throw new Error("reader html did not report math for the showcase fixture");
}

assertIncludes(css, ".cf-doc-flow .cf-doc-heading--h1", "dist/editor.css");
assertIncludes(css, "counter-reset: cf-reader-h1 cf-reader-h2", "dist/editor.css");
assertIncludes(css, ".cf-doc-flow .cf-doc-list--unordered", "dist/editor.css");
assertIncludes(css, ".cf-doc-flow .cf-doc-display-math", "dist/editor.css");
assertIncludes(surfaceCss, ".cf-doc-flow .cf-doc-heading--h1", "dist/document-surface.css");
assertIncludes(surfaceCss, "counter-reset: cf-reader-h1 cf-reader-h2", "dist/document-surface.css");
assertIncludes(surfaceCss, ".cf-doc-flow .cf-doc-list--unordered", "dist/document-surface.css");
assertIncludes(surfaceCss, ".cf-doc-flow .cf-doc-display-math", "dist/document-surface.css");
assertIncludes(surfaceCss, ".cf-preview-surface-shell", "dist/document-surface.css");
assertIncludes(surfaceCss, ".cf-hover-preview-tooltip", "dist/document-surface.css");
assertIncludes(surfaceCss, ".cf-doc-heading[data-section-number]::before", "dist/document-surface.css");
assertIncludes(surfaceCss, ":root", "dist/document-surface.css");
assertIncludes(surfaceCss, ".katex-display", "dist/document-surface.css");
assertNotMatches(surfaceCss, /\.cm-/, "dist/document-surface.css");
assertNotMatches(css, /(^|})\s*\.font-mono\b/, "dist/editor.css");
assertNotMatches(surfaceCss, /(^|})\s*\[data-section-number\]::before/, "dist/document-surface.css");

const richReadonlyBundle = read("dist/rich-readonly.mjs");
assertNotMatches(richReadonlyBundle, /@codemirror|react|react-dom|pdfjs-dist|@citation-js|cmdk|@radix-ui/, "dist/rich-readonly.mjs");
const packageGraph = measurePackageGraph();
assertPackageGraphBoundaries(packageGraph);
console.log(formatPackageGraphReport(packageGraph));

assertIncludes(latexCsl, 'citation-format="numeric"', "dist/latex/csl/ieee.csl");
assertIncludes(latexFilter, "syntax-manifest.lua", "dist/latex/filter.lua");
assertIncludes(latexSyntaxManifest, "latex_kind_by_block", "dist/latex/syntax-manifest.lua");
assertIncludes(latexArticleTemplate, "\\documentclass[runningheads,envcountsame]{llncs}", "dist/latex/template/article.tex");

const latexSmoke = spawnSync(
  "pandoc",
  [
    "--from=markdown+fenced_divs",
    "--to=latex",
    "--lua-filter=dist/latex/filter.lua",
  ],
  {
    cwd: root,
    input: "::: {.theorem}\nA packaged filter smoke.\n:::\n",
    encoding: "utf8",
  },
);
if (latexSmoke.error && latexSmoke.error.code !== "ENOENT") {
  throw latexSmoke.error;
}
if (!latexSmoke.error) {
  if (latexSmoke.status !== 0) {
    throw new Error(`dist latex filter smoke failed:\n${latexSmoke.stderr}`);
  }
  assertIncludes(latexSmoke.stdout, "\\begin{theorem}", "dist latex filter smoke");
} else {
  console.log("skipped dist latex filter smoke: pandoc not found");
}

console.log("coflat package smoke passed");
