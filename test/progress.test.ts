import { expect, test } from 'vitest'

import { openTestHic } from './testFile.ts'
import { HicFile } from '../src/index.ts'

import type { HicRegion } from '../src/index.ts'

// Whole chr1 of the hg19 test file at 100 kb: 6 blocks, which is enough of them
// to tell a per-block bar from a per-fetch one.
const RES = 100_000
const CHR1: HicRegion = { chr: '1', start: 0, end: 249_250_621 }
// Twice chr1's length asks for the same 6 blocks and 12 more, which is the
// shape of a pan: mostly cached, some to read.
const WIDER: HicRegion = { chr: '1', start: 0, end: 498_501_242 }

function ticker() {
  const ticks: [number, number][] = []
  return {
    ticks,
    onProgress: (current: number, total: number) => {
      ticks.push([current, total])
    },
  }
}

function open() {
  return new HicFile({ reader: openTestHic() })
}

// The walk is the slow part of opening a pre-v9 file — two round trips per
// chunk that no buffer can merge — and the chunk count is known before the
// first of them, so this phase can be a bar rather than a spinner.
test('the normalization-index walk ticks once per expected-value chunk', async () => {
  const hic = open()
  const { ticks, onProgress } = ticker()

  await hic.getNormalizationOptions({ onProgress })

  // 8 chunks: this file carries 4 normalization types over 2 resolutions. The
  // leading 0 is the tick that lands before the first read, so a caller shows a
  // determinate bar from the start instead of after the first round trip.
  expect(ticks).toEqual([
    [0, 8],
    [1, 8],
    [2, 8],
    [3, 8],
    [4, 8],
    [5, 8],
    [6, 8],
    [7, 8],
    [8, 8],
  ])
})

// The walk runs once per file. A second caller is not waiting on reads, so it
// has no progress to be told about — reporting the finished walk's ticks again
// would describe work nobody is doing.
test('a caller joining the finished walk is told nothing', async () => {
  const hic = open()
  await hic.getNormalizationOptions()
  const { ticks, onProgress } = ticker()

  const norms = await hic.getNormalizationOptions({ onProgress })

  expect(norms).toContain('KR')
  expect(ticks).toEqual([])
})

test('a contact fetch ticks once per block', async () => {
  const hic = open()
  const { ticks, onProgress } = ticker()

  const { records } = await hic.getContactRecords('KR', CHR1, CHR1, 'BP', RES, {
    onProgress,
  })

  expect(records.bin1.length).toBe(60109)
  expect(ticks).toEqual([
    [0, 6],
    [1, 6],
    [2, 6],
    [3, 6],
    [4, 6],
    [5, 6],
    [6, 6],
  ])
})

// A block already in the cache is work that is done, not work that is missing.
// Counting only the reads would restart a pan's bar at zero every time it
// reused most of its blocks.
test('cached blocks count as done', async () => {
  const hic = open()
  await hic.getContactRecords('KR', CHR1, CHR1, 'BP', RES)
  const repeat = ticker()

  await hic.getContactRecords('KR', CHR1, CHR1, 'BP', RES, {
    onProgress: repeat.onProgress,
  })

  // Nothing was read, so the one tick is the opening one — already complete.
  expect(repeat.ticks).toEqual([[6, 6]])

  const pan = ticker()
  await hic.getContactRecords('KR', WIDER, WIDER, 'BP', RES, {
    onProgress: pan.onProgress,
  })

  // Starts six-eighteenths of the way along rather than at zero, and the
  // remaining twelve tick as they land.
  expect(pan.ticks.at(0)).toEqual([6, 18])
  expect(pan.ticks.at(-1)).toEqual([18, 18])
  expect(pan.ticks).toHaveLength(13)
})

// Reported completions, not issue order: the reads go out in one wave and land
// in whatever order the file answers them.
test('progress only ever moves forward', async () => {
  const hic = open()
  const { ticks, onProgress } = ticker()

  await hic.getContactRecords('KR', CHR1, CHR1, 'BP', RES, { onProgress })

  const currents = ticks.map(([current]) => current)
  expect(currents).toEqual([...currents].sort((a, b) => a - b))
  expect(new Set(ticks.map(([, total]) => total)).size).toBe(1)
})
