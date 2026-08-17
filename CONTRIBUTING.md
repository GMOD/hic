# Contributing

## Development

```sh
pnpm install
pnpm test --run
pnpm build
```

`pnpm test` on its own is vitest in watch mode, which is what you want while
editing and not what you want in a script — `--run` is the one-shot form CI and
`preversion` use.

`test/data/test.hic` is the hg19 v8 file upstream hic-straw ships as its own
test data. The suites that read it pin real contact counts, so a parse change
that alters output fails loudly.

Use `pnpm version patch/minor/major` to release — it runs lint, format, types,
tests and build, regenerates CHANGELOG.md with git-cliff, then pushes the
version tag which triggers the publish workflow.

## The dataflow diagram

`docs/img/dataflow.svg` is generated from `docs/img/dataflow.dot` and committed,
since GitHub does not render DOT. If you edit the `.dot`, re-render it in the
same commit:

```sh
dot -Tsvg docs/img/dataflow.dot -o docs/img/dataflow.svg
```

Nothing checks this — graphviz is not a dependency and different versions emit
different SVG bytes, so a staleness check would fail on toolchain drift rather
than on a stale diagram.

The palette and legend are shared with `bam-js`, `tabix-js` and `cram-js`; the
`.dot` header says which of their conventions this one keeps and which it drops.
Straighten a divergence rather than matching the outlier.

## Publishing

Releases publish automatically via GitHub Actions using npm trusted publishing
(OIDC, no stored token). The publish job needs `id-token: write` permissions;
npm attaches provenance automatically under trusted publishing.

This repo is already configured — `npm trust list @gmod/hic` shows it. Setting
it up on a new package takes npm 11.15.0 or newer and account-level 2FA:
`npm trust github <pkg> --file publish.yml --repo GMOD/<repo> --allow-publish`.
The package has to exist on the registry first, so a new one's initial version
is published by hand and everything after it comes from CI.

`1.0.0` was that hand-published version and so carries no provenance, and has no
`v1.0.0` tag. **Don't tag it retroactively** — pushing `v1.0.0` would run the
publish job against a version that already exists, fail, and take the GitHub
release job with it (`release` needs `publish`). Releases resume at `1.0.1`.

Note `npm publish` does not build: there is no `prepack`, because CI builds
before publishing. A publish by hand needs `pnpm build` first or it ships
without `dist/` and `esm/`.

Once npm publish succeeds, the `release` job creates the GitHub release for the
tag, taking its notes from that version's CHANGELOG.md section — which
`scripts/release-notes.sh` extracts, so run that with a version to preview what
a release will say.
