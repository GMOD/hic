import { describe, expect, test } from 'vitest'

import { binWindow } from '../src/binWindow.ts'
import { HicFile } from '../src/hicFile.ts'
import MatrixZoomData from '../src/matrixZoomData.ts'

import type { Chromosome, HicRegion } from '../src/index.ts'

// A genome browser queries arbitrary viewport windows, so `start % binsize !==
// 0` is the normal case, not the edge one. hic-straw compares bin indices
// against the raw fractional quotients, which silently drops bins overlapping a
// region.

test('a bin overlapping either edge is in the window', () => {
  // binsize 100, region 250-750 → bins 2 (200-300) and 7 (700-800) both overlap
  expect(binWindow({ chr: '1', start: 250, end: 750 }, 100)).toEqual([2, 8])
})

test('a region narrower than one bin still selects the bin containing it', () => {
  expect(binWindow({ chr: '1', start: 210, end: 290 }, 100)).toEqual([2, 3])
})

test('an aligned region is unchanged', () => {
  expect(binWindow({ chr: '1', start: 200, end: 800 }, 100)).toEqual([2, 8])
})

// Stub everything below the record filter: one block holding bins 0..9 on the
// diagonal, so what comes back is purely a function of the bin window.
function fileWithDiagonalBins(n: number) {
  const diagonal = Int32Array.from({ length: n }, (_, i) => i)
  const records = {
    bin1: diagonal,
    bin2: diagonal,
    counts: new Float32Array(n).fill(1),
  }
  const file = new HicFile({
    reader: { read: () => Promise.resolve(new ArrayBuffer(0)) },
  })
  Object.assign(file as unknown as Record<string, unknown>, {
    init: () => Promise.resolve(),
    chromosomeIndexMap: new Map([['1', 0]]),
    getBlocks: () => Promise.resolve([{ blockNumber: 0, records }]),
  })
  return file
}

async function binsIn(region: HicRegion, binsize: number) {
  const { records } = await fileWithDiagonalBins(10).getContactRecords(
    'NONE',
    region,
    region,
    binsize,
  )
  return [...records.bin1]
}

test('the record filter keeps every bin overlapping a non-aligned region', async () => {
  // bin 2 (200-300) overlaps 250-750 and used to be dropped, while bin 7
  // (700-800) — overlapping by the same kind of partial slice at the other end
  // — was kept, so the matrix lost a column only at its left edge
  await expect(
    binsIn({ chr: '1', start: 250, end: 750 }, 100),
  ).resolves.toEqual([2, 3, 4, 5, 6, 7])
})

test('a region narrower than one bin is not an empty matrix', async () => {
  // reachable by locking a coarse binsize from the resolution dropdown while
  // zoomed in; this used to blank the whole display with no error
  await expect(
    binsIn({ chr: '1', start: 210, end: 290 }, 100),
  ).resolves.toEqual([2])
})

// The two halves have to agree: widening the record filter alone still loses
// records whose block was never requested.
describe('block selection covers the same window', () => {
  const chr: Chromosome = { index: 0, name: '1', size: 1_000_000 }
  const BLOCK_BIN_COUNT = 10

  function zoomData(binSize: number) {
    return new MatrixZoomData(
      chr,
      chr,
      { index: 0, unit: 'BP', binSize },
      0,
      BLOCK_BIN_COUNT,
      100,
      {},
    )
  }

  test('a bin past a block boundary pulls in the next block', () => {
    // binsize 100, blockBinCount 10 → block 0 is bins 0-9, block 1 is bins
    // 10-19. Region 500-1050 ends inside bin 10, which lives in block 1;
    // `floor((end/binsize) - 1)` on the fractional quotient stopped at block 0.
    const region = { chr: '1', start: 500, end: 1050 }
    const nums = zoomData(100).getBlockNumbers(region, region, 8)
    // same-chr blocks are keyed row*blockColumnCount + column, spelled out
    // rather than folded so the two expectations read as the same formula
    expect(nums).toContain(0 * 100 + 0)
    expect(nums).toContain(1 * 100 + 1)
  })

  test('a sub-bin region still asks for its block', () => {
    const region = { chr: '1', start: 210, end: 290 }
    expect(zoomData(100).getBlockNumbers(region, region, 8)).toEqual([0])
  })

  test('v9 diagonal selection also covers a sub-bin region', () => {
    const region = { chr: '1', start: 210, end: 290 }
    expect(zoomData(100).getBlockNumbers(region, region, 9)).not.toHaveLength(0)
  })

  // A same-chromosome query is never swapped, so whichever window comes first
  // the selection has to hold every stored contact with one end in each. The
  // block a contact `a <= b` is written to, by Juicer's writer: v8 tiles the
  // triangle by row and column, v9 by position along the diagonal and depth.
  const blockOf = (a: number, b: number, version: number) =>
    version < 9
      ? Math.floor(b / BLOCK_BIN_COUNT) * 100 + Math.floor(a / BLOCK_BIN_COUNT)
      : Math.floor(
          Math.log2(1 + Math.abs(a - b) / Math.SQRT2 / BLOCK_BIN_COUNT),
        ) *
          100 +
        Math.floor((a + b) / 2 / BLOCK_BIN_COUNT)

  const span = (start: number, end: number) => ({ chr: '1', start, end })
  const PAIRS: [string, HicRegion, HicRegion][] = [
    ['nested', span(0, 15_000), span(5_050, 8_000)],
    ['overlapping', span(2_000, 12_000), span(7_000, 19_000)],
    ['disjoint', span(0, 3_000), span(14_000, 19_950)],
  ]

  for (const version of [8, 9]) {
    for (const [name, x, y] of PAIRS) {
      test(`v${version}, ${name}: either order selects every block a contact between the windows is stored in`, () => {
        const zd = zoomData(100)
        const forward = zd.getBlockNumbers(x, y, version)
        const reversed = zd.getBlockNumbers(y, x, version)
        expect([...reversed].sort()).toEqual([...forward].sort())
        const [x1, x2] = binWindow(x, 100)
        const [y1, y2] = binWindow(y, 100)
        const selected = new Set(forward)
        const missing: string[] = []
        for (let p = x1; p < x2; p++) {
          for (let q = y1; q < y2; q++) {
            const block = blockOf(Math.min(p, q), Math.max(p, q), version)
            if (!selected.has(block)) {
              missing.push(`${p},${q}`)
            }
          }
        }
        expect(missing).toEqual([])
      })
    }
  }
})
