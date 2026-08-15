# Contributing

## Development

```sh
pnpm install
pnpm test
pnpm build
```

`test/data/test.hic` is the hg19 v8 file upstream hic-straw ships as its own
test data. The suites that read it pin real contact counts, so a parse change
that alters output fails loudly.

Use `pnpm version patch/minor/major` to release — it runs lint, tests, and
build, regenerates the changelog with git-cliff, then pushes the version tag
which triggers the publish workflow.

## Publishing

Releases publish automatically via GitHub Actions using npm trusted publishing
(OIDC, no stored token). The publish job needs `id-token: write` permissions;
npm attaches provenance automatically under trusted publishing.

To set up the package the first time, with npm 11.10.0 or newer and 2FA on:
`npm trust github @gmod/hic --file publish.yml --repo GMOD/hic`.

Once npm publish succeeds, the `release` job creates the GitHub release for the
tag. Its notes are that version's CHANGELOG.md section, extracted by
`scripts/release-notes.sh` — run that with a version to preview what a release
will say.
