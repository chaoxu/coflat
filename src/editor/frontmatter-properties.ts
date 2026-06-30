/**
 * Lossless frontmatter editing for the document-properties panel.
 *
 * The panel reads typed values through {@link readPanelProperties} and writes
 * through the mutators below. Writes go through the `yaml` Document AST so that
 * keys, ordering, and comments the user did not touch survive byte-for-byte —
 * the panel owns the keys it edits and never rewrites the rest. This is the data
 * contract behind the "Edit as YAML" escape hatch staying lossless.
 *
 * Reads parse via the lower-layer `core/parser` + `yaml` directly rather than
 * `parse.ts`'s `parseFrontmatter`: `src/editor` must not depend on the root
 * `parse.ts` (which itself imports from `src/editor`), so reusing it here would
 * create an import cycle.
 */

import { Document, isMap, parseDocument } from "yaml";

import { extractRawFrontmatter } from "../core/parser/frontmatter.js";

type ExtractedFrontmatter = ReturnType<typeof extractRawFrontmatter>;

/**
 * Parse a frontmatter block into a mutable `yaml` Document, preserving comments
 * and order. An absent, empty, or comment-only block yields a fresh empty map so
 * callers can `set`/`toJS` uniformly.
 */
function frontmatterDocument(extracted: ExtractedFrontmatter): Document {
  if (extracted && extracted.raw.trim() !== "") {
    const doc = parseDocument(extracted.raw);
    if (doc.contents !== null) return doc;
  }
  return new Document({});
}

/** The subset of frontmatter the panel surfaces as form fields. */
export interface PanelProperties {
  readonly title?: string;
  readonly id?: string;
  readonly bibliography?: string;
  readonly type?: string;
  readonly status?: string;
  readonly target?: string;
  /** Macro name (with leading backslash) → KaTeX expansion. */
  readonly math: Readonly<Record<string, string>>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Read panel-relevant frontmatter values from the raw YAML map (not the typed
 * Pandoc config, which drops Coflat KB keys like `id`/`type`/`status`/`target`).
 * Tolerant of missing/invalid blocks.
 */
export function readPanelProperties(source: string): PanelProperties {
  const raw: Record<string, unknown> =
    (frontmatterDocument(extractRawFrontmatter(source)).toJS() as Record<string, unknown> | null) ??
    {};

  const math: Record<string, string> = {};
  const rawMath = raw.math;
  if (rawMath !== null && typeof rawMath === "object" && !Array.isArray(rawMath)) {
    for (const [name, expansion] of Object.entries(rawMath as Record<string, unknown>)) {
      if (typeof expansion === "string") math[name] = expansion;
    }
  }

  return {
    title: asString(raw.title),
    id: asString(raw.id),
    bibliography: asString(raw.bibliography),
    type: asString(raw.type),
    status: asString(raw.status),
    target: asString(raw.target),
    math,
  };
}

function detectEol(source: string): string {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Mutate the document's frontmatter YAML AST and splice the result back into the
 * full source, preserving the body and any untouched frontmatter content. Creates
 * a frontmatter block at the top if none exists.
 */
export function editFrontmatter(
  source: string,
  mutate: (doc: Document) => void,
): string {
  const eol = detectEol(source);
  const bom = source.charCodeAt(0) === 0xfeff ? "﻿" : "";
  const extracted = extractRawFrontmatter(source);

  const doc = frontmatterDocument(extracted);
  mutate(doc);

  const body = extracted ? source.slice(extracted.end) : source.slice(bom.length);
  const inner = doc.toString().replace(/\n+$/, "").split("\n").join(eol);

  // An emptied frontmatter map serializes to `{}`; drop the block entirely.
  const trimmed = inner.trim();
  if (trimmed === "" || trimmed === "{}") {
    return bom + body;
  }

  return `${bom}---${eol}${inner}${eol}---${eol}${body}`;
}

/** Set a top-level scalar key, or remove it when `value` is null. */
export function setFrontmatterScalar(
  source: string,
  key: string,
  value: string | null,
): string {
  return editFrontmatter(source, (doc) => {
    if (value === null) doc.delete(key);
    else doc.set(key, value);
  });
}

/** Add or update a math macro (keys carry the leading backslash, e.g. `\\cl`). */
export function setMathMacro(source: string, name: string, expansion: string): string {
  return editFrontmatter(source, (doc) => {
    doc.setIn(["math", name], expansion);
  });
}

/** Remove a math macro; drops the `math` map when it becomes empty. */
export function removeMathMacro(source: string, name: string): string {
  return editFrontmatter(source, (doc) => {
    doc.deleteIn(["math", name]);
    const math = doc.get("math");
    if (isMap(math) && math.items.length === 0) doc.delete("math");
  });
}

/** Rename a macro key while keeping its expansion and position best-effort. */
export function renameMathMacro(source: string, oldName: string, newName: string): string {
  if (oldName === newName) return source;
  return editFrontmatter(source, (doc) => {
    const expansion = doc.getIn(["math", oldName]);
    if (expansion === undefined) return;
    doc.deleteIn(["math", oldName]);
    doc.setIn(["math", newName], expansion);
  });
}
