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
([npm/cli#8544](https://github.com/npm/cli/issues/8544) tracks lifting this), so
bootstrapping is a three-step sequence, once, by hand:

```sh
npm publish --access public   # signed in, 2FA prompt; this one has no provenance
npm trust github @gmod/hic --file publish.yml --repo GMOD/hic
```

Every release after that goes through CI with OIDC and provenance, and needs
nothing local. `npm trust` requires **npm 11.15.0 or newer**
(`npm install -g npm@^11.15.0`) and account-level 2FA; granular access tokens
with the bypass-2FA option are not accepted.

If having the first _published_ version carry provenance matters more than a
tidy version history, publish a throwaway `0.0.1` by hand instead, configure
trust against it, then release the real version from CI.

Once npm publish succeeds, the `release` job creates the GitHub release for the
tag. Its notes are that version's CHANGELOG.md section, extracted by
`scripts/release-notes.sh` — run that with a version to preview what a release
will say.
