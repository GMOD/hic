// Range reads per fetch, as the displayed region count grows — the measurement
// behind "Caches are sized against the region-pair working set" in
// docs/optimizations.md.
//
// A genome browser fetches every pair of the regions it is showing, so the pair
// count is quadratic in the region count and so is the working set. What this
// prints, per region count:
//
// - cold — reads issued by a fetch against a fresh file.
// - warm — reads issued by an immediately repeated identical fetch, which is
//   what a pan re-issues. This is the number that matters: anything above zero
//   means the fetch evicted entries it was about to need again, so the cache
//   did bookkeeping and returned nothing.
// - the working set, as distinct blocks / matrices / normalization vectors
//   touched. Compare against the capacities: this package uses 1024 blocks
//   (plus a 128 MB budget), 512 matrices and 64 vectors, while hic-straw uses
//   6 / 10 / 10. The region count at which a column passes 6 or 10 is the
//   region count at which upstream's cache inverts.
//
// Reads are counted by wrapping the `Reader`, so this measures what a remote
// file would be charged, with no network in the way.
//
// Run with `pnpm bench:cache`.
import { LocalFile } from 'generic-filehandle2'

import { HicFile } from '../src/index.ts'
import { readerFromFilehandle } from '../src/reader.ts'

import type { HicRegion, Reader } from '../src/index.ts'

const TEST_HIC = 'test/data/test.hic'
const BINSIZE = 2_500_000
const REGION_COUNTS = [4, 5, 10, 24]

function countingReader(inner: Reader) {
  const state = { reads: 0 }
  return {
    state,
    read(position: number, length: number) {
      state.reads++
      return inner.read(position, length)
    },
  }
}

/**
 * Every distinct pair of `regions` — `n(n+1)/2`, the diagonal included. A
 * browser draws both triangles, but a `.hic` stores only the `bin1 <= bin2`
 * half, so the mirrored pair transposes to the same reads.
 */
function pairsOf(regions: HicRegion[]) {
  const pairs: [HicRegion, HicRegion][] = []
  for (const [i, a] of regions.entries()) {
    for (const b of regions.slice(i)) {
      pairs.push([a, b])
    }
  }
  return pairs
}

async function fetchAll(hic: HicFile, pairs: [HicRegion, HicRegion][]) {
  await Promise.all(
    pairs.map(async ([r1, r2]) => {
      try {
        return await hic.getContactRecords('KR', r1, r2, 'BP', BINSIZE)
      } catch {
        // A pair with no data at this resolution is normal at whole-genome
        // scale and still costs the reads that discovered it.
        return undefined
      }
    }),
  )
}

const meta = await new HicFile({
  filehandle: new LocalFile(TEST_HIC),
}).getMetaData()
const chromosomes = meta.chromosomes.filter(c => c.name !== 'ALL')

console.log(`${TEST_HIC} — hg19 v${meta.version}, ${BINSIZE / 1e6} Mb bins\n`)
console.log('| regions | pairs | cold | warm | blocks | matrices | vectors |')
console.log('| ------- | ----- | ---- | ---- | ------ | -------- | ------- |')

for (const n of REGION_COUNTS) {
  const regions = chromosomes.slice(0, n).map(c => ({
    chr: c.name,
    start: 0,
    end: c.size,
  }))
  const pairs = pairsOf(regions)

  const reader = countingReader(readerFromFilehandle(new LocalFile(TEST_HIC)))
  const hic = new HicFile({ reader })

  await fetchAll(hic, pairs)
  const cold = reader.state.reads
  reader.state.reads = 0
  await fetchAll(hic, pairs)
  const warm = reader.state.reads

  // The distinct entries the fetch wanted resident at once. Read off the same
  // keys the caches use, so these are directly comparable to their capacities.
  const blocks = new Set<string>()
  const matrices = new Set<string>()
  const vectors = new Set<string>()
  for (const [r1, r2] of pairs) {
    const i1 = chromosomes.find(c => c.name === r1.chr)!.index
    const i2 = chromosomes.find(c => c.name === r2.chr)!.index
    matrices.add(i1 <= i2 ? `${i1}_${i2}` : `${i2}_${i1}`)
    vectors.add(`KR_${i1}_BP_${BINSIZE}`)
    vectors.add(`KR_${i2}_BP_${BINSIZE}`)
    const zd = (await hic.getMatrix(i1, i2))?.getZoomData(BINSIZE)
    if (zd) {
      const [a, b] = i1 <= i2 ? [r1, r2] : [r2, r1]
      for (const num of zd.getBlockNumbers(a, b, meta.version)) {
        if (zd.blockIndex[num]) {
          blocks.add(`${zd.getKey()}_${num}`)
        }
      }
    }
  }

  console.log(
    `| ${n} | ${pairs.length} | ${cold} | ${warm} | ` +
      `${blocks.size} | ${matrices.size} | ${vectors.size} |`,
  )
}

// The spread the block cache's byte budget exists for: an entry cap bounds
// memory only while entries are interchangeable, and these are not.
console.log('\nBlock sizes, whole-genome diagonal:\n')
console.log('| binsize | blocks | mean | max |')
console.log('| ------- | ------ | ---- | --- |')
for (const binsize of meta.resolutions) {
  const hic = new HicFile({ filehandle: new LocalFile(TEST_HIC) })
  const sizes: number[] = []
  for (const chr of chromosomes) {
    const region = { chr: chr.name, start: 0, end: chr.size }
    for (const block of await hic.getBlocks(region, region, binsize)) {
      if (block) {
        sizes.push(block.records.bin1.length * 12)
      }
    }
  }
  const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length
  console.log(
    `| ${binsize / 1000} kb | ${sizes.length} | ` +
      `${(mean / 1e6).toFixed(3)} MB | ${(Math.max(...sizes) / 1e6).toFixed(3)} MB |`,
  )
}
