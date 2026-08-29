// This package vs. the real hic-straw package, same whole-genome fetch, both
// driven off the same file through the same kind of counting filehandle — so
// the difference measured is the read path, not the I/O shim. Backs "N times
// fewer requests" in docs/optimizations.md.
//
// Run with `pnpm bench:straw`.
import { LocalFile } from 'generic-filehandle2'
import Straw from 'hic-straw/src/straw.js'

import { HicFile } from '../src/index.ts'

import type { HicRegion } from '../src/index.ts'

const TEST_HIC = 'test/data/test.hic'
const RTT_MS = 50
const BROWSER_CONCURRENCY = 6

/** Counts reads reaching disk, whichever library issues them. */
class CountingFile extends LocalFile {
  requests = 0
  override async read(length: number, position: number) {
    this.requests++
    return super.read(length, position)
  }
}

/** Adapts a `CountingFile` to hic-straw's `{ read(position, length) }` shape. */
class StrawFileAdapter {
  inner: CountingFile
  constructor(inner: CountingFile) {
    this.inner = inner
  }
  async read(position: number, length: number) {
    const bytes = await this.inner.read(length, position)
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    )
  }
}

const meta = await new HicFile({
  filehandle: new LocalFile(TEST_HIC),
}).getMetaData()
const regions: HicRegion[] = meta.chromosomes
  .filter(c => c.name !== 'ALL')
  .map(c => ({ chr: c.name, start: 0, end: c.size }))
const pairs: [HicRegion, HicRegion][] = regions.flatMap((a, i) =>
  regions.slice(i).map((b): [HicRegion, HicRegion] => [a, b]),
)

async function fetchAllOurs(hic: HicFile, binsize: number) {
  let contacts = 0
  await Promise.all(
    pairs.map(async ([r1, r2]) => {
      try {
        const { records } = await hic.getContactRecords(
          'KR',
          r1,
          r2,
          'BP',
          binsize,
        )
        contacts += records.bin1.length
      } catch {
        // No data at this resolution for that pair.
      }
    }),
  )
  return contacts
}

async function fetchAllStraw(straw: Straw, binsize: number) {
  let contacts = 0
  await Promise.all(
    pairs.map(async ([r1, r2]) => {
      try {
        const records = await straw.getContactRecords(
          'KR',
          r1,
          r2,
          'BP',
          binsize,
        )
        contacts += records.length
      } catch {
        // No data at this resolution for that pair.
      }
    }),
  )
  return contacts
}

const seconds = (requests: number) =>
  ((requests / BROWSER_CONCURRENCY) * RTT_MS) / 1000

console.log(
  `${TEST_HIC} — whole genome, ${regions.length} regions, ${pairs.length} pairs\n`,
)
console.log(
  '| binsize | hic-straw requests | this package requests | fewer requests | hic-straw contacts | this package contacts |',
)
console.log(
  '| ------- | ------------------: | ---------------------: | -------------: | -------------------: | ----------------------: |',
)

const rows: { binsize: number; straw: number; ours: number }[] = []
for (const binsize of meta.resolutions) {
  const strawFile = new CountingFile(TEST_HIC)
  const straw = new Straw({ file: new StrawFileAdapter(strawFile) })
  const strawContacts = await fetchAllStraw(straw, binsize)

  const oursFile = new CountingFile(TEST_HIC)
  const ours = new HicFile({ filehandle: oursFile })
  const oursContacts = await fetchAllOurs(ours, binsize)

  rows.push({ binsize, straw: strawFile.requests, ours: oursFile.requests })
  console.log(
    `| ${binsize / 1000} kb | ${strawFile.requests} | ${oursFile.requests} | ` +
      `${(strawFile.requests / oursFile.requests).toFixed(1)}x | ${strawContacts} | ${oursContacts} |`,
  )
}

console.log(
  `\nAt ${RTT_MS} ms RTT and ${BROWSER_CONCURRENCY} concurrent requests:\n`,
)
for (const { binsize, straw, ours } of rows) {
  console.log(
    `  ${String(binsize / 1000).padStart(4)} kb: hic-straw ${seconds(straw).toFixed(1)} s -> this package ${seconds(ours).toFixed(1)} s ` +
      `(${Math.round(straw / ours)}x fewer requests)`,
  )
}
