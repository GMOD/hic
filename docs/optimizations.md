# Design decisions and optimizations

Why the read path looks the way it does. [dataflow.md](dataflow.md) draws the
path itself.

This package began as a TypeScript port of
[hic-straw](https://github.com/aidenlab/hic-straw) and keeps its `.hic` parsing
logic. What changed sits downstream of the parse — record representation,
caching, round-trip depth — and most of it follows from a different consumer.
Upstream serves juicebox, which asks for one chromosome-aligned region pair at
a time. A genome browser asks for arbitrary viewport windows, many region pairs
at once — a whole-genome human view is 24 regions, so 300 pairs — and hands the
contacts to a GPU renderer.

Measurements are against `test/data/test.hic` (hg19, v8), upstream's own test
data.

## Scope

- Input is a filehandle. The remote IO layer (`RemoteFile`, `ThrottledFile`,
  `RateLimiter`, `BrowserLocalFile`) and the deprecated local-`path` input are
  gone; `generic-filehandle2` covers the same ground, and a caller with its own
  cache can supply a bare `Reader`.
- Dropped: the legacy normalization-vector-index lookup table (`nvi.js`), the
  orphan `polygons.js`, the unused `DynamicBlockIndex`, the `Straw` wrapper
  class, and the FRAG-site code paths. The parser still reads FRAG zoom levels
  off the wire, it just drops them.
- We checked the output against the npm package's, record for record, before
  making the changes below; `test/verify.test.ts` still pins the counts.

## Correctness

### Bin windows are integer, not fractional

Upstream filters records against the raw quotients `start/binsize` and
`end/binsize`, which is exact for chromosome-aligned queries. On an arbitrary
viewport, where `start % binsize !== 0` essentially always holds, the quotient
drops the bin straddling the region's start while keeping the one straddling
the end — a missing column at the left edge of every block, jittering as the
user pans — and selects _nothing at all_ for a region narrower than one bin,
which a coarse locked binsize reaches easily.

`binWindow` returns `[floor(start/binsize), ceil(end/binsize))`, every bin
overlapping the region. It lives in its own module because the record filter
and the block-number selection must agree: widening only one still drops
records, since a bin can sit in a block the other never asked for. Flooring
also matches the normalization vector slice, so `bin1 - offset1` indexes exactly
the values the fetch brought back.

### Transposition compares starts, not start against end

A `.hic` stores only the `bin1 <= bin2` half, so the reader has to swap a pair
whose x window sits right of its y window. Upstream's same-chromosome test is
`region1.start >= region2.end`, which catches a reversed pair only while the
two are disjoint — and a multi-region view queries pairs in screen order, where
they may overlap.

Measured on chr1 at 2.5 Mb, `(100-200Mb, 50-150Mb)` returned 78 contacts
against 901 for the same pair in genomic order — everything but the overlap
sliver silently missing, which draws as a sparse off-diagonal block rather than
as an error. Comparing starts fires on the overlapping case too, and leaves
forward order and identical pairs alone.

### A file with no normalization data

A `.hic` may carry none, and then the file simply _ends_ where that section
would begin. The discovery walk is two reads deep — skip the normalized
expected values, then read the index after them — and only the second guarded
against a zero-length answer, so the first ran its parser off an empty
`DataView` and surfaced a lone `RangeError` in the console.

It is reachable on v9, which is what makes it easy to miss: v9 records the index
position in its header and should skip the walk entirely, but a file rebuilt
without normalization records that position as 0 and falls back to the pre-v9
path.

### The version gate ran before the version was known

`getNormVectorIndex` gates on `version >= 6`, but `version` is 0 until the
header is parsed, so calling it first — which `getNormalizationOptions` does on
its own — answered "no index" for every file. A caller that reads metadata
first never sees it.

## Performance

### Contacts are struct-of-arrays

Upstream models a contact as an object, and the whole read path inherits that
shape: a block holds `ContactRecord[]`, the window filter rebuilds the array,
and a renderer unpacks it into typed arrays at the end. A matrix is routinely
millions of contacts.

`ContactRecords` is three parallel typed arrays instead — `bin1`, `bin2`,
`counts`. Twelve bytes per contact against roughly 50 for an object, and
nothing for the collector to trace. The per-contact allocation is the obvious
cost; the block cache is the expensive one, since cached blocks are long-lived
and as objects they leave millions of live pointers for every GC to walk for
the rest of the session.

Counts are `Float32Array` because float32 is what the file stores and what a
shader takes; carrying them as doubles only widened a value on its way back
down.

### Caches are sized against the region-pair working set

A fetch's working set is a function of the displayed region count, and two of
the three caches grow with its square. Sized for one region they invert: a
fetch evicts the very entries it is about to need again, so the cache costs
eviction bookkeeping and returns nothing.

Range reads for a fetch and then an identical repeat fetch, which is what every
pan issues:

| regions | pairs | before      | after   |
| ------- | ----- | ----------- | ------- |
| 4       | 10    | 29 / 0      | 29 / 0  |
| 5       | 15    | 40 / 15     | 40 / 0  |
| 10      | 55    | 130 / 110   | 130 / 0 |
| 24      | 300   | 1106 / 1106 | 648 / 0 |

The cliffs are exactly the three capacities. Note the first column: 41% of a
cold whole-genome fetch's reads were re-reads of normalization vectors the same
fetch had already issued.

The block cache key carries the binsize already, so entries at different
resolutions coexist; upstream's extra `resolution` field cleared the whole map
whenever it changed, throwing away the previous level on every zoom step.
Cached blocks hold the decompressed records and nothing else — upstream also
hangs the `MatrixZoomData` and the block-index entry off each block, neither
read back, and the zoom data pins a whole `blockIndex` record per cached block
for the lifetime of the cache.

### The LRU has a byte budget as well as an entry cap

An entry cap is a memory bound only while entries are interchangeable, and
blocks are not: one holds every contact in its bin square, which varies by more
than an order of magnitude with binsize and distance from the diagonal (0.05 MB
at 2.5 Mb, 0.23 MB at 100 kb on the test file). Now the entry cap tracks the
working set and `maxBytes` is the memory backstop it was standing in for.

### Caches hold the in-flight promise, not the resolved value

Region pairs run concurrently and share chromosomes, so a result-only cache had
every concurrent pair miss while the first was still in flight and re-issue the
same reads — measured +12 range requests on a 6-pair fetch. A promise that
rejects drops out of the cache, so a transient failure retries instead of
sticking around forever.

### A region pair costs the deeper of its two read chains

What a remote `.hic` pays is round-trip **depth**, not read count. A pair needs
normalization vectors (header, then values) and blocks (matrix header, then
blocks): two independent two-hop chains that read nothing from each other.
Awaiting them in sequence makes a pair 4 sequential waves deep where 2 will do,
and the read count does not change, which is why only a depth-measuring test
can see it. `test/readChainDepth.test.ts` pins it by batching every read issued
in the same macrotask turn and counting the drains.

### Smaller things

- `getLong` composes two 32-bit reads instead of accumulating byte-by-byte
  through a throwaway 8-element array — that array was a per-entry allocation
  in the block-index parse loop.
- `getNormVectorIndex` memoizes the _attempt_, not just a populated result. A
  legal v8 file with no norm vectors leaves it undefined, and a
  `!this.normVectorIndex` guard then re-ran the whole discovery walk on every
  call — twice per region pair per fetch.
- `NormalizationVector`'s value cache compares against the clamped bound. A
  request running off the end of the vector — reachable when an assembly's
  refseq is longer than the size the `.hic` recorded — otherwise leaves
  `end > cache.end` true forever, and every call re-reads the same range.

## Measured but not done: a faster inflate

Blocks are zlib streams, inflated with `pako-esm2`. `bbi-js` runs the same kind
of stream through a wasm libdeflate build, about 4× faster on this file's
blocks — 63 blocks, 2.77 MB inflated: 42 ms pako against 9 ms wasm (node's own
`zlib.inflateSync`, browser-unavailable, lands at 13 ms).

This package still does not adopt it. Decompression is roughly a fifth of a
cold local chr1 fetch here (5.9 ms of ~30–45 ms) and a remote fetch is
latency-bound before it is CPU-bound, so the win is smaller than the ratio
suggests. Against that, the inlined wasm bundle is ~65 KB and `bbi-js` keeps
its copy private: adopting it means either a second copy of the crate and the
bundle, or first factoring the inflate wasm out into a package both can depend
on.

### Not `DecompressionStream` either

The platform's own inflate would get some of that speed with no bundle at all.
It does not work out. Over this file's real blocks, best of seven runs, ms:

| resolution | blocks | avg block | pako | `DecompressionStream` | wasm libdeflate |
| ---------- | -----: | --------: | ---: | --------------------: | --------------: |
| 2.5 Mb     |     25 |      6 KB |  2.4 |                   7.6 |             1.2 |
| 100 kb     |     63 |     43 KB | 36.6 |                  45.6 |             9.2 |

It is 5–6× the wasm path and slower than pako at both resolutions. A `.hic`
stores each block as its own zlib stream, so a caller reaches the API once per
block; dividing through gives 300–720 µs of overhead per call, far more than
the inflating. A wasm call pays a fixed cost per block too, but roughly 20 µs
of it, and a batched entry point pays it once for the whole group.

These are node numbers, where `DecompressionStream` is zlib with little plumbing
around it; a browser adds the Blob → stream → Response path, so read that column
as its best case. It has also only been baseline since May 2023 (Safari 16.4,
Firefox 113), so a fallback ships regardless — which is the bundle argument gone.

[`@gmod/bbi`](https://github.com/GMOD/bbi-js/blob/main/docs/wasm.md#why-not-the-platforms-decompressionstream)
and
[`@gmod/bgzf-filehandle`](https://github.com/GMOD/bgzf-filehandle/blob/main/docs/optimizations.md)
measured the same question against their own container shapes.

## What upstream logged, this returns

[api.md](api.md) documents the return fields; what follows is why they are
return fields at all.

A normalization the file lacks at the requested resolution, and a chromosome
pair with no matrix, both reach upstream's caller as a `console.log` and
nothing else, so neither the caller nor the user can act on them. The
normalization one sits inside `getContactRecords`' per-block loop, so it
repeats for every block of every region pair. `appliedNormalization` and an
empty result carry the same information where a caller can reach it.

Upstream reports the transposition not at all — it swaps and returns. Deriving
it caller-side means reproducing the file's own alias table and chromosome
indices, and a caller doing that against a divergent naming scheme would
silently un-swap the wrong axis, so `transposed` comes back with the records.
