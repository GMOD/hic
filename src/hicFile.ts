import { inflateRawUnknownSize } from '@gmod/inflate'
import { SharedReadCache, throwIfAborted } from '@gmod/shared-read-cache'
import { LocalFile } from 'generic-filehandle2'

import { binWindow } from './binWindow.ts'
import BinaryParser from './binary.ts'
import BufferedFile from './bufferedFile.ts'
import LRU from './lru.ts'
import Matrix from './matrix.ts'
import NormalizationVector from './normalizationVector.ts'
import { readerFromFilehandle } from './reader.ts'

import type { ContactRecords } from './contactRecords.ts'
import type MatrixZoomData from './matrixZoomData.ts'
import type {
  BaseOpts,
  BlockIndexEntry,
  Chromosome,
  HicMetadata,
  HicRegion,
  ProgressOpts,
  Reader,
} from './types.ts'
import type { GenericFilehandle } from 'generic-filehandle2'

/**
 * Prefix of the error thrown when a region pair has no matrix at the requested
 * binsize. A caller fetching many region pairs at once will want to drop that
 * pair rather than fail the whole fetch, and it can only tell this apart from a
 * real failure by the message — so it is exported instead of hand-copied.
 */
export const NO_DATA_FOR_RESOLUTION = 'No data available for resolution'

const Short_MIN_VALUE = -32768
const DOUBLE = 8
const FLOAT = 4
const INT = 4

interface MasterIndexEntry {
  start: number
  size: number
}

interface NormVectorIndex {
  entries: Record<string, BlockIndexEntry>
  types: string[]
}

interface SignalOpts extends ProgressOpts {
  signal: AbortSignal
}

export interface HicConfig {
  /** a `generic-filehandle2` handle, e.g. `RemoteFile` for a URL */
  filehandle?: GenericFilehandle
  /** a local path, node only */
  path?: string
  /** any object that can read `length` bytes at `position` */
  reader?: Reader
  /**
   * `"position,size"` of the normalization vector index, if it is known. Skips
   * the walk through the expected-value vectors that locating it otherwise
   * costs on a pre-v9 file.
   */
  nvi?: string
  /**
   * Ceiling on the decompressed contacts the block cache holds, in bytes.
   * Defaults to 128 MB. Lower it where the budget is tight and re-reading is
   * cheaper than the memory; raising it buys nothing once a fetch's working set
   * fits, since the entry cap bounds the cache too.
   */
  blockCacheMaxBytes?: number
}

// Cached blocks are the decompressed records and nothing else. hic-straw also
// hung the MatrixZoomData and the block-index entry off each Block; neither was
// ever read back, and the zoom data pinned a whole `blockIndex` record per
// cached block for the lifetime of the LRU.
interface Block {
  blockNumber: number
  records: ContactRecords
}

/**
 * Copy a partially-filled decode buffer down to its true length, or hand it
 * back untouched when the filter dropped nothing. A `subarray` would be free
 * but keeps the whole oversized buffer reachable, and these land in a cache
 * that outlives the fetch.
 */
function truncateRecords(records: ContactRecords, n: number): ContactRecords {
  return n === records.bin1.length
    ? records
    : {
        bin1: records.bin1.slice(0, n),
        bin2: records.bin2.slice(0, n),
        counts: records.counts.slice(0, n),
      }
}

// Every cache here is sized against the same thing, and it is worth stating
// once: a fetch's working set is a function of the DISPLAYED REGION COUNT, and
// two of the three grow with its square.
//
// A multi-region view queries every `(i, j)` pair with `i <= j`, so N displayed
// regions is N(N+1)/2 pairs — a whole-genome human view is 24 regions and 300
// pairs. Each pair needs one matrix and its blocks; each region needs one
// normalization vector per chromosome. Sized for one region, these caches don't
// merely underperform, they invert: the entries a fetch will need again are
// evicted by the same fetch, so the cache costs eviction bookkeeping and
// returns nothing.
//
// Measured on `test/data/test.hic` (hg19, 2.5 Mb, 24 regions / 300 pairs),
// range reads for a fetch and then an identical repeat fetch — which is what
// every pan issues:
//
//   N   pairs |  before      |  after
//    4     10 |    29 /   0  |    29 /   0
//    5     15 |    40 /  15  |    40 /   0
//   10     55 |   130 / 110  |   130 /   0
//   24    300 |  1106 /1106  |   648 /   0
//
// The cliffs are exactly these three capacities. Note the first column: 41% of a
// cold whole-genome fetch's reads were re-reads of normalization vectors the
// same fetch had already fetched.
const BLOCK_CACHE_MAX_ENTRIES = 1024
// The bound the entry cap was standing in for. Blocks became struct-of-arrays
// (see contactRecords.ts), so a cached contact is 12 bytes of untraced
// ArrayBuffer rather than ~55 on the GC-traced heap — but a block still holds
// every contact in its bin square, which is the one thing here that can hold
// real memory, and block sizes vary by more than an order of magnitude with
// binsize. Measured on the file above: 0.05 MB at 2.5 Mb, 0.23 MB at 100 kb. So
// the entry cap now tracks the working set and this tracks the memory, instead
// of one number answering both badly. See LRU's WeightOpts.
//
// This is the one capacity here a caller can override (`blockCacheMaxBytes`),
// because it is the only one that bounds MEMORY. The two entry caps below are
// working-set sizes derived from how many region pairs a fetch runs at once,
// which the library knows and the caller would only have to rederive.
const BLOCK_CACHE_MAX_BYTES = 128 * 1024 * 1024
// One entry per (chrIdx1, chrIdx2), so the working set is the pair count.
// 512 covers a 31-region view; human whole-genome is 300. A matrix holds the
// block index for each of its BP zoom levels, which is small beside a block.
const MATRIX_CACHE_SIZE = 512
// One entry per (type, chrIdx, unit, binsize), so the working set is the
// displayed CHROMOSOME count, not the pair count — 64 covers a whole-genome
// human view twice over, which is the headroom a zoom step needs (binsize is in
// the key, so every entry misses at a new resolution). Entries are cheap:
// `NormalizationVector` retains only the queried slice ±1000 values.
const NORM_VECTOR_CACHE_SIZE = 64

