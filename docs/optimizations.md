# Design decisions and optimizations

This page compares the performance of this package with
[hic-straw](https://github.com/aidenlab/hic-straw), the project it was ported
from. [dataflow.md](dataflow.md) draws the read path;
[correctness.md](correctness.md) covers parsing differences.

hic-straw reads one chromosome-aligned region pair per fetch, for juicebox.
This package reads many arbitrary viewport pairs at once (a whole-genome human
view is 24 regions, 300 pairs), for a GPU renderer. The measurements use
`test/data/test.hic` (hg19, v8), which is hic-straw's own test data.

## Scope

- Input is a filehandle. `RemoteFile`, `ThrottledFile`, `RateLimiter`,
  `BrowserLocalFile`, and the deprecated local-`path` input are gone;
  `generic-filehandle2` provides the same file access.
- This package also drops `nvi.js`, `polygons.js`, `DynamicBlockIndex`, the
  `Straw` wrapper class and FRAG-site handling. The parser reads FRAG zoom
  levels and discards them.
- `test/verify.test.ts` checks output against hic-straw's, record for record.

## Performance vs. hic-straw

### Fewer requests than hic-straw, same fetch

`pnpm bench:straw` runs the same whole-genome fetch on the same file, with the
same filehandle type, through hic-straw and through this package.

| binsize | hic-straw requests | this package requests | fewer requests |
| ------- | -----------------: | --------------------: | -------------: |
| 2.5 Mb  |               3977 |                  1007 |           3.9x |
| 100 kb  |              ~6400 |                  1739 |           3.7x |

Contact counts match within 0.1% ([correctness.md](correctness.md) explains
the remainder). At 50 ms RTT and 6-connection concurrency, a whole-genome fetch
goes from 33 s to 8 s at 2.5 Mb, and from 53 s to 15 s at 100 kb.

### Caches sized to the region-pair working set

hic-straw has fixed caches of 6 blocks, 10 matrices and 10 vectors. The
working set of a fetch in this package scales with the _square_ of the region
count:

| regions | pairs | blocks needed | matrices needed | vectors needed |
| ------- | ----- | ------------: | --------------: | -------------: |
| 4       | 10    |            10 |              10 |              4 |
| 5       | 15    |            15 |              15 |              5 |
| 10      | 55    |            55 |              55 |             10 |
| 24      | 300   |           300 |             300 |             24 |

hic-straw's cache is already too small at 4 regions, and 30x too small at 24.
With caches sized to the working set, `pnpm bench:cache` counts 0 misses on a
repeat fetch, against 41–932 cold.

The block cache also keys on binsize, so blocks from different resolutions stay
cached side by side through a zoom. hic-straw's block cache evicts one
resolution's blocks for another's on zoom.

### Round trips, not CPU, dominate a remote fetch

We fetched the whole of chr1 at 5 kb from ENCODE's `ENCFF148QCR` (69 GB, hg38,
v9) over the public internet in headless Chrome, and both filehandles returned
the same bytes:

| filehandle      | wall clock | HTTP requests |
| --------------- | ---------: | ------------: |
| bare            | **24.0 s** |           225 |
| range-coalesced |  **1.8 s** |            45 |

The range-coalesced fetch is 13x faster. Every CPU cost on this fetch is under
100 ms, so the request count sets the wall-clock time. This package takes a
filehandle rather than adding a cache of its own, and
[`@gmod/range-cache-filehandle`](https://github.com/GMOD/range-cache-filehandle)
merges the reads (the README shows the setup). A remote consumer needs the range
cache.

### Contacts are struct-of-arrays

`ContactRecords` holds three parallel typed arrays (`bin1`, `bin2`, `counts`)
instead of an object per contact. A contact takes 12 bytes instead of ~50, and
the garbage collector has no per-contact objects to trace.

### Smaller fixes

- The parser runs normalization-vector and block reads concurrently, so a
  fetch takes 2 waves of round trips instead of 4, with the same request count.
- Caches share the in-flight read, not just the result, so concurrent pairs
  sharing a chromosome don't re-issue the same read. Without the sharing, a
  6-pair fetch makes 12 more requests. `@gmod/shared-read-cache` holds the
  in-flight reads and cancels a shared read only once every caller has
  aborted.

## Inflate is wasm libdeflate

`@gmod/inflate` (wasm libdeflate) replaced pure-JS `pako` (shipped through
v1.0.0). `pnpm benchonly inflate` asserts that both produce identical output,
then times cold end-to-end fetches. The table lists medians in ms:

| fetch                            | pako | wasm |
| -------------------------------- | ---: | ---: |
| chr1 @ 2.5 Mb (1 block)          |  1.8 |  1.6 |
| chr1 @ 100 kb                    |  5.4 |  3.3 |
| whole genome, 325 pairs @ 2.5 Mb |   51 |   29 |
| whole genome, 325 pairs @ 100 kb |  140 |   86 |

Wasm is ~40% faster at whole-genome scale, where decompression is a larger
share of the fetch. A remote fetch is still bound by latency first, so these
numbers show the local ceiling rather than the end-to-end gain.

### Not `DecompressionStream` either

We rejected `DecompressionStream`. Each block is a separate zlib stream, so
the API's per-call overhead is paid once per block. That makes it 3–7x native
zlib, slower than wasm throughout, and slower than pako at small block sizes.

## Results in place of console logs

hic-straw reports a missing normalization and a chromosome pair with no matrix
only through `console.log`. This package returns the same information in
`appliedNormalization` and an empty result, where the caller can act on it.
hic-straw swaps a transposed pair without telling the caller; here,
`transposed` comes back with the records.
