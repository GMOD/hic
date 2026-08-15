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

**The first publish cannot be a trusted one.** npm requires the package to
already exist on the registry before a trust relationship can be configured
([npm/cli#8544](https://github.com/npm/cli/issues/8544) tracks lifting this).
So the bootstrap, once, is to publish a throwaway version by hand, hang the
trust relationship off it, and let CI cut the first real release:

```sh
# 1. a placeholder, by hand. `pnpm build` is NOT optional — there is no
#    prepack script, so `npm publish` ships whatever is in dist/ and esm/,
#    and on a clean checkout that is nothing at all.
npm version 0.0.1 --no-git-tag-version
pnpm build && npm publish --access public

# 2. now that the package exists, configure trusted publishing
npm trust github @gmod/hic --file publish.yml --repo GMOD/hic

# 3. the real release, from CI, with provenance
pnpm version 1.0.0
npm deprecate @gmod/hic@0.0.1 "bootstrap placeholder, use 1.0.0 or later"
```

`npm trust` requires **npm 11.15.0 or newer** (`npm install -g npm@^11.15.0`)
and account-level 2FA; granular access tokens with the bypass-2FA option are
not accepted.

**Don't hand-publish `1.0.0` and then tag it.** Pushing a `v1.0.0` tag runs the
publish job, which would try to publish a version that already exists, fail, and
take the GitHub release job down with it (`release` needs `publish`). Every
version the repo tags should be one CI published.

Once npm publish succeeds, the `release` job creates the GitHub release for the
tag. Its notes are that version's CHANGELOG.md section, extracted by
`scripts/release-notes.sh` — run that with a version to preview what a release
will say.