// Keyed by `${zd.getKey()}_${blockNumber}`, which already carries the binsize,
// so no separate resolution generation is needed to keep entries apart —
// hic-straw's extra `resolution` field only made the cache single-resolution
// (every zoom step threw the previous level away).
function blockCacheWeight(block: Block) {
  const { bin1, bin2, counts } = block.records
  return bin1.byteLength + bin2.byteLength + counts.byteLength
}

function getNormalizationVectorKey(
  type: string,
  chrIdx: number,
  unit: string,
  resolution: number,
) {
  return `${type}_${chrIdx}_${unit}_${resolution}`
}

export class HicFile {
  private config: HicConfig
  private file: Reader

  // These caches share the in-flight read, not just its result. A
  // multi-region fetch runs its region pairs concurrently and they share
  // chromosomes, so caching only the result had every concurrent pair miss and
  // re-issue the same reads — measured +12 range requests on a 6-pair fetch.
  // `SharedReadCache` cancels a shared read only once every caller waiting on
  // it has aborted, and drops a rejection so the next caller retries.
  private headerCache = new SharedReadCache<string, void>()
  private normVectorIndexCache = new SharedReadCache<
    string,
    NormVectorIndex | undefined
  >()
  private normVectorCache = new SharedReadCache<
    string,
    NormalizationVector | undefined
  >({ maxSize: NORM_VECTOR_CACHE_SIZE })
  private matrixCache = new SharedReadCache<string, Matrix | undefined>({
    maxSize: MATRIX_CACHE_SIZE,
  })
  // Assigned in the constructor rather than here, since its byte budget is
  // configurable and a field initializer cannot see `config`.
  private blockCache: LRU<string, Block>
  private normVectorIndexPosition = -1
  private normVectorIndexSize = -1

  private version = 0
  private genomeId = ''
  private footerPosition = 0
  // Where the file's normalization data begins, and so also where a file
  // carrying none of it ends. Public so a test can cut a real file there to
  // make that second shape.
  normExpectedValueVectorsPosition: number | undefined

  private chromosomes: Chromosome[] = []
  private chromosomeIndexMap: Record<string, number> = {}
  private chrAliasTable: Record<string, string> = {}
  private bpResolutions: number[] = []
  private masterIndex: Record<string, MasterIndexEntry> = {}
  private meta: HicMetadata | undefined

  constructor(config: HicConfig) {
    const { filehandle, path, reader, blockCacheMaxBytes } = config
    this.config = config
    this.blockCache = new LRU<string, Block>(BLOCK_CACHE_MAX_ENTRIES, {
      maxBytes: blockCacheMaxBytes ?? BLOCK_CACHE_MAX_BYTES,
      weigh: blockCacheWeight,
    })
    if (reader) {
      this.file = reader
    } else if (filehandle) {
      this.file = readerFromFilehandle(filehandle)
    } else if (path) {
      this.file = readerFromFilehandle(new LocalFile(path))
    } else {
      throw new Error('must supply filehandle, path, or reader')
    }
  }

  async init(opts?: BaseOpts) {
    return this.headerCache.get('header', opts?.signal, signal =>
      this.readHeaderAndFooter(signal),
    )
  }

  async getMetaData(opts?: BaseOpts) {
    await this.init(opts)
    return this.meta!
  }

