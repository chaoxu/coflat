#!/usr/bin/env node

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

console.log("coflat-editor package smoke passed");
