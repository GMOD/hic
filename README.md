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

In the browser, or for a file over HTTP, pass a `filehandle` from
[`generic-filehandle2`](https://www.npmjs.com/package/generic-filehandle2)
instead of a `path`:

```js
import { RemoteFile } from 'generic-filehandle2'

const hic = new HicFile({
  filehandle: new RemoteFile('https://example.com/file.hic'),
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
  window sits left of its y window gets swapped before it goes out;
  `transposed` says so, and `bin1` then runs along `region2`.
- `appliedNormalization` names the normalization the file actually applied,
  which is not always the one you asked for — a `.hic` carries normalization
  vectors per (type, chromosome, unit, binsize), so it can offer KR at 5 kb and
  nothing at 2.5 Mb.
- `BP` is the only unit this fork supports; it drops the FRAG code paths.

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