  // Parsed into locals and committed only at the end: a parse every caller
  // abandoned can still be running beside the one that replaced it, and a
  // transient failure part-way through must leave nothing half-written for the
  // retry to append to.
  private async readHeaderAndFooter(signal: AbortSignal) {
    let data = await this.file.read(0, 16, { signal })
    if (data.byteLength === 0) {
      throw new Error('File content is empty')
    }
    let binaryParser = new BinaryParser(new DataView(data))
    binaryParser.getString() // magic
    const version = binaryParser.getInt()
    if (version < 5) {
      throw new Error(`Unsupported hic version: ${version}`)
    }
    const footerPosition = binaryParser.getLong()

    const { masterIndex, normExpectedValueVectorsPosition } =
      await this.readFooter(version, footerPosition, signal)

    const bodyPosition = Object.values(masterIndex).reduce(
      (min, entry) => Math.min(min, entry.start),
      Number.MAX_VALUE,
    )

    data = await this.file.read(16, bodyPosition - 16, { signal })
    binaryParser = new BinaryParser(new DataView(data))

    const genomeId = binaryParser.getString()

    let normVectorIndexPosition = -1
    let normVectorIndexSize = -1
    if (version >= 9) {
      normVectorIndexPosition = binaryParser.getLong()
      normVectorIndexSize = binaryParser.getLong()
    }

    let nAttributes = binaryParser.getInt()
    while (nAttributes-- > 0) {
      binaryParser.getString() // attribute key
      binaryParser.getString() // attribute value
    }

    const chromosomes: Chromosome[] = []
    const chromosomeIndexMap: Record<string, number> = {}
    let nChrs = binaryParser.getInt()
    let i = 0
    while (nChrs-- > 0) {
      const chr = {
        index: i,
        name: binaryParser.getString(),
        size: version < 9 ? binaryParser.getInt() : binaryParser.getLong(),
      }
      chromosomes.push(chr)
      chromosomeIndexMap[chr.name] = chr.index
      i++
    }

    const bpResolutions: number[] = []
    let nBpResolutions = binaryParser.getInt()
    while (nBpResolutions-- > 0) {
      bpResolutions.push(binaryParser.getInt())
    }

    const chrAliasTable: Record<string, string> = {}
    for (const chrName of Object.keys(chromosomeIndexMap)) {
      if (chrName.startsWith('chr')) {
        chrAliasTable[chrName.slice(3)] = chrName
      } else if (chrName === 'MT') {
        chrAliasTable.chrM = chrName
      } else {
        chrAliasTable[`chr${chrName}`] = chrName
      }
    }

    throwIfAborted(signal)
    this.version = version
    this.footerPosition = footerPosition
    this.masterIndex = masterIndex
    this.normExpectedValueVectorsPosition = normExpectedValueVectorsPosition
    this.genomeId = genomeId
    this.normVectorIndexPosition = normVectorIndexPosition
    this.normVectorIndexSize = normVectorIndexSize
    this.chromosomes = chromosomes
    this.chromosomeIndexMap = chromosomeIndexMap
    this.bpResolutions = bpResolutions
    this.chrAliasTable = chrAliasTable
    this.meta = {
      version,
      genome: genomeId,
      chromosomes,
      resolutions: bpResolutions,
    }
  }

  private async readFooter(
    version: number,
    footerPosition: number,
    signal: AbortSignal,
  ) {
    const skip = version < 9 ? 8 : 12
    let data = await this.file.read(footerPosition, skip, { signal })

    let binaryParser = new BinaryParser(new DataView(data))
    // Total size, master index + expected values
    const nBytes = version < 9 ? binaryParser.getInt() : binaryParser.getLong()
    let nEntries = binaryParser.getInt()

    // Estimate the size of the master index. String key length is unknown, be
    // conservative (100 bytes).
    const miSize = nEntries * (100 + 64 + 32)
    data = await this.file.read(
      footerPosition + skip,
      Math.min(miSize, nBytes),
      { signal },
    )
    binaryParser = new BinaryParser(new DataView(data))

    const masterIndex: Record<string, MasterIndexEntry> = {}
    while (nEntries-- > 0) {
      const key = binaryParser.getString()
      const pos = binaryParser.getLong()
      const size = binaryParser.getInt()
      masterIndex[key] = { start: pos, size }
    }

    // Normalized expected values start after the expected values
    const normExpectedValueVectorsPosition =
      version > 5 ? footerPosition + (version < 9 ? 4 : 8) + nBytes : undefined
    return { masterIndex, normExpectedValueVectorsPosition }
  }

  async getMatrix(chrIdx1: number, chrIdx2: number, opts?: BaseOpts) {
    await this.init(opts)
    return this.matrixCache.get(
      Matrix.getKey(chrIdx1, chrIdx2),
      opts?.signal,
      signal => this.readMatrix(chrIdx1, chrIdx2, signal),
    )
  }

  private async readMatrix(
    chrIdx1: number,
    chrIdx2: number,
    signal: AbortSignal,
  ) {
    const idx = this.masterIndex[Matrix.getKey(chrIdx1, chrIdx2)]
    let matrix: Matrix | undefined
    if (idx) {
      const data = await this.file.read(idx.start, idx.size, { signal })
      matrix = Matrix.parseMatrix(data, this.chromosomes)
    }
    return matrix
  }

