import { expect, test } from 'vitest'

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
// chr1's first 20 Mb at this resolution is a single block, which the LRU keeps
// whatever the budget says (see lru.ts).
const region: HicRegion = { chr: '1', start: 0, end: 200_000_000 }

/** Reads issued by a second, identical fetch — the one a pan repeats. */
async function repeatFetchReads(
  blockCacheMaxBytes?: number,
  r: HicRegion = region,
) {
  const file = countingReader(openTestHic())
  const hic = new HicFile({ reader: file, blockCacheMaxBytes })
  const first = await hic.getContactRecords('KR', r, r, 'BP', RES)
  file.state.reads = 0
  const second = await hic.getContactRecords('KR', r, r, 'BP', RES)
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

/**
 * Contacts as a sorted set. Order is not part of the result: `getBlocks` hands
 * back the blocks it had cached before the ones it just read, so the same fetch
 * under a different cache state emits the same records in a different order.
 */
function contactSet({ records }: { records: ContactRecords }) {
  return [...records.bin1]
    .map((b1, i) => `${b1}:${records.bin2[i]}:${records.counts[i]}`)
    .sort()
}

test('the budget changes reads, not records', async () => {
  const tight = await repeatFetchReads(1024)
  const roomy = await repeatFetchReads()

  expect(contactSet(tight.second)).toEqual(contactSet(roomy.second))
  // and the evicting fetch matches its own first pass, so eviction mid-fetch
  // does not drop a block on the floor
  expect(contactSet(tight.first)).toEqual(contactSet(tight.second))
})
