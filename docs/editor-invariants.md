# Coflat Editor Invariants

This note records the constraints that should stay true when changing the
CodeMirror editor. It is intentionally short: each point should map to a
specific subsystem and a testable behavior.

## Raw Markdown Is The Source

The `EditorState.doc` value is always Markdown source. Rich editor rendering is
view-only, built from CodeMirror decorations, widgets, and CSS. Copy, save,
programmatic document reads, indexing, and reader rendering must continue to see
the source document, not a rich DOM serialization.

Important code paths:

- `src/editor/render/markdown-render.ts` for standard Markdown decorations.
- `src/editor/render/math-render.ts` for math widgets.
- `src/editor/render/table-render.ts` for table widgets.
- `src/reader/reader.ts` for source-to-reader HTML.

## Layout Must Stay Stable

Cursor movement should not make nearby text jump. Styling that affects line
height belongs on stable line classes or measured line padding, not on active
versus inactive source state. Source marker visibility can change, but the
surrounding line geometry should remain predictable.

This matters most for headings, lists, math, images, tables, and fenced blocks.
When changing those renderers, prefer computed-style or bounding-box tests over
visual inspection alone.

## Pointer Interactions Must Not Reveal Mid-Click

Clicking inactive rendered Markdown can move the cursor into a source span. If
source reveal happens before the click completes, text can shift under the
pointer and turn a click into a selection drag. The markdown renderer freezes
cursor-sensitive reveal during content pointer interactions and rebuilds after
release.

The freeze is local to editor source reveal. It must not block document edits,
programmatic changes, or release events outside the editor.

## Parser Coverage Is Incremental

Lezer parsing may cover only a prefix of a large document during early render.
Renderers that depend on full-document structure must either request enough
syntax coverage for their work or tolerate partial coverage and catch up when
the parser advances.

Relevant code:

- `src/editor/render/syntax-parse-scheduler.ts`
- `src/editor/state/document-analysis.ts`
- `src/editor/state/table-discovery.ts`
- `src/editor/render/code-block-decorations.ts`
- `src/editor/render/container-attributes.ts`

## Widgets Are Explicit Exceptions

Some surfaces deliberately replace source with richer UI: display math, images,
tables, fenced block bodies, and other structured plugin renderers. Those
widgets still represent source ranges and must preserve source round trips.

For widget edits, keep the range mapping explicit. Avoid deriving persisted
Markdown from rendered HTML except where the widget owns that conversion, such
as table cell editing.

## KaTeX Compatibility Is Renderer-Only

HTML rendering may add KaTeX compatibility macros for standard LaTeX commands
that KaTeX does not implement. `\textsc{...}` is one of these: the reader and
editor render it with `cf-katex-small-caps`, but saved Markdown and LaTeX/PDF
export must stay as ordinary `\textsc{...}` source.

## Review And Simplify Loop

For architecture-touching changes:

1. Reproduce or describe the behavior being improved.
2. Make the smallest change that preserves these invariants.
3. Review the patch for removable abstractions or broader-than-needed edits.
4. Verify with targeted tests, and use browser/computed-style checks for visual
   or layout behavior.
