# Design decisions and optimizations

This package began as a TypeScript port of
[hic-straw](https://github.com/aidenlab/hic-straw) and keeps its `.hic` parsing
logic. What changed is mostly downstream of the parse: how records are
represented, how much is cached, and how many sequential round trips a fetch
costs.

Most of it follows from a different consumer. Upstream serves juicebox, which
asks for one chromosome-aligned region pair at a time. A genome browser asks
for arbitrary viewport windows, many region pairs at once — a whole-genome
human view is 24 regions, so 300 pairs — and hands the contacts to a GPU
renderer. None of the notes below are faults in upstream's own setting; they
are places where its choices stop fitting that second one.

Measurements are against `test/data/test.hic` (hg19, v8), the file upstream
ships as its own test data.

## Scope

The port is lean by design:

- Input is a filehandle. The remote IO layer (`RemoteFile`, `ThrottledFile`,
  `RateLimiter`, `BrowserLocalFile`) and the deprecated local-`path` input are
  gone; `generic-filehandle2` covers the same ground, and a caller with its own
  cache can supply a bare `Reader`.
- Inflate is `pako-esm2` rather than a bundled `zlib_and_gzip.js`.
- Dropped: the legacy normalization-vector-index lookup table (`nvi.js`), the
  orphan `polygons.js`, the unused `DynamicBlockIndex`, and the FRAG-site code
  paths. FRAG zoom levels are still parsed off the wire, just not retained.
- The `Straw` wrapper class is gone. It forwarded three methods unchanged to
  `HicFile`, which is now the entry point directly.
- All sources are TypeScript. Output was verified identical to the npm package
  before the changes below (`test/verify.test.ts` still pins the counts).

## Correctness

### Bin windows are integer, not fractional

Upstream compares bin indices against the raw quotients `start/binsize` and
`end/binsize`. That is exact for chromosome-aligned queries. For an arbitrary
viewport, where `start % binsize !== 0` essentially always holds, the raw
quotient drops the bin straddling the region's start while keeping the one
straddling the end — a missing column at the left edge of every block,
jittering as the user pans — and selects _nothing at all_ for a region narrower
than one bin, which a coarse locked binsize reaches easily.

`binWindow` returns `[floor(start/binsize), ceil(end/binsize))`, every bin
overlapping the region. It lives in its own module because the record filter
and the block-number selection must agree: widening only one still drops
records, since a bin can sit in a block the other never asked for. Flooring
also matches the normalization vector slice, so `bin1 - offset1` indexes
exactly the values that were fetched.

### Transposition compares starts, not start against end

A `.hic` stores only the `bin1 <= bin2` half, so a pair whose x window sits
right of its y window must be swapped. Upstream's same-chromosome test is
`region1.start >= region2.end`, which catches a reversed pair only while the
two are disjoint. A multi-region view queries pairs in screen order, and those
regions may overlap.

Measured on chr1 at 2.5 Mb, `(100-200Mb, 50-150Mb)` returned 78 contacts
against 901 for the same pair in genomic order — everything but the overlap
sliver silently missing, which draws as a sparse off-diagonal block rather than
as an error. Comparing starts fires on both the disjoint and the overlapping
case, and leaves forward order and identical pairs alone.

### A file with no normalization data

A `.hic` may carry none, and then the file simply _ends_ where that section
would begin. The discovery walk is two reads deep — skip the normalized
expected values, then read the index after them — and only the second guarded
against a zero-length answer, so the first ran its parser off an empty
`DataView`. It surfaces as a lone `RangeError` in the console.

It is reachable on v9, which is the part that makes it easy to miss: v9 records
the index position in its header and should skip the walk entirely, but a file
rebuilt without normalization records that position as 0 and falls back to the
pre-v9 path.

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

Counts are `Float32Array` because float32 is both what the file stores and what
a shader takes, so carrying them as doubles only ever widened a value on its
way back down.

Every block encoding knows its length up front, so each array is allocated once
and filled by a write cursor. Where a filter can drop records — the dense
encoding's empty cells — the arrays are sized to the upper bound and copied
down to the true length at the end, rather than left oversized in a cache that
outlives the fetch.

### Caches are sized against the region-pair working set

A fetch's working set is a function of the displayed region count, and two of
the three caches grow with its square. Sized for one region, they don't merely
underperform, they invert: the entries a fetch will need again are evicted by
the same fetch, so the cache costs eviction bookkeeping and returns nothing.

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
resolutions coexist; upstream's extra `resolution` field made the cache
single-resolution, and every zoom step threw the previous level away. Cached
blocks hold the decompressed records and nothing else — upstream also hangs the
`MatrixZoomData` and the block-index entry off each block, neither of which is
read back, and the zoom data pins a whole `blockIndex` record per cached block
for the lifetime of the cache.

### The LRU has a byte budget as well as an entry cap

An entry cap is a memory bound only while entries are interchangeable, and
blocks are not: one holds every contact in its bin square, which varies by more
than an order of magnitude with binsize and distance from the diagonal (0.05 MB
at 2.5 Mb, 0.23 MB at 100 kb on the test file). One number was answering two
questions — how many blocks a fetch needs at once, and how much memory the
biggest may hold — and the memory question won, which is what left the cache
too small to serve a multi-region fetch. Now the entry cap tracks the working
set and `maxBytes` is the backstop it was standing in for.

### Caches hold the in-flight promise, not the resolved value

Region pairs run concurrently and share chromosomes, so a result-only cache had
every concurrent pair miss while the first was still in flight and re-issue the
same reads — measured +12 range requests on a 6-pair fetch. Each such promise
is evicted if it rejects, so a transient failure retries rather than being
cached forever.

### A region pair costs the deeper of its two read chains

What a remote `.hic` pays is round-trip **depth**, not read count. A pair needs
normalization vectors (header, then values) and blocks (matrix header, then
blocks): two independent two-hop chains that read nothing from each other.
Awaiting them in sequence makes a pair 4 sequential waves deep where 2 will do,
and nothing about the read count changes, which is why only a depth-measuring
test can see it. `test/readChainDepth.test.ts` pins this by batching every read
issued in the same macrotask turn and counting the drains.

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

Blocks are zlib streams, inflated with `pako-esm2`. `bbi-js` decompresses the
same kind of stream through a wasm libdeflate build, and on this file's blocks
that is about 4× faster — 63 blocks, 2.77 MB inflated: 42 ms with pako against
9 ms with wasm libdeflate (node's own `zlib.inflateSync`, browser-unavailable,
lands at 13 ms).

It is not adopted here because the win is smaller than the ratio suggests and
the packaging cost is real. Decompression is roughly a fifth of a cold local
chr1 fetch on this file (5.9 ms of ~30–45 ms), and a remote fetch is
latency-bound before it is CPU-bound. Against that, the inlined wasm bundle is
~65 KB, and `bbi-js` keeps its copy private — so adopting it means either a
second copy of the crate and the bundle, or first factoring the inflate wasm
out into a package both can depend on. The second is the right shape if this is
ever wanted, since an application loading both would otherwise ship the bundle
twice.

The case gets stronger with block size: deep files at fine resolution decode
far more than 2.77 MB per fetch, and there the ratio is the whole story.

### Not `DecompressionStream` either

The platform's own inflate is the obvious way to get some of that speed without
any bundle at all, and it does not work out. Over this file's real blocks, best
of seven runs, ms:

| resolution | blocks | avg block | pako | `DecompressionStream` | wasm libdeflate |
| ---------- | -----: | --------: | ---: | --------------------: | --------------: |
| 2.5 Mb     |     25 |      6 KB |  2.4 |                   7.6 |             1.2 |
| 100 kb     |     63 |     43 KB | 36.6 |                  45.6 |             9.2 |

It is 5–6× the wasm path and slower than pako at both resolutions. The reason is
that a `.hic` stores each block as its own zlib stream, so the API can only be
called once per block, and dividing through gives 300–720 µs of overhead per
call — far more than the inflating. A wasm call pays that once per block too,
but its fixed cost is roughly 20 µs, and a batched entry point pays it once for
the whole group.

These are node numbers, where `DecompressionStream` is zlib with little plumbing
around it; a browser adds the Blob → stream → Response path, so read the column
as its best case. It has also only been baseline since May 2023 (Safari 16.4,
Firefox 113), so a fallback ships regardless — which is the bundle argument gone.

The same question, measured in the two sibling libraries:
[`@gmod/bbi`](https://github.com/GMOD/bbi-js/blob/main/docs/wasm.md#why-not-the-platforms-decompressionstream)
reaches the same answer more sharply (hundreds of small blocks per query), while
[`@gmod/bgzf-filehandle`](https://github.com/GMOD/bgzf-filehandle/blob/main/docs/optimizations.md)
comes within ~2× of wasm, because concatenated gzip members let a whole buffer
go through one call. Same API and codec throughout; what differs is how many
times it has to be called.

## API

Two things upstream reports to the console, this returns instead:

- **`appliedNormalization`**, because a file can offer KR at 5 kb and nothing
  at 2.5 Mb. Upstream warns and hands back raw counts, which is not visible to
  the caller and so not visible to the user; that warning also fires once per
  chromosome per region pair per fetch.
- **`transposed`**, because the swap is decided from the file's own alias table
  and chromosome indices. A caller re-deriving it against a divergent
  chromosome-naming scheme would silently un-swap the wrong axis.

A missing chromosome pair returns no records rather than warning per pair, and
the "no data at this resolution" error message is an exported constant, so a
caller dropping that one pair out of 300 can recognize it without matching a
hand-copied string.
