# Differences from hic-straw that affect correctness

This package began as a port of [hic-straw](https://github.com/aidenlab/hic-straw).
Four places in its parsing logic assumed one chromosome-aligned region pair
per fetch — true for juicebox, not for a genome browser's arbitrary viewport.
[optimizations.md](optimizations.md) covers everything else.

Measurements: `test/data/test.hic` (hg19, v8). `test/verify.test.ts` checks
output against hic-straw's, record for record.

## Bin windows are integer, not fractional

Filtering against raw quotients `start/binsize` and `end/binsize` is exact
for chromosome-aligned queries. On an arbitrary viewport (`start % binsize`
essentially always nonzero), the quotient drops the bin straddling the
region's start while keeping the one at the end — a missing column at the
left edge, jittering as the user pans — and selects nothing for a region
narrower than one bin.

`binWindow` returns `[floor(start/binsize), ceil(end/binsize))`.

## Transposition compares starts, not start against end

A `.hic` stores only the `bin1 <= bin2` half; a reversed pair has to be
swapped. `region1.start >= region2.end` catches a reversed pair only while
the two are disjoint — a multi-region view queries pairs that may overlap.

Measured on chr1 at 2.5 Mb: `(100-200Mb, 50-150Mb)` returned 78 contacts
against 901 for the same pair in genomic order. Comparing starts instead
fires on the overlapping case too, and leaves forward order and identical
pairs alone.

## A file with no normalization data

A `.hic` may carry none; the file ends where that section would begin. The
discovery walk is two reads deep, and only the second guarded against a
zero-length answer — the first ran its parser off an empty `DataView`.

Reachable on v9: v9 normally records the index position in its header and
skips the walk, but a file rebuilt without normalization records that
position as 0 and falls back to the pre-v9 path.

## The version gate ran before the version was known

`getNormVectorIndex` gates on `version >= 6`, but `version` is 0 until the
header is parsed. Calling it first — as `getNormalizationOptions` does —
answered "no index" for every file.
