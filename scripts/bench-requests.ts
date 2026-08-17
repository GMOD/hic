// Requests reaching the file for a whole-genome fetch, with and without a
// coalescing range cache in front — the measurement behind "Round trips, not
// CPU, are the budget" in docs/optimizations.md.
//
// This is the one number on a remote file that is worth seconds rather than
// milliseconds. A `.hic` block index scatters a fetch across hundreds of small
// ranges, and a browser runs about six requests per origin at a time, so the
// request count divided by six, times the round trip, is the floor on how long
// a cold view takes. Everything this library does on the CPU is a rounding
// error next to it.
//
// `bare` counts what `HicFile` asks the filehandle for. `cached` counts what
// actually leaves, with `@gmod/range-cache-filehandle` in between. The RTT
// column is arithmetic, not a network measurement: requests / 6 * 50 ms.
//
// Run with `pnpm bench:requests`.
import { CachedFilehandle } from '@gmod/range-cache-filehandle'
import { LocalFile } from 'generic-filehandle2'

import { HicFile } from '../src/index.ts'

import type { HicRegion } from '../src/index.ts'

const TEST_HIC = 'test/data/test.hic'
const RTT_MS = 50
const BROWSER_CONCURRENCY = 6

/** Counts below the range cache, so these are real requests. */
class CountingFile extends LocalFile {
  requests = 0
  bytes = 0
  override async read(length: number, position: number) {
    this.requests++
    this.bytes += length
    return super.read(length, position)
  }
}

const meta = await new HicFile({
  filehandle: new LocalFile(TEST_HIC),
}).getMetaData()
const regions = meta.chromosomes
  .filter(c => c.name !== 'ALL')
  .map(c => ({ chr: c.name, start: 0, end: c.size }))
const pairs = regions.flatMap((a, i) => regions.slice(i).map(b => [a, b]))

async function fetchAll(hic: HicFile, binsize: number) {
  await Promise.all(
    pairs.map(async ([r1, r2]) => {
      try {
        return await hic.getContactRecords(
          'KR',
          r1 as HicRegion,
          r2 as HicRegion,
          'BP',
          binsize,
        )
      } catch {
        // No data at this resolution for that pair; it still cost the reads
        // that discovered as much.
        return undefined
      }
    }),
  )
}

const seconds = (requests: number) =>
  ((requests / BROWSER_CONCURRENCY) * RTT_MS) / 1000

console.log(
  `${TEST_HIC} — whole genome, ${regions.length} regions, ${pairs.length} pairs\n`,
)
console.log(
  '| binsize | bare requests | cached requests | bare MB | cached MB |',
)
console.log(
  '| ------- | ------------- | --------------- | ------- | --------- |',
)

const rows: { binsize: number; bare: number; cached: number }[] = []
for (const binsize of meta.resolutions) {
  const bare = new CountingFile(TEST_HIC)
  await fetchAll(new HicFile({ filehandle: bare }), binsize)

  const inner = new CountingFile(TEST_HIC)
  await fetchAll(
    new HicFile({
      // The second argument keys this file's chunks in the shared cache, so it
      // has to identify the bytes. The binsize is in there only to keep the
      // two resolutions in this loop from sharing chunks and flattering the
      // second one.
      filehandle: new CachedFilehandle(inner, `file://${TEST_HIC}#${binsize}`),
    }),
    binsize,
  )

  rows.push({ binsize, bare: bare.requests, cached: inner.requests })
  console.log(
    `| ${binsize / 1000} kb | ${bare.requests} | ${inner.requests} | ` +
      `${(bare.bytes / 1e6).toFixed(1)} | ${(inner.bytes / 1e6).toFixed(1)} |`,
  )
}

console.log(
  `\nAt ${RTT_MS} ms RTT and ${BROWSER_CONCURRENCY} concurrent requests:\n`,
)
for (const { binsize, bare, cached } of rows) {
  console.log(
    `  ${String(binsize / 1000).padStart(4)} kb: ` +
      `${seconds(bare).toFixed(1)} s -> ${seconds(cached).toFixed(1)} s ` +
      `(${Math.round(bare / cached)}x fewer requests)`,
  )
}
