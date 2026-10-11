import { expect, test } from 'vitest'

import { TEST_HIC } from './testFile.ts'
import { HicFile } from '../src/index.ts'

import type { HicRegion } from '../src/index.ts'

const RES = 2_500_000

function whole(chr: string): HicRegion {
  return { chr, start: 0, end: 300_000_000 }
}

async function factors(hic: HicFile, norm: string, chr: string) {
  const nv = await hic.getNormalizationVector(norm, chr, 'BP', RES)
  return nv!.getValues(0, 1000)
}

// Normalizes the raw records by hand, so the reader's output can be checked
// against every raw record rather than against a stored count.
async function expected(
  hic: HicFile,
  norm: string,
  chr1: string,
  chr2: string,
) {
  const raw = await hic.getContactRecords(
    'NONE',
    whole(chr1),
    whole(chr2),
    'BP',
    RES,
  )
  const v1 = await factors(hic, norm, chr1)
  const v2 = await factors(hic, norm, chr2)
  const kept = new Map<string, number>()
  const dropped: number[][] = []
  const { bin1, bin2, counts } = raw.records
  for (let i = 0; i < bin1.length; i++) {
    const f1 = v1[bin1[i]!]!
    const f2 = v2[bin2[i]!]!
    if (f1 === 0 || f2 === 0 || Number.isNaN(f1) || Number.isNaN(f2)) {
      dropped.push([f1, f2])
    } else {
      kept.set(`${bin1[i]},${bin2[i]}`, Math.fround(counts[i]! / (f1 * f2)))
    }
  }
  return { kept, dropped }
}

async function actual(hic: HicFile, norm: string, chr1: string, chr2: string) {
  const res = await hic.getContactRecords(
    norm,
    whole(chr1),
    whole(chr2),
    'BP',
    RES,
  )
  const { bin1, bin2, counts } = res.records
  const kept = new Map<string, number>()
  for (let i = 0; i < bin1.length; i++) {
    kept.set(`${bin1[i]},${bin2[i]}`, counts[i]!)
  }
  return { kept, appliedNormalization: res.appliedNormalization }
}

test('KR leaves out contacts in a bin whose factor is NaN', async () => {
  const hic = new HicFile({ path: TEST_HIC })
  const want = await expected(hic, 'KR', 'Y', 'Y')
  const got = await actual(hic, 'KR', 'Y', 'Y')

  expect(want.dropped.length).toBe(2)
  expect(want.dropped.every(f => f.some(Number.isNaN))).toBe(true)
  expect(got.kept).toEqual(want.kept)
  expect(got.appliedNormalization).toBe('KR')
})

// chrY bin 9 has a VC factor of 0 and nine contacts with chr1.
test('VC leaves out contacts in a bin whose factor is 0', async () => {
  const hic = new HicFile({ path: TEST_HIC })
  const want = await expected(hic, 'VC', '1', 'Y')
  const got = await actual(hic, 'VC', '1', 'Y')

  expect(want.dropped.length).toBe(9)
  expect(want.dropped.every(([, f2]) => f2 === 0)).toBe(true)
  expect(got.kept).toEqual(want.kept)
  expect(got.appliedNormalization).toBe('VC')
})