  async getContactRecords(
    normalization: string,
    region1: HicRegion,
    region2: HicRegion,
    units: string,
    binsize: number,
    opts?: ProgressOpts,
  ) {
    await this.init(opts)

    const idx1 = this.chromosomeIndexMap[this.getFileChrName(region1.chr)]
    const idx2 = this.chromosomeIndexMap[this.getFileChrName(region2.chr)]

    // A `.hic` stores only `bin1 <= bin2`, so a query whose x window sits to the
    // right of its y window has to be swapped or it asks for the half of the
    // matrix that does not exist. The same-chromosome test compares **starts**,
    // not this region's start against the other's end: upstream hic-straw used
    // `region1.start >= region2.end`, which catches a reversed pair only while
    // the two are disjoint, and a multi-region view is free to display two
    // *overlapping* regions of one chromosome right-to-left. Measured on
    // chr1 at 2.5 Mb, `(100-200Mb, 50-150Mb)` returned 78 contacts against 901
    // for the same pair in genomic order — everything but the overlap sliver
    // silently missing, which renders as a sparse off-diagonal block rather
    // than as an error. Comparing starts fires on both the disjoint and the
    // overlapping case and leaves forward order (and an identical pair) alone.
    const transpose =
      idx1 !== undefined &&
      idx2 !== undefined &&
      (idx1 > idx2 || (idx1 === idx2 && region1.start > region2.start))
    const r1 = transpose ? region2 : region1
    const r2 = transpose ? region1 : region2

    const [x1, x2] = binWindow(r1, binsize)
    const [y1, y2] = binWindow(r2, binsize)

    // Two independent read chains, so they run concurrently rather than in
    // sequence. The normalization vectors are keyed on (type, chr, unit,
    // binsize) and the blocks on the region pair; neither reads anything the
    // other produces, and awaiting them in order made every pair pay the SUM of
    // their round-trip depths instead of the deeper of the two.
    //
    // Both are two hops — norm-vector header then its values, matrix header then
    // its blocks — so a pair went 4 sequential waves deep where 2 will do
    // (`readChainDepth.test.ts` measures this against the real file). That is
    // the everyday single-region fetch; a multi-region view then runs several
    // pairs at a time on top of it. This loop is latency-bound, not CPU-bound.
    //
    // Vectors are loop-invariant across blocks either way, so they are still
    // resolved once per pair rather than per block, each paired with the bin
    // offset its values start at.
    const [norm, blocks] = await Promise.all([
      this.getNormVectors(normalization, r1, r2, units, binsize, opts),
      // The measurable half of the pair: blocks are counted and the two norm
      // vectors are not, because the vector chain is two hops whatever the
      // query and the block chain is the one that grows with the region.
      this.getBlocks(r1, r2, binsize, opts),
    ])
    throwIfAborted(opts?.signal)

    // Sum of the blocks' record counts bounds the survivors, so the output is
    // allocated once and filled by a write cursor. Blocks overlap the window
    // rather than nest in it, so the true count isn't known without either this
    // upper bound or a counting pre-pass over the same data.
    let capacity = 0
    for (const block of blocks) {
      if (block) {
        capacity += block.records.bin1.length
      }
    }
    const outBin1 = new Int32Array(capacity)
    const outBin2 = new Int32Array(capacity)
    const outCounts = new Float32Array(capacity)
    let n = 0

    for (const block of blocks) {
      // An undefined block is most likely a base-pair range outside the
      // chromosome
      if (!block) {
        continue
      }
      const { bin1, bin2, counts } = block.records
      const len = bin1.length
      // `norm` is loop-invariant, so it selects the loop rather than being
      // retested per record — which also hoists the vector/offset reads
      if (norm) {
        const { v1, v2, offset1, offset2 } = norm
        for (let i = 0; i < len; i++) {
          const b1 = bin1[i]!
          const b2 = bin2[i]!
          if (b1 >= x1 && b1 < x2 && b2 >= y1 && b2 < y2) {
            const nvnv = v1[b1 - offset1]! * v2[b2 - offset2]!
            if (nvnv !== 0 && !Number.isNaN(nvnv)) {
              outBin1[n] = b1
              outBin2[n] = b2
              outCounts[n] = counts[i]! / nvnv
              n++
            }
          }
        }
      } else {
        for (let i = 0; i < len; i++) {
          const b1 = bin1[i]!
          const b2 = bin2[i]!
          if (b1 >= x1 && b1 < x2 && b2 >= y1 && b2 < y2) {
            outBin1[n] = b1
            outBin2[n] = b2
            outCounts[n] = counts[i]!
            n++
          }
        }
      }
    }

    // Views, not copies: a caller concatenating several pairs' results copies
    // into its own exactly-sized arrays anyway.
    const contactRecords: ContactRecords = {
      bin1: outBin1.subarray(0, n),
      bin2: outBin2.subarray(0, n),
      counts: outCounts.subarray(0, n),
    }

    // What was actually applied, which is not always what was asked for:
    // normalization vectors are stored per (type, chr, unit, binsize), so a file
    // can offer KR at 5kb and nothing at 2.5Mb. hic-straw warns to the console
    // and silently hands back raw counts; reporting it lets a display tell the
    // user which scheme they are actually looking at.
    //
    // `transposed` says the query was swapped, so `bin1` runs along `region2`.
    // Reported rather than left for the caller to re-derive: it is decided here
    // from this file's own alias table and chromosome indices, and a caller
    // re-deriving it off a divergent chr-name scheme would silently un-swap the
    // wrong axis.
    return {
      records: contactRecords,
      appliedNormalization: norm ? normalization : 'NONE',
      transposed: transpose,
    }
  }

