// Pure layer: parser, AST, frontmatter, link extraction, citation processing.
// No DOM, no CodeMirror, no React, no KaTeX.
//
// Anything in this layer must be usable from a Node CLI, a server-side
// indexer, a WebWorker, or a non-CM6 editor. The dependency rule is enforced
// by scripts/check-layer-boundary.mjs.
export {};
