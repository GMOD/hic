import { expect, test } from 'vitest'

import { HicFile } from '../src/index.ts'
import { TEST_HIC } from './testFile.ts'

import type { HicRegion } from '../src/index.ts'

// A `.hic` stores only the `bin1 <= bin2` half of a chromosome's matrix, and a
// multi-region view queries every displayed pair `(i, j)` in SCREEN order,
// which need not be genomic order, over windows that may overlap or nest. No
// single orientation of such a query covers its rectangle, so every case here
// is checked against the chromosome's whole stored triangle, placed by hand.
//
// These read the real file, because the bugs this pins were ones the
// arithmetic hides: the wrong window still returns contacts, just too few, and
// the display draws that as a sparse off-diagonal block rather than as an
// error.

const RES = 2_500_000
const chr1 = (start: number, end: number): HicRegion => ({
  chr: '1',
  start,
  end,
})
const WHOLE = chr1(0, 249_250_621)
const LEFT = chr1(50_000_000, 150_000_000)
const RIGHT = chr1(100_000_000, 200_000_000)
const FAR_LEFT = chr1(0, 50_000_000)
const NESTED = chr1(50_000_000, 80_000_000)
const INNER = chr1(81_300_000, 101_200_000)

function open() {
  return new HicFile({ path: TEST_HIC })
}

function cells({
  bin1,
  bin2,
  counts,
}: {
  bin1: ArrayLike<number>
  bin2: ArrayLike<number>
  counts: ArrayLike<number>
}) {
  return Array.from(bin1, (b1, i) => `${b1},${bin2[i]},${counts[i]}`).sort()
}

const window = ({ start, end }: HicRegion) =>
  [Math.floor(start / RES), Math.ceil(end / RES)] as const

async function expected(
  norm: string,
  x: HicRegion,
  y: HicRegion,
  both: boolean,
) {
  const { records } = await open().getContactRecords(norm, WHOLE, WHOLE, RES)
  const [x1, x2] = window(x)
  const [y1, y2] = window(y)
  const out: string[] = []
  records.bin1.forEach((a, i) => {
    const b = records.bin2[i]!
    const c = records.counts[i]!
    const fits = a >= x1 && a < x2 && b >= y1 && b < y2
    const mirrorFits = a !== b && b >= x1 && b < x2 && a >= y1 && a < y2
    if (fits) {
      out.push(`${a},${b},${c}`)
    }
    if (mirrorFits && (both || !fits)) {
      out.push(`${b},${a},${c}`)
    }
  })
  return out.sort()
}

const PAIRS: [string, HicRegion, HicRegion][] = [
  ['identical', LEFT, LEFT],
  ['overlapping, genomic order', LEFT, RIGHT],
  ['overlapping, right-to-left', RIGHT, LEFT],
  ['nested, sharing a start', LEFT, NESTED],
  ['nested, sharing a start, reversed', NESTED, LEFT],
  ['nested inside, off-grid', LEFT, INNER],
  ['nested inside, off-grid, reversed', INNER, LEFT],
  ['disjoint', FAR_LEFT, RIGHT],
  ['disjoint, right-to-left', RIGHT, FAR_LEFT],
]

for (const norm of ['NONE', 'KR']) {
  for (const both of [false, true]) {
    for (const [name, x, y] of PAIRS) {
      test(`${name}, ${norm}${both ? ', both orientations' : ''}: every contact of the rectangle, bin1 along region1`, async () => {
        const { records } = await open().getContactRecords(norm, x, y, RES, {
          bothOrientations: both,
        })
        const want = await expected(norm, x, y, both)
        expect(want.length).toBeGreaterThan(0)
        expect(cells(records)).toEqual(want)
      })
    }
  }
}

// Transposing on the windows' starts, as this reader once did, returned none
// of these: a contact stored mirrored lies outside the window it asked for.
test('a nested pair keeps the contacts stored mirrored', async () => {
  const { records } = await open().getContactRecords('NONE', LEFT, NESTED, RES)
  const [, x2] = window(NESTED)
  const mirrored = Array.from(records.bin1).filter(b1 => b1 >= x2)
  expect(mirrored.length).toBeGreaterThan(0)
})

test('an identical pair comes back as its triangle, or with both orientations as its square', async () => {
  const hic = open()
  const triangle = await hic.getContactRecords('NONE', LEFT, LEFT, RES)
  const square = await hic.getContactRecords('NONE', LEFT, LEFT, RES, {
    bothOrientations: true,
  })
  const diagonal = Array.from(triangle.records.bin1).filter(
    (b1, i) => b1 === triangle.records.bin2[i],
  ).length
  expect(square.records.bin1.length).toBe(
    2 * triangle.records.bin1.length - diagonal,
  )
})

test('an inter-chromosomal pair asked either way round comes back along the asked axes', async () => {
  const hic = open()
  const a = { chr: '1', start: 0, end: 249_250_621 }
  const b = { chr: '2', start: 0, end: 243_199_373 }
  const forward = await hic.getContactRecords('NONE', a, b, RES)
  const reversed = await hic.getContactRecords('NONE', b, a, RES)
  expect(forward.records.bin1.length).toBeGreaterThan(0)
  expect(cells(reversed.records)).toEqual(
    cells({
      bin1: forward.records.bin2,
      bin2: forward.records.bin1,
      counts: forward.records.counts,
    }),
  )
})

test('a binsize the pair has no matrix at answers no records, as a missing matrix does', async () => {
  const { records } = await open().getContactRecords(
    'NONE',
    LEFT,
    RIGHT,
    50_000,
  )
  expect(records.bin1.length).toBe(0)
})
