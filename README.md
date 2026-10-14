# @gmod/hic

[![NPM version](https://img.shields.io/npm/v/@gmod/hic.svg?style=flat-square)](https://npmjs.org/package/@gmod/hic)
![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/hic/publish.yml?branch=main)

Read `.hic` contact matrix files, in Node.js or the browser.

`@gmod/hic` is a fork of [hic-straw](https://github.com/aidenlab/hic-straw),
rewritten in TypeScript for a genome browser that fetches many region pairs at
once over arbitrary viewport windows.

## Install

    $ npm install @gmod/hic

## Usage

```js
import { HicFile } from '@gmod/hic'

const hic = new HicFile({ path: 'path/to/file.hic' })

const meta = await hic.getMetaData()
// { version, genome, chromosomes: [{ index, name, size }], resolutions }

await hic.getNormalizationOptions() // ['NONE', 'VC', 'VC_SQRT', 'KR', 'SCALE']

const region = { chr: '1', start: 0, end: 20_000_000 }
const { records, appliedNormalization, transposed } =
  await hic.getContactRecords('KR', region, region, 2_500_000)

// records is struct-of-arrays: three parallel typed arrays
records.bin1 // Int32Array of bin indices along region1
records.bin2 // Int32Array of bin indices along region2
records.counts // Float32Array of contact counts
```

`getNormalizationOptions()` and `getContactRecords()` take an optional trailing
`{ onProgress }`, called as `(current, total)`; see
[docs/api.md](docs/api.md#progress).

```js
await hic.getContactRecords('KR', region, region, 2_500_000, {
  onProgress: (current, total) => showBar(current / total),
})
```

Every async method also takes an `AbortSignal` the same way, `{ signal }`, and
forwards it to each read; see [docs/api.md](docs/api.md#cancellation).

In the browser, or for a file over HTTP, pass a `filehandle` from
[`generic-filehandle2`](https://www.npmjs.com/package/generic-filehandle2)
instead of a `path`:

```js
import { RemoteFile } from 'generic-filehandle2'

const hic = new HicFile({
  filehandle: new RemoteFile('https://example.com/file.hic'),
})
```

**Over HTTP, put a byte-range cache underneath.** A query reads many small
scattered blocks, so the request count sets the load time.
[`@gmod/range-cache-filehandle`](https://github.com/GMOD/range-cache-filehandle)
cut a whole-chr1 fetch from a 69 GB ENCODE file from 24.0 s to 1.8 s
([docs/optimizations.md](docs/optimizations.md#round-trips-not-cpu-dominate-a-remote-fetch)).

```js
import { RemoteFileWithRangeCache } from '@gmod/range-cache-filehandle'

const hic = new HicFile({
  filehandle: new RemoteFileWithRangeCache('https://example.com/file.hic'),
})
```

A caller with its own IO layer or cache can supply anything that reads `length`
bytes at `position`:

```js
const hic = new HicFile({
  reader: { read: (position, length) => myCache.read(position, length) },
})
```

See [docs/api.md](docs/api.md) for the full API reference.

## Notes

- Bin indices are **absolute for their chromosome**, not relative to the
  requested region.
- A `.hic` stores only the `bin1 <= bin2` half of the matrix, so a query whose x
  window sits right of its y window gets swapped. `transposed` marks the swap,
  and `bin1` then runs along `region2`.
- `appliedNormalization` names the normalization the reader applied, which may
  differ from the one you asked for. The file stores vectors per (type,
  chromosome, unit, binsize), so it can offer KR at 5 kb and nothing at 2.5 Mb.
- Bins are base pairs only; this fork drops the FRAG (restriction-fragment)
  code paths.
- Chromosome names match the file's own exactly, with no `chr` aliasing.
- Each `HicFile` caches up to 128 MB of decompressed contacts. Pass
  `blockCacheMaxBytes` to change that ceiling.
- Record order is unspecified — the result concatenates whole blocks, cached
  ones first.

## Docs

- [docs/api.md](docs/api.md) — every constructor option, method and return shape
- [docs/dataflow.md](docs/dataflow.md) — how a fetch flows, and why the path
  forks into two chains
- [docs/optimizations.md](docs/optimizations.md) — performance against
  hic-straw, and what measured it
- [docs/correctness.md](docs/correctness.md) — parsing differences from
  hic-straw
- [CONTRIBUTING.md](CONTRIBUTING.md) — development and release steps

## Academic use

This package was written with funding from the [NHGRI](http://genome.gov) as
part of the [JBrowse](http://jbrowse.org) project. If you use it in an academic
project that you publish, please cite the most recent JBrowse paper, which will
be linked from [jbrowse.org](http://jbrowse.org).

If you use `.hic` files, please also cite the Juicer/Juicebox papers from the
[Aiden Lab](https://github.com/aidenlab), whose hic-straw this is derived from.

## License

MIT, as is upstream hic-straw; see [LICENSE](LICENSE).
