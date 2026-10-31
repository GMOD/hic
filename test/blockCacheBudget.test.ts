import { SharedBudget } from '@gmod/shared-read-cache'
import { afterEach, expect, test, vi } from 'vitest'

import { openTestHic } from './testFile.ts'
import { HicFile } from '../src/index.ts'

import type { ContactRecords, HicRegion, Reader } from '../src/index.ts'

/**
 * `blockCacheMaxBytes` is the only cache capacity a caller can set, so what it
 * has to hold is that lowering it costs reads and nothing else: a fetch under a
 * budget too small to hold its own blocks must still answer with the same
 * records as one that caches everything.
 */
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

const RES = 100_000
// Six blocks, ~720 KB of contacts, so a small budget has something to evict —
// chr1's first 20 Mb at this resolution is a single block, which the cache keeps
// whatever the budget says.
const region: HicRegion = { chr: '1', start: 0, end: 200_000_000 }

/** Reads issued by a second, identical fetch — the one a pan repeats. */
async function repeatFetchReads(
  blockCacheMaxBytes?: number,
  r: HicRegion = region,
) {
  const file = countingReader(openTestHic())
  const hic = new HicFile({ reader: file, blockCacheMaxBytes })
  const first = await hic.getContactRecords('KR', r, r, RES)
  file.state.reads = 0
  const second = await hic.getContactRecords('KR', r, r, RES)
  return { reads: file.state.reads, first, second }
}

test('the default budget holds a fetch, so repeating it reads nothing', async () => {
  const { reads } = await repeatFetchReads()
  expect(reads).toBe(0)
})

test('a budget too small to hold the blocks re-reads them', async () => {
  const { reads } = await repeatFetchReads(1024)
  expect(reads).toBeGreaterThan(0)
})

test('a lone block outlives a budget smaller than itself', async () => {
  // One block is what the caller just asked for, so evicting it would leave a
  // cache that answers nobody. chr1's first 20 Mb at this resolution is one
  // block of ~229 KB, against a 1 KB budget.
  const { reads } = await repeatFetchReads(1024, {
    chr: '1',
    start: 0,
    end: 20_000_000,
  })
  expect(reads).toBe(0)
})

/** Contacts as a sorted set, since order is not part of the result. */
function contactSet({ records }: { records: ContactRecords }) {
  return [...records.bin1]
    .map((b1, i) => `${b1}:${records.bin2[i]}:${records.counts[i]}`)
    .sort()
}

test('concurrent fetches of one pair read each block once', async () => {
  const file = countingReader(openTestHic())
  const hic = new HicFile({ reader: file })
  await hic.getMetaData()
  await hic.getMatrix(1, 1)
  file.state.reads = 0
  const [a] = await Promise.all([
    hic.getBlocks(region, region, RES),
    hic.getBlocks(region, region, RES),
  ])
  expect(file.state.reads).toBe(a.filter(Boolean).length)
})

test('the budget changes reads, not records', async () => {
  const tight = await repeatFetchReads(1024)
  const roomy = await repeatFetchReads()

  expect(contactSet(tight.second)).toEqual(contactSet(roomy.second))
  // and the evicting fetch matches its own first pass, so eviction mid-fetch
  // does not drop a block on the floor
  expect(contactSet(tight.first)).toEqual(contactSet(tight.second))
})

afterEach(() => {
  vi.useRealTimers()
})

test('blocks join a shared budget, and lowering it re-reads them', async () => {
  const budget = new SharedBudget(Infinity)
  const file = countingReader(openTestHic())
  const hic = new HicFile({ reader: file, blockCacheBudget: budget })
  await hic.getContactRecords('KR', region, region, RES)
  expect(budget.total).toBeGreaterThan(100_000)
  file.state.reads = 0
  budget.limit = 0
  await hic.getContactRecords('KR', region, region, RES)
  expect(file.state.reads).toBeGreaterThan(0)
})

test('a block nothing reads for the idle timeout is dropped', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  const file = countingReader(openTestHic())
  const hic = new HicFile({ reader: file, blockCacheIdleTimeoutMs: 60_000 })
  await hic.getContactRecords('KR', region, region, RES)
  vi.advanceTimersByTime(30_000)
  file.state.reads = 0
  await hic.getContactRecords('KR', region, region, RES)
  expect(file.state.reads).toBe(0)
  vi.advanceTimersByTime(120_000)
  await hic.getContactRecords('KR', region, region, RES)
  expect(file.state.reads).toBeGreaterThan(0)
})

test('blocks idle out after three minutes by default', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  const file = countingReader(openTestHic())
  const hic = new HicFile({ reader: file })
  await hic.getContactRecords('KR', region, region, RES)
  vi.advanceTimersByTime(2 * 60_000)
  file.state.reads = 0
  await hic.getContactRecords('KR', region, region, RES)
  expect(file.state.reads).toBe(0)
  vi.advanceTimersByTime(4 * 60_000)
  await hic.getContactRecords('KR', region, region, RES)
  expect(file.state.reads).toBeGreaterThan(0)
})

test('clearing the cache credits its blocks back to the budget', async () => {
  const budget = new SharedBudget(Infinity)
  const file = countingReader(openTestHic())
  const hic = new HicFile({ reader: file, blockCacheBudget: budget })
  await hic.getContactRecords('KR', region, region, RES)
  hic.clearCache()
  expect(budget.total).toBe(0)
  file.state.reads = 0
  await hic.getContactRecords('KR', region, region, RES)
  expect(file.state.reads).toBeGreaterThan(0)
})
