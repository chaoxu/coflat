#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function assertIncludes(value, needle, label) {
  if (!value.includes(needle)) {
    throw new Error(`${label} missing ${needle}`);
  }
}

const source = read("tests/fixtures/coflat-showcase.md");
const css = read("dist/editor.css");
const surfaceCss = read("dist/document-surface.css");
const latexCsl = read("dist/latex/csl/ieee.csl");
const latexFilter = read("dist/latex/filter.lua");
const latexSyntaxManifest = read("dist/latex/syntax-manifest.lua");
const { renderToHtml } = await import("../dist/reader.mjs");
const rendered = renderToHtml(source, undefined, { sourceLineAttribution: true });

assertIncludes(rendered.html, 'class="cf-doc-heading cf-doc-heading--h1"', "reader html");
assertIncludes(rendered.html, 'cf-doc-heading--unnumbered', "reader html");
assertIncludes(rendered.html, 'data-heading-numbering="none"', "reader html");
assertIncludes(rendered.html, 'class="cf-doc-list cf-doc-list--unordered', "reader html");
assertIncludes(rendered.html, 'class="cf-doc-code-block"', "reader html");
assertIncludes(rendered.html, 'class="cf-doc-table-block"', "reader html");
assertIncludes(rendered.html, 'cf-doc-block--theorem', "reader html");
if (rendered.html.includes("{.unnumbered}") || rendered.html.includes("{-}")) {
  throw new Error("reader html leaked Pandoc heading attributes");
}
if (!rendered.hasMath) {
  throw new Error("reader html did not report math for the showcase fixture");
}

assertIncludes(css, ".cf-reader .cf-doc-heading--h1", "dist/editor.css");
assertIncludes(css, "counter-reset: cf-reader-h1 cf-reader-h2", "dist/editor.css");
assertIncludes(css, ".cf-reader .cf-doc-list--unordered", "dist/editor.css");
assertIncludes(css, ".cf-reader .cf-doc-display-math", "dist/editor.css");
assertIncludes(surfaceCss, ".cf-reader .cf-doc-heading--h1", "dist/document-surface.css");
assertIncludes(surfaceCss, "counter-reset: cf-reader-h1 cf-reader-h2", "dist/document-surface.css");
assertIncludes(surfaceCss, ".cf-reader .cf-doc-list--unordered", "dist/document-surface.css");
assertIncludes(surfaceCss, ".cf-reader .cf-doc-display-math", "dist/document-surface.css");
assertIncludes(surfaceCss, ":root", "dist/document-surface.css");
assertIncludes(surfaceCss, ".katex-display", "dist/document-surface.css");
if (/\.cm-/.test(surfaceCss)) {
  throw new Error("dist/document-surface.css must not contain CM6 selectors");
}

assertIncludes(latexCsl, 'citation-format="numeric"', "dist/latex/csl/ieee.csl");
assertIncludes(latexFilter, "syntax-manifest.lua", "dist/latex/filter.lua");
assertIncludes(latexSyntaxManifest, "latex_kind_by_block", "dist/latex/syntax-manifest.lua");

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
