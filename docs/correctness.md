# Differences from hic-straw that affect correctness

`@gmod/hic` began as a port of [hic-straw](https://github.com/aidenlab/hic-straw).
Three places in hic-straw's parsing logic assume one chromosome-aligned region
pair per fetch, which holds for juicebox but not for a genome browser's
arbitrary viewport. Source links below are pinned to
[hic-straw v2.1.4](https://github.com/igvteam/hic-straw/tree/v2.1.4/src/hicFile.js),
the current npm release. We measured every consequence against
`test/data/test.hic` (hg19, v8) with hic-straw installed as a devDependency;
`pnpm bench:straw` reproduces the measurements, as does calling the same
methods directly. [optimizations.md](optimizations.md) covers everything else.

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
returns **1**. On wider regions, the same fractional window also drops the bin
straddling a region's start while keeping the one at its end, which appears as
a missing column at the left edge of every block as a viewport pans.

`binWindow` in this package returns
`[floor(start/binsize), ceil(end/binsize))`, which includes every bin
overlapping the region. The package already rounds the normalization-vector
slice for the same query this way.

## An overlapping reversed pair loses everything but the overlap

A `.hic` stores only the `bin1 <= bin2` half of a chromosome pair's matrix,
so a query whose first region sits to the right of its second has to be
swapped before the read. hic-straw's swap test is
[`region1.start >= region2.end`, L332](https://github.com/igvteam/hic-straw/blob/v2.1.4/src/hicFile.js#L332),
which only holds while the two regions are disjoint.

**Measured:** chr1 at 2.5 Mb, querying `(100-200 Mb, 50-150 Mb)` (a
multi-region view is free to ask for two overlapping windows in screen order),
returns 78 contacts from hic-straw, against 901 for the same pair asked in
genomic order. The result loses every contact outside the overlap, and a viewer
draws it as a sparse off-diagonal block, with no error.

This package swaps on `region1.start > region2.start` instead (on the same
chromosome), which catches the overlapping case too and leaves a pair in
forward order, or an identical pair, unswapped.

## A v8 file with no normalization data throws mid-parse

A `.hic` may legally have no normalization vectors. On such a file, the walk
that locates the normalization vector index makes two reads.
[`skipExpectedValues`, L781](https://github.com/igvteam/hic-straw/blob/v2.1.4/src/hicFile.js#L781)
reads first and calls `binaryParser.getInt()` immediately after, without
checking the read length.
[`readNormExpectedValuesAndNormVectorIndex`, L726](https://github.com/igvteam/hic-straw/blob/v2.1.4/src/hicFile.js#L726)
reads second and does check `data.byteLength === 0`, explicitly because, in
the words of its comment, "this is possible if there are no norm vectors."

**Consequence:** on a file where the normalization section is missing
entirely, the file ends where `skipExpectedValues`'s first read would start.
That read comes back short, and the unguarded `getInt()` throws a bare
`RangeError` before the walk reaches the check two calls later.

This package's `skipExpectedValues` (in `src/hicFile.ts`) checks the length of
its first read before parsing it, in addition to the check on the second
read.
