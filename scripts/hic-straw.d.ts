// hic-straw ships no types. This covers only what bench-straw.ts calls.
declare module 'hic-straw/src/straw.js' {
  interface StrawRegion {
    chr: string
    start: number
    end: number
  }

  interface StrawFile {
    read: (position: number, length: number) => Promise<ArrayBuffer>
  }

  interface StrawContactRecord {
    bin1: number
    bin2: number
    counts: number
  }

  export default class Straw {
    constructor(config: { file: StrawFile })
    getContactRecords: (
      normalization: string,
      region1: StrawRegion,
      region2: StrawRegion,
      units: string,
      binsize: number,
    ) => Promise<StrawContactRecord[]>
  }
}
