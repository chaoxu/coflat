# Jupiter workflow

`jupiter` is the Linux container host for production-like checks and package
smoke runs. `coflat-editor` is primarily a published package, so this repo only
keeps thin project-specific adapters here. Caddy routes, TLS, Docker volumes,
preview cleanup, backups, and monitoring are host-owned fleet concerns.

This package repo does not need checked-in runtime secrets. If a future demo or
publish job needs environment files, keep them under `/srv/coflat-editor` or
another host-owned path on `jupiter`, not in git.

## Package registry

Published packages go to the Forgejo npm registry on `jupiter`:

```text
http://jupiter:3001/api/packages/chaoxu/npm/
```

Consumers should depend on an explicit `@chaoxu/coflat-editor` version. Normal
Jupiter verification should not depend on a sibling checkout or unpublished
package-manager override.

## Verification

From a checkout on `jupiter`, run:

```sh
pnpm install --frozen-lockfile
pnpm jupiter:verify
```

`pnpm jupiter:verify` builds the package and then runs
`scripts/jupiter-verify.mjs` against `tests/fixtures/coflat-showcase.md`. The
smoke check imports the built reader from `dist/reader.mjs`, verifies the
showcase render, and checks that `dist/editor.css` contains the full-document
reader defaults that downstream hosts can import directly.

Run browser coverage separately when changing interactive editor behavior:

```sh
pnpm test:e2e
```

## Optional previews

This repo does not run a long-lived app service. If a branch needs a visual
preview, use a disposable static fixture or demo container named from the
branch slug and expose it as:

```text
https://coflat-editor-<branch-slug>.lab
```

Any preview container should be labeled for fleet cleanup and should serve only
static demo output or a package showcase. Do not copy Cosheaf's Forgejo data,
SQLite sidecar, webhook, or branch-preview backend scripts into this package
repo.

## Generic infra gaps

If the work uncovers missing Caddy, Docker, runner, registry, cleanup, backup,
or monitoring behavior, file that in `fleet-infra`. Keep this repo limited to
package build, package smoke, and demo/showcase verification.
