import { readFile } from 'node:fs/promises'

import { LocalFile } from 'generic-filehandle2'

import { readerFromFilehandle } from '../src/reader.ts'

import type { Reader } from '../src/index.ts'

/** hg19 v8 test file, as shipped by upstream hic-straw. */
export const TEST_HIC = 'test/data/test.hic'

/**
 * The test file as a `Reader`, for the suites that wrap or instrument reads.
 *
 * `LocalFile` answers a read past the end SHORT rather than throwing, which is
 * what `HicFile` needs: the master-index size estimate and the norm-vector
 * index probe both read speculatively past EOF, and the probe reads a
 * zero-length buffer as "this file has no norm vectors".
 */
export function openTestHic() {
  return readerFromFilehandle(new LocalFile(TEST_HIC))
}

/**
 * The test file with every read served out of one buffer.
 *
 * For the suites that count macrotask WAVES. A real fs read is a macrotask of
 * its own, and node runs the timers phase before the poll phase — so when two
 * reads are issued in one wave and only the first has completed, the drain the
 * first schedules fires ahead of the second's completion, and the second's next
 * read is charged to a wave it did not cost. Whether that happens is down to
 * the page cache, which makes the measurement flaky rather than wrong: it was
 * seen once on a cold first run and never again.
 *
 * Reading from a buffer resolves in a microtask, and microtasks drain before
 * any timer, so a wave boundary is decided by the code under test and nothing
 * else.
 */
export async function openTestHicInMemory(): Promise<Reader> {
  const bytes = await readFile(TEST_HIC)
  return {
    read(position: number, length: number) {
      // Short at end of file, not an error, like every `Reader` — the header
      // walk reads past the end on purpose. See `openTestHic`.
      const from = Math.min(position, bytes.byteLength)
      const to = Math.min(position + length, bytes.byteLength)
      return Promise.resolve(
        bytes.buffer.slice(
          bytes.byteOffset + from,
          bytes.byteOffset + Math.max(from, to),
        ),
      )
    },
  }
}
