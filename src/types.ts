/**
 * The only read this parser needs: `length` bytes at `position`, coming back
 * SHORT at end-of-file rather than throwing — the header walk deliberately
 * reads past the end to discover whether a file carries normalization data at
 * all. `generic-filehandle2` handles behave this way (a remote 416 included),
 * and `readerFromFilehandle` adapts one to this shape.
 */
export interface Reader {
  read: (position: number, length: number) => Promise<ArrayBuffer>
}

/**
 * Progress within one phase: `current` of `total` units done, called as the
 * phase advances and once with `current` 0 before it starts, so a caller can
 * show a determinate bar from the first moment rather than after the first
 * unit lands.
 *
 * The unit is whatever that phase measures — expected-value chunks for the
 * normalization-index walk, blocks for a contact fetch — and a caller renders
 * `current / total` without needing to know which. `total` never changes within
 * a call, and `current` never goes backwards.
 *
 * A phase with nothing to do does not call this at all, rather than calling it
 * with a `total` of 0 that a caller could only divide by.
 */
export type ProgressCallback = (current: number, total: number) => void

/**
 * Progress reporting for one call. Per call rather than per file: progress
 * belongs to the operation a caller is waiting on, and a file-wide callback
 * could not say which of several concurrent fetches it was describing.
 */
export interface ProgressOpts {
  onProgress?: ProgressCallback
}

export interface Chromosome {
  index: number
  name: string
  size: number
}

export interface HicRegion {
  chr: string
  start: number
  end: number
}

export interface Zoom {
  index: number
  unit: string
  binSize: number
}

export interface BlockIndexEntry {
  filePosition: number
  size: number
}

export interface HicMetadata {
  version: number
  genome: string
  chromosomes: Chromosome[]
  resolutions: number[]
}