  private async getNormVectors(
    normalization: string,
    r1: HicRegion,
    r2: HicRegion,
    units: string,
    binsize: number,
    opts?: BaseOpts,
  ) {
    const signalOpts = { signal: opts?.signal }
    let result:
      | {
          v1: Float64Array
          v2: Float64Array
          offset1: number
          offset2: number
        }
      | undefined
    if (normalization && normalization !== 'NONE') {
      const chr1 = this.getFileChrName(r1.chr)
      const chr2 = this.getFileChrName(r2.chr)
      const offset1 = Math.floor(r1.start / binsize)
      const offset2 = Math.floor(r2.start / binsize)
      const nv1 = await this.getNormalizationVector(
        normalization,
        chr1,
        units,
        binsize,
        signalOpts,
      )
      const nv2 =
        chr1 === chr2
          ? nv1
          : await this.getNormalizationVector(
              normalization,
              chr2,
              units,
              binsize,
              signalOpts,
            )
      if (nv1 && nv2) {
        result = {
          v1: await nv1.getValues(
            offset1,
            Math.ceil(r1.end / binsize),
            signalOpts,
          ),
          v2: await nv2.getValues(
            offset2,
            Math.ceil(r2.end / binsize),
            signalOpts,
          ),
          offset1,
          offset2,
        }
      }
    }
    return result
  }

  async getBlocks(
    region1: HicRegion,
    region2: HicRegion,
    binSize: number,
    opts?: ProgressOpts,
  ) {
    const blockKey = (blockNumber: number, zd: MatrixZoomData) =>
      `${zd.getKey()}_${blockNumber}`

    await this.init(opts)
    const chr1 = this.getFileChrName(region1.chr)
    const chr2 = this.getFileChrName(region2.chr)
    const idx1 = this.chromosomeIndexMap[chr1]
    const idx2 = this.chromosomeIndexMap[chr2]

    let blocks: (Block | undefined)[] = []
    if (idx1 === undefined) {
      console.warn(`No chromosome named: ${region1.chr}`)
    } else if (idx2 === undefined) {
      console.warn(`No chromosome named: ${region2.chr}`)
    } else {
      // A chr pair with no matrix at all is routine, not an anomaly: plenty of
      // .hic files store no inter-chromosomal maps, and a multi-region view asks
      // for every pair. Answering with no blocks, rather than warning once per
      // pair per fetch, leaves that for the caller to notice or ignore.
      const signalOpts = { signal: opts?.signal }
      const matrix = await this.getMatrix(idx1, idx2, signalOpts)
      if (matrix) {
        const zd = matrix.getZoomData(binSize)
        if (!zd) {
          throw new Error(
            `${NO_DATA_FOR_RESOLUTION}: ${binSize} for map ${region1.chr}-${region2.chr}`,
          )
        }

        const blockNumbers = zd.getBlockNumbers(region1, region2, this.version)
        const blockNumbersToQuery: number[] = []
        for (const num of blockNumbers) {
          const cached = this.blockCache.get(blockKey(num, zd))
          if (cached) {
            blocks.push(cached)
          } else {
            blockNumbersToQuery.push(num)
          }
        }

        // Cached blocks are already done, not absent: a pan that reuses most
        // of its blocks reads most of the way along rather than restarting at
        // zero, which is what the bar should say — the work left is the reads.
        //
        // A query covering no blocks at all reports nothing rather than `0, 0`:
        // there is no fraction in it, and a caller dividing would get NaN.
        const { onProgress } = opts ?? {}
        let done = blocks.length
        if (blockNumbers.length > 0) {
          onProgress?.(done, blockNumbers.length)
        }
        // Still one `Promise.all`, so every block is still issued in one wave:
        // what a remote file pays is round-trip DEPTH, and counting the
        // completions must not turn one wave into a queue. `readChainDepth`
        // pins that.
        const newBlocks = await Promise.all(
          blockNumbersToQuery.map(async blockNumber => {
            const block = await this.readBlock(blockNumber, zd, signalOpts)
            done++
            onProgress?.(done, blockNumbers.length)
            return block
          }),
        )
        for (const block of newBlocks) {
          if (block) {
            this.blockCache.set(blockKey(block.blockNumber, zd), block)
          }
        }
        blocks = blocks.concat(newBlocks)
      }
    }
    return blocks
  }

