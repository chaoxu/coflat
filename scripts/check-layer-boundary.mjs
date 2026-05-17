#!/usr/bin/env node
// Enforce the three-layer dependency rule inside src/:
//
//   core/    → pure: no codemirror, no react, no dompurify, no katex,
//              no reader/, no editor/, no top-level src/* that bypasses
//              the layer (e.g. importing from "../editor/...").
//   reader/  → may depend on core/; no codemirror, no react; katex must be
//              dynamic import only (no top-level `import "katex"`).
//   editor/  → unrestricted.
//
// Runs over .ts/.tsx files only. .test.* files in core/ and reader/ obey the
// same rule (tests for pure code should be pure too).
//
// Imports are matched with cheap regexes; this is a guardrail, not a parser.
// Type-only imports are still flagged — purity is a package-extraction
// promise, not just a runtime concern.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const SRC = join(ROOT, "src");

const FORBIDDEN_BY_LAYER = {
  core: {
    pkgs: [/^@codemirror\//, /^react$/, /^react-dom(\/|$)/, /^dompurify$/, /^katex(\/|$)/],
    relativeBlocks: [/^\.\.?\/reader(\/|$)/, /^\.\.?\/editor(\/|$)/],
  },
  reader: {
    pkgs: [/^@codemirror\//, /^react$/, /^react-dom(\/|$)/],
    relativeBlocks: [/^\.\.?\/editor(\/|$)/],
    // katex must be dynamic — top-level static import is a violation.
    staticOnly: [/^katex(\/|$)/],
  },
  editor: {
    pkgs: [],
    relativeBlocks: [],
  },
};

const IMPORT_RE = /^\s*import\s+(?:type\s+)?(?:[\s\S]*?from\s+)?["']([^"']+)["']/gm;
const DYNAMIC_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function walk(dir) {
  const out = [];
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|mts)$/.test(ent)) out.push(p);
  }
  return out;
}

function layerOf(absPath) {
  const rel = relative(SRC, absPath);
  if (rel.startsWith("core/") || rel === "core" || rel.startsWith("core" + "/")) return "core";
  if (rel.startsWith("reader/") || rel === "reader") return "reader";
  if (rel.startsWith("editor/") || rel === "editor") return "editor";
  return null;
}

function checkFile(absPath, layer) {
  const src = readFileSync(absPath, "utf8");
  const violations = [];
  const rules = FORBIDDEN_BY_LAYER[layer];

  const staticImports = [];
  for (const m of src.matchAll(IMPORT_RE)) staticImports.push(m[1]);

  const dynamicImports = [];
  for (const m of src.matchAll(DYNAMIC_RE)) dynamicImports.push(m[1]);

  for (const spec of staticImports) {
    if (spec.startsWith(".")) {
      for (const re of rules.relativeBlocks ?? []) {
        if (re.test(spec)) violations.push(`forbidden relative import: ${spec}`);
      }
      continue;
    }
    for (const re of rules.pkgs ?? []) {
      if (re.test(spec)) violations.push(`forbidden package import: ${spec}`);
    }
    for (const re of rules.staticOnly ?? []) {
      if (re.test(spec)) violations.push(`package must be dynamic-imported only: ${spec}`);
    }
  }

  // Dynamic imports get the relaxed treatment (e.g. reader's katex).
  for (const spec of dynamicImports) {
    if (spec.startsWith(".")) {
      for (const re of rules.relativeBlocks ?? []) {
        if (re.test(spec)) violations.push(`forbidden dynamic relative import: ${spec}`);
      }
      continue;
    }
    for (const re of rules.pkgs ?? []) {
      if (re.test(spec)) violations.push(`forbidden dynamic package import: ${spec}`);
    }
  }

  return violations;
}

let bad = 0;
for (const file of walk(SRC)) {
  const layer = layerOf(file);
  if (!layer) continue;
  const violations = checkFile(file, layer);
  if (violations.length > 0) {
    bad++;
    const rel = relative(ROOT, file);
    console.error(`${rel} [${layer}]`);
    for (const v of violations) console.error(`  ${v}`);
  }
}

if (bad > 0) {
  console.error(`\n${bad} file(s) violate the layer-boundary rule. See src/core/index.ts for the rule.`);
  process.exit(1);
}
console.log("Layer boundary clean.");
