// Reader layer: HTML rendering, math hydration (lazy KaTeX), sanitization.
// Depends only on core/. No CodeMirror, no React.
//
// Reader output must be safe to inject into a browser DOM and to render in a
// WebWorker (no `document` / `window` access at module top level).
export {};
