# API

## `new HicFile(config)`

| option       | type                | description                                         |
| ------------ | ------------------- | --------------------------------------------------- |
| `filehandle` | `GenericFilehandle` | a `generic-filehandle2` handle (`RemoteFile`, …)    |
| `path`       | `string`            | a local path, Node only                             |
| `reader`     | `Reader`            | anything with `read(position, length)`              |
| `nvi`        | `string`            | `"position,size"` of the normalization vector index |

Pass exactly one of `filehandle`, `path` or `reader`. The file reads nothing
until the first call; every caller that arrives while the header parse is in
flight shares it, and a failure retries.

`nvi` is optional and only matters for pre-v9 files, which do not record where
their normalization vector index lives. Without it the parser finds that
position by walking the expected-value vectors — a chain of small sequential
reads, paid once per file. A v9 file records the position in its header and
skips the walk.

## `getMetaData(): Promise<HicMetadata>`

```ts
{
  version: number          // 5 and up
  genome: string           // e.g. 'hg19'
  chromosomes: { index: number; name: string; size: number }[]
  resolutions: number[]    // bin sizes, in bp, largest first
}
```

## `getContactRecords(normalization, region1, region2, units, binsize)`

The main read. `region1` is the x axis and `region2` the y axis; a region is
`{ chr, start, end }` with 0-based half-open coordinates. `units` is `'BP'`.
`normalization` is one of `getNormalizationOptions()`, or `'NONE'`.

```ts
{
  records: {
    bin1: Int32Array // bin index along region1's chromosome
    bin2: Int32Array // bin index along region2's chromosome
    counts: Float32Array // contact count, normalized if a vector applied
  }
  appliedNormalization: string
  transposed: boolean
}
```

The three arrays are parallel and always exactly the same length —
`bin1.length` is the record count. Bin indices are absolute for their
chromosome: multiply by `binsize` for a genomic coordinate.

The result covers every bin **overlapping** the requested region, edge-
straddling ones included, so a region narrower than one bin still comes back
with that bin.

`appliedNormalization` names the scheme the file actually applied. A file stores
normalization vectors per (type, chromosome, unit, binsize), so a request for
`'KR'` at a resolution that has no KR vector comes back as `'NONE'` with raw
counts rather than failing.

`transposed` says the reader swapped the query, because a `.hic` stores only the
`bin1 <= bin2` half of the matrix. When it is true, `bin1` runs along `region2`
and `bin2` along `region1`. It fires when `region1` sits to the right of
`region2` — a higher chromosome index, or the same chromosome and a later
start.

An alias table built from the file's own names resolves chromosome names, so
`'1'` and `'chr1'` both work whichever the file uses.

Throws an error beginning with `NO_DATA_FOR_RESOLUTION` (exported) if the region
pair has a matrix but no data at `binsize`. A caller fetching many pairs at once
will usually want to drop that pair rather than fail the whole fetch, which is
why the package exports the constant instead of leaving callers to hand-copy the
string.

A chromosome pair with no matrix at all — plenty of files store no
inter-chromosomal maps — returns no records instead of throwing.

## `getNormalizationOptions(): Promise<string[]>`

The normalization types this file carries, always starting with `'NONE'`, e.g.
`['NONE', 'VC', 'VC_SQRT', 'KR', 'SCALE']`. The list falls out of loading the
normalization vector index, so the first call may read.

## Lower-level

These are public because they are useful, not because they are the intended
entry point: `getMatrix`, `getBlocks`, `readBlock`, `getNormalizationVector`,
`getNormVectorIndex`, `getFileChrName`.

## Exported types

`HicConfig`, `HicMetadata`, `HicRegion`, `Chromosome`, `Zoom`,
`ContactRecords`, `Reader`.

## `readerFromFilehandle(filehandle): Reader`

Adapts a `generic-filehandle2` handle — `read(length, position)` returning a
`Uint8Array` — to the `read(position, length)` returning `ArrayBuffer` that
this parser uses internally. The constructor calls it for you; the package
exports it so you can wrap or instrument reads.

A `Reader` must answer a read past end-of-file **short**, not throw. The header
walk reads speculatively past the end: the master-index size is an estimate, and
a zero-length answer to the norm-vector index probe is how the parser recognizes
a file carrying no normalization data. Every `generic-filehandle2` handle
behaves this way, remote 416s included.
