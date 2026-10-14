# Contributing

## Development

```sh
pnpm install
pnpm test --run
pnpm build
```

`pnpm test` on its own runs vitest in watch mode, for use while editing. CI and
`preversion` run the one-shot `pnpm test --run`.

`test/data/test.hic` is the hg19 v8 file upstream hic-straw ships as its own
test data. The suites that read it pin real contact counts, so a parse change
that alters output fails the tests.

[docs/api.md](docs/api.md) is written by hand, and `test/apiDocs.test.ts` fails
when a public member of `HicFile`, its config and result types, or an export, is
missing from it. Document the new member, or add it to the test's `undocumented`
list with the reason it is internal.

Use `pnpm version patch/minor/major` to release. It runs lint, format, types,
tests and build, regenerates CHANGELOG.md with git-cliff, then pushes the
version tag, which triggers the publish workflow.

## The dataflow diagram

`docs/img/dataflow.svg` is generated from `docs/img/dataflow.dot` and committed,
since GitHub does not render DOT. If you edit the `.dot`, re-render it in the
same commit:

```sh
dot -Tsvg docs/img/dataflow.dot -o docs/img/dataflow.svg
```

CI does not check that the SVG matches the `.dot`. Graphviz is not a
dependency, and different graphviz versions emit different SVG bytes, so such a
check would fail whenever the graphviz version changed, even on an up-to-date
diagram.

The palette and legend are shared with `bam-js`, `tabix-js` and `cram-js`; the
`.dot` header lists which of their conventions this one keeps and which it
drops. Where one repo's diagram diverges, change it to match the others rather
than changing the others to match it.

## Publishing

Releases publish automatically via GitHub Actions using npm trusted publishing
(OIDC, no stored token). The publish job needs `id-token: write` permissions;
npm attaches provenance automatically under trusted publishing.

Trusted publishing is already configured for `@gmod/hic`, as
`npm trust list @gmod/hic` shows. To set it up on a new package, run
`npm trust github <pkg> --file publish.yml --repo GMOD/<repo> --allow-publish`
with npm 11.15.0 or newer and account-level 2FA. The package has to exist on the
registry first, so a maintainer publishes a new package's first version by hand,
and CI publishes every version after it.

`1.0.0` was that hand-published version, so it has no provenance and no
`v1.0.0` tag. **Don't tag it retroactively.** Pushing `v1.0.0` would run the
publish job against a version that already exists, and the publish job would
fail and stop the GitHub release job too (`release` needs `publish`). Releases
resume at `1.0.1`.

`npm publish` does not build the package, because the repo has no `prepack`
script; CI builds before publishing. A publish by hand needs `pnpm build` first,
or it ships without `dist/` and `esm/`.

Once npm publish succeeds, the `release` job creates the GitHub release for the
tag, with notes that `scripts/release-notes.sh` copies from that version's
CHANGELOG.md section. Run the script with a version to preview a release's
notes.
