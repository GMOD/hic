# Differences from hic-straw that affect correctness

This package began as a port of [hic-straw](https://github.com/aidenlab/hic-straw).
Three places in its parsing logic assumed one chromosome-aligned region pair
per fetch — true for juicebox, not for a genome browser's arbitrary
viewport. Source links below are pinned to
[hic-straw v2.1.4](https://github.com/igvteam/hic-straw/tree/v2.1.4/src/hicFile.js),
the current npm release, and every consequence is measured against
`test/data/test.hic` (hg19, v8) with hic-straw installed as a
devDependency — reproduce with `pnpm bench:straw` or by calling the same
methods directly. [optimizations.md](optimizations.md) covers everything
else.

## A region narrower than one bin returns nothing

hic-straw filters records against the raw quotients `region.start / binsize`
and `region.end / binsize`
([`getContactRecords`, L345-348](https://github.com/igvteam/hic-straw/blob/v2.1.4/src/hicFile.js#L345-L348)),
then tests `rec.bin1 >= x1 && rec.bin1 < x2`
([L375](https://github.com/igvteam/hic-straw/blob/v2.1.4/src/hicFile.js#L375)).
Bin indices are always integers, so a region that starts and ends inside one
bin produces a non-integer `[x1, x2)` window with no integer bin1 inside it.

**Measured:** `chr1:100,500,000-100,600,000` at 2.5 Mb binsize (a 100 kb
region, one bin wide) — hic-straw returns **0** records, this package
returns **1**. The same fractional window also drops the bin straddling a
region's start while keeping the one at its end on wider regions, which
reads as a missing column at the left edge of every block as a viewport
pans.

This package's `binWindow` returns
`[floor(start/binsize), ceil(end/binsize))` — every bin overlapping the
region, the same rounding it already applies to the normalization-vector
slice for the same query.

## An overlapping reversed pair loses everything but the overlap

A `.hic` stores only the `bin1 <= bin2` half of a chromosome pair's matrix,
so a query whose first region sits to the right of its second has to be
swapped before the read. hic-straw's swap test is
[`region1.start >= region2.end`, L332](https://github.com/igvteam/hic-straw/blob/v2.1.4/src/hicFile.js#L332),
which only holds while the two regions are disjoint.

**Measured:** chr1 at 2.5 Mb, querying `(100-200 Mb, 50-150 Mb)` — a
multi-region view is free to ask for two overlapping windows in screen
order — returns 78 contacts from hic-straw, against 901 for the same pair
asked in genomic order. Everything but the overlap sliver goes missing,
which renders as a sparse off-diagonal block rather than as an error.

This package tests `region1.start > region2.start` instead (on the same
chromosome), which fires on the overlapping case too and leaves forward
order and an identical pair alone.

## A v8 file with no normalization data throws mid-parse

A `.hic` may legally carry no normalization vectors. Locating the
normalization vector index on such a file is a two-read walk:
[`skipExpectedValues`, L781](https://github.com/igvteam/hic-straw/blob/v2.1.4/src/hicFile.js#L781)
reads first and calls `binaryParser.getInt()` immediately after, with
nothing checking the read length;
[`readNormExpectedValuesAndNormVectorIndex`, L726](https://github.com/igvteam/hic-straw/blob/v2.1.4/src/hicFile.js#L726)
reads second and does check `data.byteLength === 0`, explicitly because
(its own comment) "this is possible if there are no norm vectors."

**Consequence:** on a file where the normalization section is missing
entirely, the file simply ends where `skipExpectedValues`'s first read
would land. That read comes back short, and the unguarded `getInt()` throws
a bare `RangeError`, before the walk ever reaches the check two calls
later.

This package's equivalent first read
(`skipExpectedValues` in `src/hicFile.ts`) checks its own length before
parsing, not just the second read's.