  async readBlock(blockNumber: number, zd: MatrixZoomData, opts?: BaseOpts) {
    const idx = zd.blockIndex[blockNumber]

    let block: Block | undefined
    if (idx) {
      const data = await this.file.read(idx.filePosition, idx.size, {
        signal: opts?.signal,
      })
      throwIfAborted(opts?.signal)
      // `.subarray(2)` drops the zlib header: libdeflate's raw-deflate path is
      // the fast one, and a `.hic` records only a block's *compressed* size, so
      // there is no known output size to hand the exact-size entry point.
      // `inflateRawUnknownSize` guesses 4x the input, which clears this
      // format's ~2.3x ratio in one pass.
      const plain = await inflateRawUnknownSize(
        new Uint8Array(data).subarray(2),
      )
      const parser = new BinaryParser(
        new DataView(plain.buffer, plain.byteOffset, plain.byteLength),
      )
      // Total records in the block, whatever encoding follows — so every branch
      // below knows its exact (or, for the dense encoding, upper-bound) size
      // before it starts reading and never has to grow an array.
      const nRecords = parser.getInt()
      block = { blockNumber, records: this.parseBlockRecords(parser, nRecords) }
    }
    return block
  }

  /**
   * Decode one block's records straight into typed arrays.
   *
   * Every encoding here knows its length up front, so each array is allocated
   * once and filled by a write cursor. Where a filter can drop records (the
   * dense encoding's empty cells) the arrays are sized to the upper bound and
   * copied down to the true length at the end — blocks are cached for the life
   * of the session, so it is worth one memcpy not to pin an oversized buffer.
   */
  private parseBlockRecords(
    parser: BinaryParser,
    nRecords: number,
  ): ContactRecords {
    if (this.version < 7) {
      const bin1 = new Int32Array(nRecords)
      const bin2 = new Int32Array(nRecords)
      const counts = new Float32Array(nRecords)
      for (let i = 0; i < nRecords; i++) {
        bin1[i] = parser.getInt()
        bin2[i] = parser.getInt()
        counts[i] = parser.getFloat()
      }
      return { bin1, bin2, counts }
    }

    const binXOffset = parser.getInt()
    const binYOffset = parser.getInt()

    const useFloatContact = parser.getByte() === 1
    const useIntXPos = this.version < 9 ? false : parser.getByte() === 1
    const useIntYPos = this.version < 9 ? false : parser.getByte() === 1
    const type = parser.getByte()

    if (type === 1) {
      // List-of-rows representation. The rows partition the block's records, so
      // `nRecords` sizes the arrays exactly; the overflow check is a
      // corrupt-file guard, not a growth path.
      const bin1 = new Int32Array(nRecords)
      const bin2 = new Int32Array(nRecords)
      const counts = new Float32Array(nRecords)
      let n = 0
      const rowCount = useIntYPos ? parser.getInt() : parser.getShort()
      for (let i = 0; i < rowCount; i++) {
        const dy = useIntYPos ? parser.getInt() : parser.getShort()
        const binY = binYOffset + dy
        const colCount = useIntXPos ? parser.getInt() : parser.getShort()
        if (n + colCount > nRecords) {
          throw new Error(
            `hic block declares ${nRecords} records but its rows hold more`,
          )
        }
        for (let j = 0; j < colCount; j++) {
          bin1[n] =
            binXOffset + (useIntXPos ? parser.getInt() : parser.getShort())
          bin2[n] = binY
          counts[n] = useFloatContact ? parser.getFloat() : parser.getShort()
          n++
        }
      }
      return truncateRecords({ bin1, bin2, counts }, n)
    }

    if (type === 2) {
      // Dense representation: `nPts` counts every cell of the w-wide rectangle,
      // empty ones included, so it is an upper bound on the surviving records.
      const nPts = parser.getInt()
      const w = parser.getShort()
      const bin1 = new Int32Array(nPts)
      const bin2 = new Int32Array(nPts)
      const counts = new Float32Array(nPts)
      let n = 0
      for (let i = 0; i < nPts; i++) {
        // read unconditionally: the parser advances a fixed stride per cell
        // whether or not the cell holds a value
        const c = useFloatContact ? parser.getFloat() : parser.getShort()
        // NaN (float) and Short_MIN_VALUE (int) are the "no value" markers
        if (useFloatContact ? !Number.isNaN(c) : c !== Short_MIN_VALUE) {
          const row = Math.floor(i / w)
          bin1[n] = binXOffset + (i - row * w)
          bin2[n] = binYOffset + row
          counts[n] = c
          n++
        }
      }
      return truncateRecords({ bin1, bin2, counts }, n)
    }

    throw new Error(`Unknown block type: ${type}`)
  }

