# How a fetch flows

<img src="img/dataflow.svg" alt="hic data flow" width="560">

[dataflow.dot](img/dataflow.dot) is the source; see
[CONTRIBUTING.md](../CONTRIBUTING.md) for how to re-render it.

`getContactRecords` parses the header once, turns the two regions into bin
windows, and then runs two independent chains: one resolves the normalization
vectors for the pair's chromosomes, the other resolves the blocks covering its
bin square. They meet in the filter that keeps the contacts inside the window
and divides each count by the product of its two normalization values.

Why each of those steps looks the way it does, and what measured it, is
[optimizations.md](optimizations.md).

The diagram is the main path only. It leaves out the pre-v9 walk that locates
the normalization vector index, `NormalizationVector`'s own ±1000-value slice
cache, the three block encodings `parseBlockRecords` dispatches on, and the
version differences in field widths that run through all of it.

## Why the path forks

A `.hic` fetch pays round-trip **depth**, not read count, and the two chains
read nothing from each other: normalization needs a vector header then its
values, blocks need a matrix header then the blocks themselves. Awaiting them
in sequence makes a region pair four sequential waves deep where two will do.
Nothing about the number of reads changes, which is why only a depth-measuring
test sees it — `test/readChainDepth.test.ts` batches every read issued in the
same macrotask turn and counts the drains.

The fork is per region pair, and a caller usually issues many pairs at once. A
whole-genome human view is 24 regions, so 300 pairs, all in flight together on
top of this.

## Why so much of it is yellow

Every yellow node is shared across the pairs of one fetch, and the sharing is
what makes a multi-region view affordable. A chromosome appears in every pair it
takes part in, so its normalization vector is fetched once rather than once per
pair; a chromosome pair's matrix is fetched once however many blocks it yields.

Two properties matter beyond the color. Those caches hold the **in-flight
promise**, not the resolved value, because concurrent pairs otherwise all miss
while the first is still reading. And their capacities are sized against the
pair count rather than against one region — sized for one region they invert,
evicting the entries the same fetch is about to want again.
[optimizations.md](optimizations.md#caches-are-sized-against-the-region-pair-working-set)
has the read counts.

## Where decompression sits

`inflate` is the one CPU-bound step of the fetch, and it is the plain grey of an
ordinary JS call: blocks go through
[`pako-esm2`](https://www.npmjs.com/package/pako-esm2). The sibling parsers draw
that node in wasm orange — a wasm libdeflate build inflates this file's blocks
about 4× faster — and this package still does not, because decompression is
roughly a fifth of a cold local fetch and a remote one is latency-bound long
before it is CPU-bound. The bundle cost, and why the platform's own
`DecompressionStream` loses to both, are in
[optimizations.md](optimizations.md#measured-but-not-done-a-faster-inflate).

There is no worker pool either, and so no purple in the legend. Nothing on this
path needs the main thread, so a caller who wants the work off it can run the
whole diagram in a worker of its own.
