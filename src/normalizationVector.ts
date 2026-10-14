import BinaryParser from './binary.ts'

import type { BaseOpts, Reader } from './types.ts'

const DOUBLE = 8

interface CachedValues {
  start: number
  end: number
  values: Promise<Float64Array>
}

export default class NormalizationVector {
  // Holds the in-flight read, so the two concurrent `getValues` calls of a
  // same-chromosome pair share one read instead of both missing.
  private cache: CachedValues | undefined

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

  async getValues(
    start: number,
    end: number,
    opts?: BaseOpts,
  ): Promise<Float64Array> {
    // The read clamps to `nValues`, so the cache can never cover past it.
    // Comparing against the clamped bound keeps a request running off the end
    // of the vector (an assembly refseq longer than the `.hic` recorded) from
    // missing forever.
    const wanted = Math.min(end, this.nValues)
    let cache = this.cache
    const joined = !!cache && start >= cache.start && wanted <= cache.end
    if (!cache || !joined) {
      cache = this.readRange(start, end, opts)
      this.cache = cache
      const pending = cache
      pending.values.catch(() => {
        if (this.cache === pending) {
          this.cache = undefined
        }
      })
    }
    let values: Float64Array
    try {
      values = await cache.values
    } catch (e) {
      // The pair that started a joined read passed its own signal, so that
      // pair aborting says nothing about this caller.
      if (!joined || opts?.signal?.aborted) {
        throw e
      }
      return this.getValues(start, end, opts)
    }

    // A view, not a copy. Both this and `subarray` clamp a request running past
    // the end; an out-of-range index reads undefined, the product goes NaN, and
    // the record filter drops it.
    const sliceStart = start - cache.start
    return values.subarray(sliceStart, sliceStart + (end - start))
  }

  private readRange(start: number, end: number, opts?: BaseOpts): CachedValues {
    const adjustedEnd = Math.min(this.nValues, end + 1000)
    // Clamped against `adjustedEnd` too, or a window starting past the vector
    // gives a negative read length, which the reader turns into a RangeError
    // instead of the empty answer the caller handles.
    const adjustedStart = Math.min(Math.max(0, start - 1000), adjustedEnd)
    const n = adjustedEnd - adjustedStart
    return {
      start: adjustedStart,
      end: adjustedEnd,
      values: this.readValues(adjustedStart, n, opts),
    }
  }

  private async readValues(start: number, n: number, opts?: BaseOpts) {
    // A zero-length range request on a remote file is still a round trip.
    if (n <= 0) {
      return new Float64Array(0)
    }
    const data = await this.file.read(
      this.filePosition + start * this.dataType,
      n * this.dataType,
      opts,
    )
    const parser = new BinaryParser(new DataView(data))
    const values = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      values[i] =
        this.dataType === DOUBLE ? parser.getDouble() : parser.getFloat()
    }
    return values
  }
}