  async getNormalizationVector(
    type: string,
    chr: string,
    unit: string,
    binSize: number,
    opts?: BaseOpts,
  ) {
    await this.init(opts)

    const chrIdx = this.chromosomeIndexMap[this.getFileChrName(chr)]
    if (chrIdx === undefined) {
      return undefined
    }
    const key = getNormalizationVectorKey(type, chrIdx, unit, binSize)

    // Sharing the in-flight read is what keeps concurrent region pairs sharing
    // one vector: a chromosome appears in every pair it takes part in, so with a
    // result-only cache each of those pairs missed while the first was still in
    // flight and read the header again — and then held its own
    // `NormalizationVector`, whose value cache is per instance, so the whole
    // vector was re-read too.
    //
    // A file with no vectors at all, or none for this (type, chr, unit,
    // binsize), simply answers undefined and the caller falls back to raw
    // counts. hic-straw warns to the console here; that fires once per
    // chromosome per region pair per fetch, and the console is the wrong place
    // for it anyway — `getContactRecords` reports the normalization it actually
    // applied instead.
    return this.normVectorCache.get(key, opts?.signal, signal =>
      this.readNormalizationVector(key, signal),
    )
  }

  private async readNormalizationVector(key: string, signal: AbortSignal) {
    const idx = (await this.getNormVectorIndex({ signal }))?.[key]
    if (!idx) {
      return undefined
    }
    const data = await this.file.read(idx.filePosition, 8, { signal })
    const parser = new BinaryParser(new DataView(data))
    const nValues = this.version < 9 ? parser.getInt() : parser.getLong()
    const dataType = this.version < 9 ? DOUBLE : FLOAT
    const filePosition =
      this.version < 9 ? idx.filePosition + 4 : idx.filePosition + 8
    return new NormalizationVector(this.file, filePosition, nValues, dataType)
  }

  async getNormVectorIndex(opts?: ProgressOpts) {
    return (await this.getParsedNormVectorIndex(opts))?.entries
  }

  private async getParsedNormVectorIndex(opts?: ProgressOpts) {
    // await init() before the version gate, not after: this class defaults
    // `version` to 0, so checking it before the header is parsed would answer
    // "no index" for every file rather than for a v5 one.
    await this.init(opts)
    if (this.version < 6) {
      return undefined
    }
    // Memoize the *attempt*, not just a populated result. A legal (if uncommon)
    // v8 file with no norm vectors has no index, and re-running the discovery
    // on every call cost two calls per region pair per fetch, each walking the
    // whole normalized-expected-values section with a chain of sequential range
    // reads, only to rediscover there is nothing there.
    //
    // The walk runs once, so its progress belongs to the call that performs
    // it: the fill is per call, so a caller joining an in-flight or finished
    // load is not waiting on reads and is told nothing.
    return this.normVectorIndexCache.get('nvi', opts?.signal, signal =>
      this.loadNormVectorIndex({ signal, onProgress: opts?.onProgress }),
    )
  }

  private async loadNormVectorIndex(opts: SignalOpts) {
    if (this.normVectorIndexPosition > 0 && this.normVectorIndexSize > 0) {
      return this.readNormVectorIndex(
        {
          start: this.normVectorIndexPosition,
          size: this.normVectorIndexSize,
        },
        opts.signal,
      )
    } else if (this.config.nvi) {
      const nviArray = decodeURIComponent(this.config.nvi).split(',')
      return this.readNormVectorIndex(
        {
          start: parseInt(nviArray[0]!),
          size: parseInt(nviArray[1]!),
        },
        opts.signal,
      )
    } else {
      try {
        return await this.readNormExpectedValuesAndNormVectorIndex(opts)
      } catch (e) {
        throwIfAborted(opts.signal)
        // Not "expected if the file has no norm vectors" — that case never
        // arrives here. hic-straw's own IO threw a 416 for a read past EOF and
        // this caught it; `generic-filehandle2` deliberately turns a 416 into an
        // empty read so callers detect EOF from a short buffer instead of
        // needing a stat, and LocalFile/BlobFile clamp for the same reason. So
        // the read side owns that case now, and anything reaching here is a real
        // failure worth printing.
        console.error(e)
        return undefined
      }
    }
  }

  async getNormalizationOptions(opts?: ProgressOpts) {
    return (await this.getParsedNormVectorIndex(opts))?.types ?? ['NONE']
  }

  private async readNormVectorIndex(
    range: { start: number; size: number },
    signal: AbortSignal,
  ) {
    const data = await this.file.read(range.start, range.size, { signal })
    const binaryParser = new BinaryParser(new DataView(data))
    const index: NormVectorIndex = { entries: {}, types: ['NONE'] }
    let nEntries = binaryParser.getInt()
    while (nEntries-- > 0) {
      this.parseNormVectorEntry(binaryParser, index)
    }
    return index
  }

