import { readFileSync } from 'node:fs'

import { expect, test } from 'vitest'

import { openTestHic } from './testFile.ts'
import { HicFile } from '../src/index.ts'

import type { ExpectedValues, HicRegion } from '../src/index.ts'

// straw's own observed and observed/expected over test.hic, written by
// scripts/oe-oracle.py: an independent reader, so agreeing with it checks the
// expected-value walk, the chromosome scale factors and the distance window
// rather than restating them.
interface OracleCase {
  region1: { chr: string; start?: number; end?: number }
  region2: { chr: string; start?: number; end?: number }
  binsize: number
  normalization: string
  records: [number, number, number, number][]
}

const CASES = JSON.parse(
  readFileSync('test/data/test.oe.json', 'utf8'),
) as OracleCase[]

function expectedAt(expected: ExpectedValues, bin1: number, bin2: number) {
  return expected.kind === 'inter'
    ? expected.average
    : expected.values[Math.abs(bin2 - bin1) - expected.firstDistance]!
}

test.each(
  CASES.map(c => [
    `${c.region1.chr}x${c.region2.chr} ${c.binsize} ${c.normalization}${c.region1.start === undefined ? '' : ' window'}`,
    c,
  ]),
)('%s matches straw', async (_name, c) => {
  const hic = new HicFile({ reader: openTestHic() })
  const { chromosomes } = await hic.getMetaData()
  const whole = (r: OracleCase['region1']): HicRegion => ({
    chr: r.chr,
    start: r.start ?? 0,
    end: r.end ?? chromosomes.find(chr => chr.name === r.chr)!.size,
  })
  const r1 = whole(c.region1)
  const r2 = whole(c.region2)
  const { records, appliedNormalization } = await hic.getContactRecords(
    c.normalization,
    r1,
    r2,
    c.binsize,
  )
  expect(appliedNormalization).toBe(c.normalization)
  const expected = await hic.getExpectedValues(
    appliedNormalization,
    r1,
    r2,
    c.binsize,
  )
  expect(expected).toBeDefined()

  const observedAt = new Map<string, number>()
  for (let i = 0; i < records.bin1.length; i++) {
    observedAt.set(`${records.bin1[i]}_${records.bin2[i]}`, records.counts[i]!)
  }
  expect(c.records.length).toBeGreaterThan(10)
  for (const [bin1, bin2, observed, oe] of c.records) {
    const ours = observedAt.get(`${bin1}_${bin2}`)
    expect(ours).toBeCloseTo(observed, 2)
    expect(ours! / expectedAt(expected!, bin1, bin2)).toBeCloseTo(oe, 4)
  }
})

test('a normalization with no expected vector at a binsize answers undefined', async () => {
  const hic = new HicFile({ reader: openTestHic() })
  const chr1 = { chr: '1', start: 0, end: 10_000_000 }
  expect(await hic.getExpectedValues('KR', chr1, chr1, 5_000)).toBeUndefined()
  expect(
    await hic.getExpectedValues('NOPE', chr1, chr1, 100_000),
  ).toBeUndefined()
})

test('a distance past the vector holds its last value, as straw clamps', async () => {
  const hic = new HicFile({ reader: openTestHic() })
  const span = { chr: '1', start: 0, end: 249_250_621 }
  const whole = await hic.getExpectedValues('NONE', span, span, 2_500_000)
  // two regions far enough apart that some distances outrun chromosome 1
  const far = await hic.getExpectedValues(
    'NONE',
    { chr: '1', start: 0, end: 2_500_000 },
    { chr: '1', start: 240_000_000, end: 400_000_000 },
    2_500_000,
  )
  expect(whole?.kind).toBe('intra')
  expect(far?.kind).toBe('intra')
  if (whole?.kind === 'intra' && far?.kind === 'intra') {
    const last = whole.values.at(-1)!
    expect(far.values.at(-1)).toBe(last)
  }
})

// test.hic's ALL map: one zoom level, its sumCounts the whole library
test('the total contact count is the ALL map sum', async () => {
  const hic = new HicFile({ reader: openTestHic() })
  expect(await hic.getTotalContacts()).toBe(3217740)
})
