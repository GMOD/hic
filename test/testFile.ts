import { LocalFile } from 'generic-filehandle2'

import { readerFromFilehandle } from '../src/reader.ts'

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
