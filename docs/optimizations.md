# Design decisions and optimizations

Performance of this package vs. [hic-straw](https://github.com/aidenlab/hic-straw),
the project this package ported from. [dataflow.md](dataflow.md) draws the
read path; [correctness.md](correctness.md) covers parsing differences.

hic-straw: one chromosome-aligned region pair per fetch (juicebox). This
package: many arbitrary viewport pairs at once (a whole-genome human view is
24 regions, 300 pairs), for a GPU renderer. Measurements: `test/data/test.hic`
(hg19, v8), hic-straw's own test data.

## Scope

- Input is a filehandle. `RemoteFile`, `ThrottledFile`, `RateLimiter`,
  `BrowserLocalFile`, and the deprecated local-`path` input are gone;
  `generic-filehandle2` covers the same ground.
- Dropped: `nvi.js`, `polygons.js`, `DynamicBlockIndex`, the `Straw` wrapper
  class, FRAG-site handling (FRAG zoom levels are read and discarded).
- `test/verify.test.ts` checks output against hic-straw's, record for record.

## Performance vs. hic-straw

### Fewer requests than hic-straw, same fetch

`pnpm bench:straw`: same whole-genome fetch, same file, same filehandle type,
through hic-straw and through this package.

| binsize | hic-straw requests | this package requests | fewer requests |
| ------- | -----------------: | --------------------: | -------------: |
| 2.5 Mb  |               3977 |                  1007 |           3.9x |
| 100 kb  |              ~6400 |                  1739 |           3.7x |

Contact counts match within 0.1% ([correctness.md](correctness.md) explains
the remainder). At 50 ms RTT / 6-connection concurrency: whole-genome fetch
33 s → 8 s at 2.5 Mb, 53 s → 15 s at 100 kb.

### Caches sized to the region-pair working set

hic-straw: fixed caches, 6 blocks / 10 matrices / 10 vectors. This package's
working set scales with the _square_ of the region count:

| regions | pairs | blocks needed | matrices needed | vectors needed |
| ------- | ----- | ------------: | --------------: | -------------: |
| 4       | 10    |            10 |              10 |              4 |
| 5       | 15    |            15 |              15 |              5 |
| 10      | 55    |            55 |              55 |             10 |
| 24      | 300   |           300 |             300 |             24 |

hic-straw's cache is already too small at 4 regions, short by 30x at 24.
Sized to the working set (`pnpm bench:cache`): 0 misses on a repeat fetch,
against 41–932 cold.

Block cache also keys on binsize — resolutions coexist instead of evicting
each other on zoom, as hic-straw's does.

### Round trips, not CPU, dominate a remote fetch

Whole chr1 at 5 kb, ENCODE's `ENCFF148QCR` (69 GB hg38 v9, public internet,
headless Chrome), same bytes both ways:

| filehandle      | wall clock | HTTP requests |
| --------------- | ---------: | ------------: |
| bare            | **24.0 s** |           225 |
| range-coalesced |  **1.8 s** |            45 |

13x. Every CPU cost on this fetch is under 100 ms — request count sets the
clock. This package
takes a filehandle rather than stacking its own cache;
[`@gmod/range-cache-filehandle`](https://github.com/GMOD/range-cache-filehandle)
does the coalescing (README has the wiring) — required for a remote consumer.

### Contacts are struct-of-arrays

`ContactRecords`: three parallel typed arrays (`bin1`, `bin2`, `counts`), not
an object per contact. 12 bytes/contact vs. ~50, nothing for the collector to
trace.

### Smaller fixes

- Normalization-vector and block reads run concurrently, not sequentially: 2
  round-trip waves deep instead of 4, same request count.
- Caches hold the in-flight promise, not just the result, so concurrent
  pairs sharing a chromosome don't re-issue the same read (+12 requests on a
  6-pair fetch without this).

## Inflate is wasm libdeflate

`@gmod/inflate` (wasm libdeflate) replaced pure-JS `pako` (shipped through
v1.0.0). `pnpm benchonly inflate`, output asserted identical first. End-to-end,
cold, medians in ms:

| fetch                            | pako | wasm |
| -------------------------------- | ---: | ---: |
| chr1 @ 2.5 Mb (1 block)          |  1.8 |  1.6 |
| chr1 @ 100 kb                    |  5.4 |  3.3 |
| whole genome, 325 pairs @ 2.5 Mb |   51 |   29 |
| whole genome, 325 pairs @ 100 kb |  140 |   86 |

~40% faster at whole-genome scale, where decompression is a larger share of
the fetch. Still latency-bound first on a remote fetch — this is the local
ceiling, not the end-to-end win.

`DecompressionStream`: rejected. Each block is its own zlib stream, so its
per-call overhead is paid once per block — 3–7x native zlib, worse than wasm
throughout and worse than pako at small block sizes.

## What hic-straw logged, this returns

A missing normalization and a matrix-less chromosome pair reach hic-straw's
caller as a `console.log` only. `appliedNormalization` and an empty result
carry the same information, actionable by the caller. A transposed pair is
swapped silently by hic-straw; `transposed` comes back with the records here.
