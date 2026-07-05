#!/usr/bin/env node
// Enforce the three-layer dependency rule inside src/:
//
//   core/    → pure: no codemirror, no react, no dompurify, no katex.
//              May only relative-import within core/.
//   reader/  → no codemirror, no react. May relative-import within reader/
//              or to core/. katex must be dynamic import only.
//   editor/  → unrestricted. Anything in src/ that is NOT in core/ or reader/
//              is treated as editor-layer.
//
// Runs over .ts/.tsx files only. .test.* files in core/ and reader/ obey the
// same rule (tests for pure code should be pure too).
//
// Imports are matched with cheap regexes; this is a guardrail, not a parser.
// Type-only imports are still flagged — purity is a package-extraction
// promise, not just a runtime concern.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("../", import.meta.url).pathname;
const SRC = join(ROOT, "src");

// For relative-path enforcement: core/ files may only relative-import
// within core/; reader/ files only within reader/ or to core/. The check is
// done by resolving the relative path against the file's directory and
// verifying it lands inside one of the allowed roots.
const FORBIDDEN_BY_LAYER = {
  core: {
    pkgs: [/^@codemirror\//, /^react$/, /^react-dom(\/|$)/, /^dompurify$/, /^katex(\/|$)/],
    allowedRelativeRoots: ["core"],
  },
  reader: {
    pkgs: [/^@codemirror\//, /^react$/, /^react-dom(\/|$)/],
    allowedRelativeRoots: ["core", "reader"],
    // katex must be dynamic — top-level static import is a violation.
    staticOnly: [/^katex(\/|$)/],
  },
  editor: {
    pkgs: [],
    allowedRelativeRoots: null, // unrestricted
  },
};

const IMPORT_RE = /^\s*import\s+(?:type\s+)?(?:[\s\S]*?from\s+)?["']([^"']+)["']/gm;
// Re-exports (`export … from "spec"`) create a real dependency edge but were
// invisible to IMPORT_RE — the exact syntax core/ barrels use. Requiring the
// `from` clause keeps `export const x = "…"` from matching.
const EXPORT_FROM_RE =
  /^\s*export\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[\s\S]*?\})\s+from\s+["']([^"']+)["']/gm;
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
  if (rel.startsWith("core/") || rel === "core") return "core";
  if (rel.startsWith("reader/") || rel === "reader") return "reader";
  // Everything else inside src/ is implicitly editor-layer.
  return "editor";
}

// Resolve a relative import against the importing file's directory, and
// return which top-level src/ subtree (e.g. "core", "reader", "render") the
// resolved file lives in. Returns null for imports that escape src/.
function resolveRelativeRoot(fromFile, spec) {
  const dir = dirname(fromFile);
  const resolved = resolve(dir, spec);
  const relFromSrc = relative(SRC, resolved);
  if (relFromSrc.startsWith("..")) return null;
  const root = relFromSrc.split("/")[0];
  return root || "."; // "." for imports that land at src/ itself
}

export function checkSource(src, layer, absPath = "<memory>") {
  const violations = [];
  const rules = FORBIDDEN_BY_LAYER[layer];

  const staticImports = [];
  for (const m of src.matchAll(IMPORT_RE)) staticImports.push(m[1]);
  for (const m of src.matchAll(EXPORT_FROM_RE)) staticImports.push(m[1]);

  const dynamicImports = [];
  for (const m of src.matchAll(DYNAMIC_RE)) dynamicImports.push(m[1]);

  const allowedRoots = rules.allowedRelativeRoots;

  for (const spec of staticImports) {
    if (spec.startsWith(".")) {
      if (allowedRoots !== null && allowedRoots !== undefined) {
        const root = resolveRelativeRoot(absPath, spec);
        if (root === null) {
          violations.push(`relative import escapes src/: ${spec}`);
        } else if (!allowedRoots.includes(root)) {
          violations.push(
            `relative import to forbidden subtree (${root}/): ${spec} — ${layer}/ may only relative-import within ${allowedRoots.join("/")}/`,
          );
        }
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

  // Dynamic imports: relative same rules; packages drop the staticOnly rule
  // (the whole point of dynamic is to allow katex).
  for (const spec of dynamicImports) {
    if (spec.startsWith(".")) {
      if (allowedRoots !== null && allowedRoots !== undefined) {
        const root = resolveRelativeRoot(absPath, spec);
        if (root === null) {
          violations.push(`dynamic relative import escapes src/: ${spec}`);
        } else if (!allowedRoots.includes(root)) {
          violations.push(
            `dynamic relative import to forbidden subtree (${root}/): ${spec}`,
          );
        }
      }
      continue;
    }
    for (const re of rules.pkgs ?? []) {
      if (re.test(spec)) violations.push(`forbidden dynamic package import: ${spec}`);
    }
  }

  return violations;
}

function checkFile(absPath, layer) {
  return checkSource(readFileSync(absPath, "utf8"), layer, absPath);
}

function run() {
  let bad = 0;
  for (const file of walk(SRC)) {
    const layer = layerOf(file);
    const violations = checkFile(file, layer);
    if (violations.length > 0) {
      bad++;
      const rel = relative(ROOT, file);
      console.error(`${rel} [${layer}]`);
      for (const v of violations) console.error(`  ${v}`);
    }
  }

  if (bad > 0) {
    console.error(`\n${bad} file(s) violate the layer-boundary rule. See README.md "Package architecture" for the rule.`);
    process.exit(1);
  }
  console.log("Layer boundary clean.");
}

// Run when invoked directly, but stay importable for the unit test. Compares
// the entry path rather than `import.meta.main`, which is undefined before
// Node 24.2 and would silently turn this lint gate into a no-op there.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
