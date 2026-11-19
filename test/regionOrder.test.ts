import { expect, test } from 'vitest'

import { HicFile } from '../src/index.ts'
import { TEST_HIC } from './testFile.ts'

import type { HicRegion } from '../src/index.ts'

// A `.hic` stores only the `bin1 <= bin2` half, so `getContactRecords` swaps a
// query whose x window sits right of its y window, then swaps the records back
// so `bin1` runs along `region1` whatever the order. A multi-region view is
// what makes the swap reachable in every direction: it queries every displayed
// pair `(i, j)` in SCREEN order, which need not be genomic order, and the
// displayed regions may overlap.
//
// These read the real file, because the bug this pins was one the arithmetic
// hides: the wrong window still returns contacts, just far too few, and the
// display draws that as a sparse off-diagonal block rather than as an error.

const RES = 2_500_000
const chr1 = (start: number, end: number): HicRegion => ({
  chr: '1',
  start,
  end,
})

// Two overlapping windows on chr1: 50-150Mb and 100-200Mb.
const LEFT = chr1(50_000_000, 150_000_000)
const RIGHT = chr1(100_000_000, 200_000_000)
// Disjoint, for the case the original `start >= end` test already handled.
const FAR_LEFT = chr1(0, 50_000_000)

function open() {
  return new HicFile({ path: TEST_HIC })
}

async function records(region1: HicRegion, region2: HicRegion, res = RES) {
  const { records: recs } = await open().getContactRecords(
    'NONE',
    region1,
    region2,
    res,
  )
  return {
    n: recs.bin1.length,
    bin1: [...recs.bin1],
    bin2: [...recs.bin2],
    counts: [...recs.counts],
  }
}

const inWindow = (bins: number[], { start, end }: HicRegion) =>
  bins.every(b => b >= Math.floor(start / RES) && b < Math.ceil(end / RES))

test('an overlapping same-chr pair asked right-to-left comes back along the asked axes', async () => {
  const genomic = await records(LEFT, RIGHT)
  const displayed = await records(RIGHT, LEFT)

  // The pair holds real off-diagonal signal, so a dropped window is visible in
  // the count rather than being an empty-vs-empty comparison.
  expect(genomic.n).toBe(901)

  // Comparing `region1.start` against `region2.END` — hic-straw's test — leaves
  // this un-transposed and asks for the half of the matrix the file does not
  // store, which returned the 78 contacts of the overlap sliver and silently
  // dropped the other 823.
  expect(displayed.n).toBe(genomic.n)
  expect(displayed.bin1).toEqual(genomic.bin2)
  expect(displayed.bin2).toEqual(genomic.bin1)
  expect(displayed.counts).toEqual(genomic.counts)
  expect(inWindow(displayed.bin1, RIGHT)).toBe(true)
  expect(inWindow(displayed.bin2, LEFT)).toBe(true)
})

test('a disjoint same-chr pair asked right-to-left comes back along the asked axes', async () => {
  const genomic = await records(FAR_LEFT, RIGHT)
  const displayed = await records(RIGHT, FAR_LEFT)

  expect(genomic.n).toBeGreaterThan(0)
  expect(displayed.n).toBe(genomic.n)
  expect(displayed.bin1).toEqual(genomic.bin2)
  expect(inWindow(displayed.bin1, RIGHT)).toBe(true)
  expect(inWindow(displayed.bin2, FAR_LEFT)).toBe(true)
})

test('forward order and a pair sharing a start keep bin1 along region1', async () => {
  const forward = await records(LEFT, RIGHT)
  expect(inWindow(forward.bin1, LEFT)).toBe(true)
  expect(inWindow(forward.bin2, RIGHT)).toBe(true)
  // Equal starts must not transpose: a `>=` would swap a pair sharing a start
  // but not an end, and the swap back would then hand `bin1` the wrong window.
  const shared = chr1(50_000_000, 80_000_000)
  const sharedStart = await records(LEFT, shared)
  expect(sharedStart.n).toBeGreaterThan(0)
  expect(inWindow(sharedStart.bin2, shared)).toBe(true)
})

test('a binsize the pair has no matrix at answers no records, as a missing matrix does', async () => {
  expect((await records(LEFT, RIGHT, 50_000)).n).toBe(0)
})
