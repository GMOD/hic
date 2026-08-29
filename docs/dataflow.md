# How a fetch flows

A `.hic` file records how often two genome stretches touch inside the
nucleus. A fetch asks: for these two regions, at this resolution, how many
contacts join each pair of positions?

## The words on the diagram

- **Bin** — a fixed-width window (the `binsize`: 2.5 Mb, 100 kb, 5 kb) a
  contact is filed under by its two ends, not its exact coordinates. A file
  stores several binsizes as zoom levels; indices count from chromosome
  start, so bin 40 at 2.5 Mb begins at 100 Mb.
- **Matrix** — one per chromosome pair, axes are bin1 and bin2. Only
  `bin1 <= bin2` is stored, so a query arriving the other way round comes
  back `transposed`.
- **Block** — a matrix zoom level tiled into compressed, indexed squares, so
  a viewport reads only the tiles it overlaps.
- **Vector** — a one-dimensional per-bin correction (coverage, mappability,
  sequence composition) along one chromosome — uncorrected, a well-covered
  bin reads as a bright stripe across the matrix. Normalized count = raw
  count / (`v1[bin1] * v2[bin2]`). `KR`, `VC`, `SCALE` are different
  recipes; a file may carry several, or none.

## The path

<img src="img/dataflow.svg" alt="hic data flow" width="620">

[dataflow.dot](img/dataflow.dot) is the source; see
[CONTRIBUTING.md](../CONTRIBUTING.md) to re-render it. Each node names the
code underneath it.

`getContactRecords` parses the header once, turns the regions into bin
windows, then runs the normalization-vector lookup and the block lookup
concurrently, meeting in a filter that keeps in-window contacts and divides
each by both normalization values.

Not drawn: the pre-v9 norm-vector-index walk, `parseBlockRecords`'s three
block encodings, and per-version field-width differences. `NONE` skips
normalization and returns raw counts.

## Why the path forks

Each lookup depends only on its own inputs, so a fetch runs both
concurrently: a pair's missing vectors and blocks go out together in one
`Promise.all`. The fork is per region pair, and a caller usually issues many
at once — a whole-genome human view is 24 regions, 300 pairs, all
concurrent. What that buys in round trips: [optimizations.md](optimizations.md).

## Why so much of it is yellow

Yellow nodes are shared across a fetch's pairs: a chromosome's
normalization vector is fetched once regardless of pair count; a chromosome
pair's matrix, once regardless of block count. The caching strategy behind
that, and its numbers, are in
[optimizations.md](optimizations.md#caches-sized-to-the-region-pair-working-set).

`normVectorCache` holds the parsed vector itself, so a hit still asks it
for the region's slice — usually already sitting in `NormalizationVector`'s
own ±1000-value cache, since pairs sharing a vector ask for the same slice.

## Why a whole-genome view is affordable

- **The file already did the hard part.** Coarsest zoom level: hg19 at
  2.5 Mb is ~1,240 bins per axis, ~800,000 mostly-empty half-matrix cells —
  against 620,000 bins per axis at 5 kb.
- **Only overlapping tiles get read.** Indexed blocks mean a pair reads only
  the tiles its bin square touches; many files carry no inter-chromosomal
  matrices at all, so those pairs cost one lookup and nothing else.
- **Work is shared across every pair.** 24 regions share 24 normalization
  vectors across all 300 pairs. `test/data/test.hic`'s whole-genome fetch:
  648 range reads cold, 0 on repeat.

Contacts come back as three parallel typed arrays — `bin1`, `bin2`,
`counts` — each sized to the record count
([optimizations.md](optimizations.md#contacts-are-struct-of-arrays)).

## Where decompression sits

The one CPU-bound step — the wasm-orange nodes the sibling parsers use.
What it costs, and why wasm over pako or `DecompressionStream`, is in
[optimizations.md](optimizations.md#inflate-is-wasm-libdeflate).

Every step here is thread-agnostic, so a caller who wants the work off the
main thread can run the whole diagram inside a worker of its own.
