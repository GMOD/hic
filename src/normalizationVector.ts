import BinaryParser from './binary.ts'

import type { Reader } from './types.ts'

const DOUBLE = 8

export default class NormalizationVector {
  private cache:
    { start: number; end: number; values: Float64Array } | undefined

  private file: Reader
  private filePosition: number
  private nValues: number
  private dataType: number

  constructor(
    file: Reader,
    filePosition: number,
    nValues: number,
    dataType: number,
  ) {
    this.file = file
    this.filePosition = filePosition
    this.nValues = nValues
    this.dataType = dataType
  }

  async getValues(start: number, end: number) {
    // The read below clamps to `nValues`, so the cache can never cover past it.
    // Compare against the clamped bound or a request that runs off the end of
    // the vector — reachable when the assembly's refseq is longer than the size
    // the `.hic` recorded for that chromosome — leaves `end > cache.end` true
    // forever, and every call re-reads the same range from the file.
    const wanted = Math.min(end, this.nValues)
    if (!this.cache || start < this.cache.start || wanted > this.cache.end) {
      const adjustedEnd = Math.min(this.nValues, end + 1000)
      // Clamped against `adjustedEnd`, and not merely against zero, or a window
      // starting past the vector produces a NEGATIVE `n` — and a negative read
      // length reaches the reader as `new Uint8Array(-8)`, a RangeError that
      // fails the whole fetch instead of the empty answer the caller below
      // already handles. The padding is what sets how far past is far enough:
      // more than 1000 bins, which at a fine binsize is not far at all.
      //
      // Reachable exactly where the comment above says: the assembly's refseq
      // is longer than the size the `.hic` recorded for that chromosome, so a
      // view of the tail of it asks for bins the vector never had.
      const adjustedStart = Math.min(Math.max(0, start - 1000), adjustedEnd)
      const startPosition = this.filePosition + adjustedStart * this.dataType
      const n = adjustedEnd - adjustedStart
      // Nothing to read when the window is entirely past the vector, and on a
      // remote file a zero-length range request is still a round trip — one per
      // region pair, on every fetch, for as long as the view stays there.
      const data =
        n > 0
          ? await this.file.read(startPosition, n * this.dataType)
          : new ArrayBuffer(0)
      const parser = new BinaryParser(new DataView(data))
      const values = new Float64Array(n)
      for (let i = 0; i < n; i++) {
        values[i] =
          this.dataType === DOUBLE ? parser.getDouble() : parser.getFloat()
      }
      this.cache = { start: adjustedStart, end: adjustedEnd, values }
    }

    // A view, not a copy: the caller only reads it, and a fetch asks for one of
    // these per chromosome per region pair. Both this and `slice` clamp a
    // request running past the end to what exists, which the caller already
    // handles — an out-of-range index reads undefined, making the product NaN,
    // which the record filter drops.
    const sliceStart = start - this.cache.start
    return this.cache.values.subarray(sliceStart, sliceStart + (end - start))
  }
}
