// Inflate throughput over every intra-chromosomal block of test/data/test.hic,
// at both of its resolutions — the measurement behind "Not
// `DecompressionStream` either" in docs/optimizations.md.
//
// - wasm libdeflate: the shipped path, `inflateRawUnknownSize` once per block,
//   as the read path calls it, since a `.hic` block index records compressed
//   size only.
// - pako: the pure-JS baseline, shipped through v1.0.0.
// - node zlib: the reference floor. No browser has it.
// - `DecompressionStream`: one call per block, because each `.hic` block is its
//   own zlib stream, so the API pays its per-call overhead once per block.
//
// The parent asserts every arm byte-identical, then runs each arm in a fresh
// process so one arm's JIT and GC state cannot skew the next.
//
// Run with `pnpm bench:inflate`, or `pnpm bench:inflate <arm>` for one arm.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

import { inflateRawUnknownSize } from '@gmod/inflate'
import { LocalFile } from 'generic-filehandle2'
import { inflate } from 'pako-esm2'

import { HicFile } from '../src/index.ts'
import { readerFromFilehandle } from '../src/reader.ts'
import { TEST_HIC } from '../test/testFile.ts'

interface Fixture {
  label: string
  blocks: Uint8Array[]
  iterations: number
}

interface Timing {
  label: string
  mean: number
  min: number
}

const WARMUP = 5

/** Every distinct intra-chromosomal block at `binsize`, compressed. */
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

function pako(b: Uint8Array) {
  return inflate(b, {}) as Uint8Array
}

async function wasm(blocks: Uint8Array[]) {
  const out: Uint8Array[] = []
  for (const block of blocks) {
    out.push(await inflateRawUnknownSize(block.subarray(2)))
  }
  return out
}

async function decompressionStream(blocks: Uint8Array[]) {
  const out: Uint8Array[] = []
  for (const block of blocks) {
    const stream = new Blob([block as Uint8Array<ArrayBuffer>])
      .stream()
      .pipeThrough(new DecompressionStream('deflate'))
    out.push(new Uint8Array(await new Response(stream).arrayBuffer()))
  }
  return out
}

const arms: Record<string, (blocks: Uint8Array[]) => Promise<Uint8Array[]>> = {
  'wasm libdeflate (shipped)': wasm,
  pako: blocks => Promise.resolve(blocks.map(pako)),
  'node zlib': blocks => Promise.resolve(blocks.map(b => inflateSync(b))),
  'DecompressionStream (per block)': decompressionStream,
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

async function time(
  run: (blocks: Uint8Array[]) => Promise<Uint8Array[]>,
  { label, blocks, iterations }: Fixture,
): Promise<Timing> {
  for (let i = 0; i < WARMUP; i++) {
    await run(blocks)
  }
  let total = 0
  let min = Infinity
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    await run(blocks)
    const elapsed = performance.now() - start
    total += elapsed
    min = Math.min(min, elapsed)
  }
  return { label, mean: total / iterations, min }
}

const fixtures = [
  await loadBlocks(2_500_000, '2.5 Mb', 200),
  await loadBlocks(100_000, '100 kb', 50),
]

const armName = process.argv[2]

if (armName) {
  const run = arms[armName]
  if (!run) {
    throw new Error(
      `unknown arm "${armName}"; one of: ${Object.keys(arms).join(', ')}`,
    )
  }
  const timings: Timing[] = []
  for (const fixture of fixtures) {
    timings.push(await time(run, fixture))
  }
  console.log(JSON.stringify(timings))
} else {
  for (const fixture of fixtures) {
    const expected = fixture.blocks.map(pako)
    for (const [name, run] of Object.entries(arms)) {
      assertSame(expected, await run(fixture.blocks), name)
    }
    const bytes = expected.reduce((a, b) => a + b.length, 0)
    console.log(
      `${fixture.label}: ${fixture.blocks.length} blocks, ` +
        `${(bytes / 1e6).toFixed(2)} MB inflated, ` +
        `${Math.round(bytes / fixture.blocks.length / 1024)} KB avg`,
    )
  }

  const script = fileURLToPath(import.meta.url)
  const results = new Map<string, Timing[]>()
  for (const name of Object.keys(arms)) {
    const child = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', script, name],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    )
    if (child.status !== 0) {
      throw new Error(`arm "${name}" exited with ${child.status}`)
    }
    results.set(name, JSON.parse(child.stdout) as Timing[])
  }

  for (const [i, fixture] of fixtures.entries()) {
    console.log(`\ninflate ${fixture.label} (${fixture.iterations} iterations)`)
    console.table(
      [...results].map(([name, timings]) => ({
        arm: name,
        'mean ms': Number(timings[i]!.mean.toFixed(3)),
        'min ms': Number(timings[i]!.min.toFixed(3)),
      })),
    )
  }
}
