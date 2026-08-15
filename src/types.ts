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