  // Used when the position of the norm vector index is unknown: read through
  // the expected values to find the index.
  private async readNormExpectedValuesAndNormVectorIndex(opts: SignalOpts) {
    const { signal } = opts
    let index: NormVectorIndex | undefined
    if (this.normExpectedValueVectorsPosition !== undefined) {
      const nviStart = await this.skipExpectedValues(
        this.normExpectedValueVectorsPosition,
        opts,
      )
      let byteCount = INT

      let data = await this.file.read(nviStart, INT, { signal })
      // Possible if there are no norm vectors. A legal v8 file, though uncommon.
      if (data.byteLength !== 0) {
        const binaryParser = new BinaryParser(new DataView(data))
        const nEntries = binaryParser.getInt()
        const sizeEstimate = nEntries * 30
        data = await this.file.read(nviStart + byteCount, sizeEstimate, {
          signal,
        })
        const found: NormVectorIndex = { entries: {}, types: ['NONE'] }

        const processEntries = async (remaining: number, buf: ArrayBuffer) => {
          const parser = new BinaryParser(new DataView(buf))
          let n = remaining
          while (n-- > 0) {
            if (parser.available() < 100) {
              n++ // Reset counter as entry is not processed
              byteCount += parser.position
              const est = Math.max(1000, n * 30)
              const more = await this.file.read(nviStart + byteCount, est, {
                signal,
              })
              await processEntries(n, more)
              return
            }
            this.parseNormVectorEntry(parser, found)
          }
          byteCount += parser.position
        }

        await processEntries(nEntries, data)
        throwIfAborted(signal)
        this.config.nvi = `${nviStart},${byteCount}`
        index = found
      }
    }
    return index
  }

  // Used when the position of the norm vector index is unknown: skip the
  // normalized expected values to find the index.
  private async skipExpectedValues(start: number, opts: SignalOpts) {
    const { signal, onProgress } = opts
    const version = this.version
    const file = new BufferedFile({ file: this.file, size: 256000 })
    const data = await file.read(start, INT, { signal })
    // A file with no normalization at all ends where this section would start,
    // so the count this is about to read is past EOF. That is the same "no norm
    // vectors" case `readNormExpectedValuesAndNormVectorIndex` guards its own
    // read for, and it has to be caught HERE too, because this runs first:
    // a v9 file that records no norm-vector-index position takes the v8
    // discovery path, and that path starts by skipping a section that isn't
    // there. Answering `start` leaves the caller's guard to do the rest.
    if (data.byteLength < INT) {
      return start
    }
    const binaryParser = new BinaryParser(new DataView(data))
    const nEntries = binaryParser.getInt() // Total # of expected value chunks

    // Skip one chunk, answering where the next one starts.
    //
    // Its two reads land a whole expected-value vector apart — one per bin of
    // the genome, so tens of MB at a fine binsize — which is further than the
    // buffer reaches. On a remote file that is two round trips per chunk that
    // nothing can merge, and it is why this walk, not the index it is looking
    // for, is the slow part of opening a pre-v9 file. It is also why the chunk
    // is the unit worth counting: `nEntries` of them, known before the first
    // read, each costing about the same.
    const skipChunk = async (chunkStart: number) => {
      let chunkSize = 0

      let buf = await file.read(chunkStart, 500, { signal })
      let parser = new BinaryParser(new DataView(buf))
      parser.getString() // type
      parser.getString() // unit
      parser.getInt() // binSize
      const nValues = version < 9 ? parser.getInt() : parser.getLong()
      chunkSize += parser.position + nValues * (version < 9 ? DOUBLE : FLOAT)

      buf = await file.read(chunkStart + chunkSize, INT, { signal })
      parser = new BinaryParser(new DataView(buf))
      const nChrScaleFactors = parser.getInt()
      chunkSize +=
        INT + nChrScaleFactors * (INT + (version < 9 ? DOUBLE : FLOAT))

      return chunkStart + chunkSize
    }

    // A loop rather than the tail recursion this was, because the position is
    // the only thing carried between chunks and a counter now rides along with
    // it. Chunks must be walked in order — each one's size is only known once
    // the one before it has been parsed — so the awaits are sequential by
    // nature, not by oversight.
    if (nEntries > 0) {
      onProgress?.(0, nEntries)
    }
    let position = start + INT
    for (let done = 0; done < nEntries; done++) {
      position = await skipChunk(position)
      onProgress?.(done + 1, nEntries)
    }
    return position
  }

  private parseNormVectorEntry(
    binaryParser: BinaryParser,
    index: NormVectorIndex,
  ) {
    const type = binaryParser.getString() // 15
    const chrIdx = binaryParser.getInt() // 4
    const unit = binaryParser.getString() // 3
    const binSize = binaryParser.getInt() // 4
    const filePosition = binaryParser.getLong() // 8
    const sizeInBytes =
      this.version < 9 ? binaryParser.getInt() : binaryParser.getLong() // 4:8
    const key = `${type}_${chrIdx}_${unit}_${binSize}`

    if (!index.types.includes(type)) {
      index.types.push(type)
    }
    index.entries[key] = { filePosition, size: sizeInBytes }
  }

  getFileChrName(chrAlias: string) {
    return this.chrAliasTable[chrAlias] ?? chrAlias
  }
}
