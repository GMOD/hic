// Isolated decompression benchmark: the pako path this library ships against
// the alternatives it could have been, over the real compressed blocks of
// test/data/test.hic. Every arm inflates the same zlib streams and the results
// are asserted byte-identical before timing, so this measures inflate
// throughput and nothing else.
//
// - pako — the shipped path (`pako-esm2`).
// - node zlib — the platform's native zlib. Not a candidate implementation; it
//   does not exist in a browser. It is the reference floor, so the others can
//   be read as "how far off native" rather than only against each other.
// - `DecompressionStream` — the platform's own inflate, and the one alternative
//   here that runs in a browser. One call PER BLOCK, because that is the only
//   shape a `.hic` offers: each block is its own zlib stream, not a member of
//   one concatenated stream, so there is nothing to hand it in bulk. Its
//   per-call overhead therefore lands once per block, which is the whole result
//   in docs/optimizations.md.
//
// There is deliberately no wasm libdeflate arm. `bbi-js` has one and it is
// roughly 4x pako on these same blocks, but it does not export its inflate —
// the bundle is private to that package — so this repo cannot reproduce that
// column without vendoring a second copy of the crate, which is exactly the
// cost docs/optimizations.md weighs and declines. Those figures stay attributed
// to bbi-js rather than pretending to be reproducible here.
//
// The two fixtures are every intra-chromosomal block at each of the file's two
// resolutions, which is what "this file's real blocks" means in the docs. They
// differ by ~7x in average block size, and that is the variable that decides
// the `DecompressionStream` arm.
//
// Run with `pnpm benchonly inflate`.
import { inflateSync } from 'node:zlib'

import { LocalFile } from 'generic-filehandle2'
import { inflate } from 'pako-esm2'
import { bench, describe } from 'vitest'

import { HicFile } from '../src/index.ts'
import { readerFromFilehandle } from '../src/reader.ts'
import { TEST_HIC } from '../test/testFile.ts'

interface Fixture {
  label: string
  blocks: Uint8Array[]
  iterations: number
}

/**
 * Every distinct intra-chromosomal block at `binsize`, as raw compressed bytes.
 *
 * Deduplicated on file position: the diagonal of a whole-genome sweep asks for
 * each block once, but reading the index that way is cheaper than special-
 * casing it, and a duplicate would weight one block twice in the timings.
 */
async function loadBlocks(binsize: number, label: string, iterations: number) {
  const reader = readerFromFilehandle(new LocalFile(TEST_HIC))
  const hic = new HicFile({ reader })
  const meta = await hic.getMetaData()

  const byPosition = new Map<number, number>()
  for (const chr of meta.chromosomes.filter(c => c.name !== 'ALL')) {
    const zd = (await hic.getMatrix(chr.index, chr.index))?.getZoomData(binsize)
    if (!zd) {
      continue
    }
    const region = { chr: chr.name, start: 0, end: chr.size }
    for (const num of zd.getBlockNumbers(region, region, meta.version)) {
      const entry = zd.blockIndex[num]
      if (entry) {
        byPosition.set(entry.filePosition, entry.size)
      }
    }
  }

  const blocks: Uint8Array[] = []
  for (const [position, size] of byPosition) {
    blocks.push(new Uint8Array(await reader.read(position, size)))
  }
  return { label, blocks, iterations } satisfies Fixture
}

/** `pako-esm2` is untyped, so it needs the same cast the read path uses. */
function pako(b: Uint8Array) {
  return inflate(b, {}) as Uint8Array
}

function perBlock(
  inflateOne: (b: Uint8Array) => Uint8Array,
  { blocks }: Fixture,
) {
  return blocks.map(inflateOne)
}

/** One call per block — see the header note on why there is no bulk shape. */
async function decompressionStream({ blocks }: Fixture) {
  const out: Uint8Array[] = []
  for (const block of blocks) {
    const stream = new Blob([block as Uint8Array<ArrayBuffer>])
      .stream()
      .pipeThrough(new DecompressionStream('deflate'))
    out.push(new Uint8Array(await new Response(stream).arrayBuffer()))
  }
  return out
}

function assertSame(
  expected: Uint8Array[],
  actual: Uint8Array[],
  what: string,
) {
  if (expected.length !== actual.length) {
    throw new Error(
      `${what}: ${actual.length} blocks, expected ${expected.length}`,
    )
  }
  for (const [i, want] of expected.entries()) {
    const got = actual[i]!
    if (got.length !== want.length) {
      throw new Error(
        `${what}: block ${i} is ${got.length} bytes, expected ${want.length}`,
      )
    }
    for (let j = 0; j < want.length; j++) {
      if (got[j] !== want[j]) {
        throw new Error(`${what}: block ${i} differs at byte ${j}`)
      }
    }
  }
}

const fixtures = [
  await loadBlocks(2_500_000, '2.5 Mb', 200),
  await loadBlocks(100_000, '100 kb', 50),
]

// Arms that disagree are timing nothing. Checked once per fixture, before any
// of them are measured.
for (const fixture of fixtures) {
  const expected = perBlock(pako, fixture)
  assertSame(expected, perBlock(inflateSync, fixture), 'node zlib')
  assertSame(
    expected,
    await decompressionStream(fixture),
    'DecompressionStream',
  )

  const bytes = expected.reduce((a, b) => a + b.length, 0)
  console.log(
    `${fixture.label}: ${fixture.blocks.length} blocks, ` +
      `${(bytes / 1e6).toFixed(2)} MB inflated, ` +
      `${Math.round(bytes / fixture.blocks.length / 1024)} KB avg`,
  )
}

for (const fixture of fixtures) {
  const { label, iterations } = fixture

  describe(`inflate ${label}`, () => {
    bench(
      'pako (shipped)',
      () => {
        perBlock(pako, fixture)
      },
      { iterations, warmupIterations: 5 },
    )

    bench(
      'node zlib',
      () => {
        perBlock(inflateSync, fixture)
      },
      { iterations, warmupIterations: 5 },
    )

    bench(
      'DecompressionStream (per block)',
      async () => {
        await decompressionStream(fixture)
      },
      { iterations, warmupIterations: 5 },
    )
  })
}
