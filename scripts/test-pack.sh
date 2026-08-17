#!/usr/bin/env bash
# Smoke-test the published artifact by packing and importing it.
#
# `pnpm test` runs ESM against src/, so it cannot see the shape of the tarball
# at all. Two things only this catches:
#
#   1. The CJS half. `dist/` has to resolve `@gmod/inflate` through that
#      package's `require` condition and instantiate its wasm — a runtime
#      dependency the test suite only ever exercises as ESM. Jest consumers
#      reach this package through `dist/`, and a break here ships green.
#   2. Missing or mis-exported files. tsc only emits for what it compiles, so a
#      renamed export or a file left out of `files` shows up here and nowhere
#      else.
#
# Both entry points actually decode a block, because instantiating the wasm is
# the part that fails when resolution is wrong — a bare import would pass.
#
# Run with `pnpm test:pack`.

set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

cd "$PKG_DIR"
TARBALL="$(npm pack --silent --pack-destination "$SCRATCH")"
FIXTURE="$PKG_DIR/test/data/test.hic"

# The three entry points package.json promises, and src/ for consumers that
# compile it themselves.
LISTING="$(tar tzf "$SCRATCH/$TARBALL")"
for f in package/dist/index.js package/esm/index.js package/src/index.ts \
         package/dist/package.json; do
  grep -qx "$f" <<<"$LISTING" || { echo "tarball is missing $f" >&2; exit 1; }
done

cd "$SCRATCH"
cat >package.json <<'JSON'
{
  "name": "hic-pack-test",
  "version": "0.0.0",
  "private": true,
  "type": "module"
}
JSON
npm install --silent --no-audit --no-fund generic-filehandle2 "./$TARBALL" >/dev/null

# A 2.5 Mb whole-chr1 query: one block, one normalization vector, so it runs
# the full read path — header, matrix, block index, inflate, parse, filter —
# for the least IO.
cat >smoke.mjs <<JS
import { HicFile, NO_DATA_FOR_RESOLUTION } from '@gmod/hic'
import { LocalFile } from 'generic-filehandle2'

if (typeof NO_DATA_FOR_RESOLUTION !== 'string') {
  throw new Error('NO_DATA_FOR_RESOLUTION missing from ESM entry')
}
const hic = new HicFile({ filehandle: new LocalFile('$FIXTURE') })
const region = { chr: '1', start: 0, end: 249250621 }
const { records, appliedNormalization } =
  await hic.getContactRecords('KR', region, region, 'BP', 2500000)
if (records.bin1.length !== 3957) {
  throw new Error(\`esm: \${records.bin1.length} contacts, expected 3957\`)
}
if (appliedNormalization !== 'KR') {
  throw new Error(\`esm: normalization came back \${appliedNormalization}\`)
}
console.log(\`esm: \${records.bin1.length} contacts ok\`)
JS

cat >smoke.cjs <<JS
const { HicFile, NO_DATA_FOR_RESOLUTION } = require('@gmod/hic')
;(async () => {
  const { LocalFile } = await import('generic-filehandle2')
  if (typeof NO_DATA_FOR_RESOLUTION !== 'string') {
    throw new Error('NO_DATA_FOR_RESOLUTION missing from CJS entry')
  }
  const hic = new HicFile({ filehandle: new LocalFile('$FIXTURE') })
  const region = { chr: '1', start: 0, end: 249250621 }
  const { records } =
    await hic.getContactRecords('KR', region, region, 'BP', 2500000)
  if (records.bin1.length !== 3957) {
    throw new Error(\`cjs: \${records.bin1.length} contacts, expected 3957\`)
  }
  console.log(\`cjs: \${records.bin1.length} contacts ok\`)
})().catch(e => { console.error(e); process.exit(1) })
JS

node smoke.mjs
node smoke.cjs
