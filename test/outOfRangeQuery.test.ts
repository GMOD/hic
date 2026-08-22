import { expect, test } from 'vitest'

import { openTestHic } from './testFile.ts'
import { HicFile } from '../src/index.ts'

import type { HicRegion } from '../src/index.ts'

const RES = 100_000
// hg19 chr1, as this file records it. The assembly a browser pairs the file
// with is free to disagree, which is the whole of the case below.
const CHR1_SIZE = 249_250_621

function open() {
  return new HicFile({ reader: openTestHic() })
}

function region(start: number): HicRegion {
  return { chr: '1', start, end: start + RES }
}

// A `.hic` records its own chromosome sizes, and the assembly a browser draws
// it against records others. When the assembly's is longer, a view of the tail
// of that chromosome asks for bins past everything the file has — and a
// normalization vector is the one thing that used to answer with a RangeError
// rather than with nothing.
//
// 150 Mb past the end, which at this binsize is well past the 1000-bin padding
// `getValues` reads around its window: inside that padding the arithmetic
// stayed positive and the bug did not fire.
test('a region past the end of the chromosome answers empty, not RangeError', async () => {
  const hic = open()

  const { records, appliedNormalization } = await hic.getContactRecords(
    'KR',
    region(CHR1_SIZE + 150_000_000),
    region(CHR1_SIZE + 150_000_000),
    'BP',
    RES,
  )

  expect(records.bin1.length).toBe(0)
  expect(appliedNormalization).toBe('KR')
})

// The empty window is cached like any other, so the guard that decides whether
// to re-read has to see it as covering nothing — otherwise the first
// out-of-range query in a session would poison that chromosome's vector and
// every later in-range fetch would come back empty.
test('an in-range fetch still works after an out-of-range one', async () => {
  const hic = open()

  await hic.getContactRecords(
    'KR',
    region(CHR1_SIZE + 150_000_000),
    region(CHR1_SIZE + 150_000_000),
    'BP',
    RES,
  )
  const whole: HicRegion = { chr: '1', start: 0, end: CHR1_SIZE }
  const { records } = await hic.getContactRecords('KR', whole, whole, 'BP', RES)

  expect(records.bin1.length).toBe(60109)
})
