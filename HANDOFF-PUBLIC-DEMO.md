# Coflat Public Demo Handoff

## Current State

- Repo: `/Users/chaoxu/playground/coflat`
- Host used for the work: `saturn`
- Public repo: `https://github.com/chaoxu/coflat`
- Forgejo mirror: `ssh://git@jupiter:2222/chaoxu/coflat.git`
- Live Pages URL: `https://chaoxu.prof/coflat/`
- Current deployed commit: `12d7813 Use Cosheaf showcase and stabilize table editing`

The public Pages demo is intentionally editor-only. It mounts one Coflat editor directly into `<body class="cf-theme-scope"><div id="editor"></div>`, with no wrapper pane, no reader pane, and no editor header chrome. Normal browser window scrolling must remain available so a long document can be edited from top to bottom.

## Important Files

- `examples/simple/index.html`
  - Minimal editor-only shell.
- `examples/simple/main.ts`
  - Mounts the editor with the showcase document.
  - Provides a small read-only browser `FileSystem` through `fileSystemFacet` so public demo assets can resolve.
- `examples/simple/style.css`
  - Minimal page-level styles. Avoid reintroducing viewport-height grid wrappers or `overflow: hidden` containers around the editor.
- `examples/simple/showcase.md`
  - Public showcase document, adapted from Cosheaf's `server/seed-fixtures.ts` `coflatFeatureShowcase`.
- `examples/simple/public/reference.bib`
  - Bibliography fixture for the showcase.
- `examples/simple/public/showcase/hover-preview-figure.svg`
  - Local image fixture for the showcase.
- `src/editor/render/table-widget-dom.ts`
  - Locks active table cell width/min-height before replacing rendered content with an inline editor.
- `src/editor/render/table-widget-session.ts`
  - Clears the temporary geometry lock when the inline editor is destroyed.
- `src/editor/render/table-widget.test.ts`
  - Regression test for active table-cell geometry locking.

## Why The Last Fixes Happened

1. The earlier demo fixture was too weak. It did not exercise the same Coflat surfaces as Cosheaf's seed data. The showcase now includes frontmatter, headings, labeled equations, theorem/proof/proposition/problem/remark blocks, nested fenced divs, rich tables, task lists, code blocks, local images, citations, and footnotes.

2. Scrolling broke because the demo wrapper used a viewport-height grid pane and `overflow: hidden`, then forced `.cm-editor` to `height: 100%`. That trapped the editor in the wrong scroll model. The wrapper was removed.

3. Table cells resized during editing because rendered cell content such as `O(n log n)` was replaced by raw source such as `$O(n \log n)$`, which has a different intrinsic width. The fix measures the rendered cell and temporarily applies `width`, `min-width`, `max-width`, and `min-height` while the inline cell editor is active.

## Verification Already Run

Local checks:

```sh
rtk pnpm typecheck
rtk pnpm lint
rtk pnpm build:pages
rtk pnpm test -- src/editor/render/table-widget.test.ts
```

Browser checks:

- Local demo loaded at `http://127.0.0.1:5190/`.
- Production demo loaded at `https://chaoxu.prof/coflat/?v=12d7813`.
- Normal window scrolling reaches the bottom footnotes.
- Production table-edit probe reported `resizeDeltas: []`.
- Local/prod image fixture rendered through the demo filesystem.
- Only observed production console error was Cloudflare beacon `ERR_CONNECTION_CLOSED`, not app code.

GitHub Pages:

- Workflow run `26717843632` completed successfully for commit `12d7813`.
- GitHub Actions currently emits a Node 20 action-runtime deprecation annotation. It is not a deployment failure, but should be cleaned up before GitHub's forced Node 24 switch matters.

## Watch Items

- Do not reintroduce demo wrapper chrome unless there is a scroll test proving the whole long document remains reachable.
- If table rendering is refactored, keep active-cell geometry stable across rendered-source transitions.
- The showcase is copied/adapted from Cosheaf seed content, not imported from Cosheaf. If Cosheaf's canonical seed improves, update this fixture intentionally.
- `examples/simple/main.ts` imports `fileSystemFacet` through an internal source path. That is fine for the in-repo Pages demo, but public consumers should use exported package APIs rather than copying that pattern.
- Chunk-size warnings remain in `build:pages`; they predate this handoff and are not a functional failure.

## Useful Commands For The Next Agent

```sh
cd /Users/chaoxu/playground/coflat
git status --short --branch
rtk pnpm typecheck
rtk pnpm lint
rtk pnpm build:pages
rtk pnpm test -- src/editor/render/table-widget.test.ts
rtk pnpm dev:pages --host 127.0.0.1
```

For production status:

```sh
gh run list --repo chaoxu/coflat --workflow pages.yml --limit 5
gh run view 26717843632 --repo chaoxu/coflat --json conclusion,status,headSha,url
```
