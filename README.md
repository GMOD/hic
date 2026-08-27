# @gmod/hic

[![NPM version](https://img.shields.io/npm/v/@gmod/hic.svg?style=flat-square)](https://npmjs.org/package/@gmod/hic)
![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/hic/publish.yml?branch=main)

Read `.hic` contact matrix files, in Node.js or the browser.

A fork of [hic-straw](https://github.com/aidenlab/hic-straw), rewritten in
TypeScript and retuned for a genome browser's access pattern — many region
pairs per fetch, arbitrary viewport windows, and contacts handed to a GPU
renderer. See [docs/optimizations.md](docs/optimizations.md) for what changed
and why.

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
  await hic.getContactRecords('KR', region, region, 'BP', 2_500_000)

// records is struct-of-arrays: three parallel typed arrays
records.bin1 // Int32Array of bin indices along region1
records.bin2 // Int32Array of bin indices along region2
records.counts // Float32Array of contact counts
```

Both reading methods take an optional trailing `{ onProgress }`, called
`(current, total)` as the work lands, so a loading indicator can show a bar
rather than a spinner. The unit is the block for a contact fetch and the
expected-value chunk for the normalization-index walk — the slow part of opening
a pre-v9 file. See [docs/api.md](docs/api.md#progress).

```js
await hic.getContactRecords('KR', region, region, 'BP', 2_500_000, {
  onProgress: (current, total) => showBar(current / total),
})
```

In the browser, or for a file over HTTP, pass a `filehandle` from
[`generic-filehandle2`](https://www.npmjs.com/package/generic-filehandle2)
instead of a `path`:

```js
import { RemoteFile } from 'generic-filehandle2'

const hic = new HicFile({
  filehandle: new RemoteFile('https://example.com/file.hic'),
})
```

**Over HTTP, put a byte-range cache underneath. It is worth more than every
other optimization in this package combined.** A contact-matrix query reads many
small blocks scattered through the file — a whole-genome view of the test file
issues over a thousand of them — and a browser runs about six requests per
origin at a time, so the request count sets the wall clock.
[`@gmod/range-cache-filehandle`](https://github.com/GMOD/range-cache-filehandle)
is a drop-in for `RemoteFile` that serves those reads out of 256 KiB chunks, so
neighboring blocks share a request. Measured in headless Chrome against a real
69 GB ENCODE file, whole chr1 at 5 kb: **24.0 s and 225 requests becomes 1.8 s
and 45**, for byte-identical output.

```js
import { RemoteFileWithRangeCache } from '@gmod/range-cache-filehandle'

const hic = new HicFile({
  filehandle: new RemoteFileWithRangeCache('https://example.com/file.hic'),
})
```

Anything that can read `length` bytes at `position` works too, which is the
hook for a caller with its own IO layer or cache:

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
  window sits right of its y window gets swapped before it goes out;
  `transposed` says so, and `bin1` then runs along `region2`.
- `appliedNormalization` names the normalization the file actually applied,
  which is not always the one you asked for — a `.hic` carries normalization
  vectors per (type, chromosome, unit, binsize), so it can offer KR at 5 kb and
  nothing at 2.5 Mb.
- `BP` is the only unit this fork supports; it drops the FRAG code paths.
- Each `HicFile` caches up to 128 MB of decompressed contacts. Pass
  `blockCacheMaxBytes` to change that ceiling.
- Record order is unspecified — the result concatenates whole blocks, cached
  ones first.

## Docs

- [docs/api.md](docs/api.md) — every constructor option, method and return shape
- [docs/dataflow.md](docs/dataflow.md) — how a fetch flows, and why the path
  forks into two chains
- [docs/optimizations.md](docs/optimizations.md) — what this fork changed
  against hic-straw, and what measured it
- [CONTRIBUTING.md](CONTRIBUTING.md) — development and release steps

## Academic use

This package was written with funding from the [NHGRI](http://genome.gov) as
part of the [JBrowse](http://jbrowse.org) project. If you use it in an academic
project that you publish, please cite the most recent JBrowse paper, which will
be linked from [jbrowse.org](http://jbrowse.org).

If you use `.hic` files, please also cite the Juicer/Juicebox papers from the
[Aiden Lab](https://github.com/aidenlab), whose hic-straw this is derived from.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and release workflow.

## License

MIT, as is upstream hic-straw. See [LICENSE](LICENSE).
