## [1.2.1](https://github.com/GMOD/hic/compare/v1.2.0...v1.2.1) (2026-08-22)

### Bug Fixes

- A region past the end of a chromosome no longer reads a negative length ([680521a](https://github.com/GMOD/hic/commit/680521a39affffc09bb536bac18d4901df30cc41))

### Tests

- Measure read depth off an in-memory fixture, not the page cache ([0cb00b4](https://github.com/GMOD/hic/commit/0cb00b4e67c64ab626a632d8826c4571d054b92f))

## [1.2.0](https://github.com/GMOD/hic/compare/v1.1.0...v1.2.0) (2026-08-22)

### Features

- Report progress from block reads and the normalization-index walk ([07226f5](https://github.com/GMOD/hic/commit/07226f5aef413b9fef516c36ee4a4ef5c49f7ba3))

## [1.1.0](https://github.com/GMOD/hic/compare/...v1.1.0) (2026-08-17)

### Documentation

- Why not DecompressionStream, with the block-size sweep ([cd1edc6](https://github.com/GMOD/hic/commit/cd1edc6f1bc3102b3c1bed1eb6f9a9ffee4ed56e))
- Replace the synthetic DecompressionStream sweep with real block measurements ([65a479d](https://github.com/GMOD/hic/commit/65a479d214a79da33a7cf4508df993e91a202ddd))
- The first publish cannot be a trusted one, and npm trust needs 11.15.0 ([03537c6](https://github.com/GMOD/hic/commit/03537c6d8debff1e3382ccbfa0825362ad80d4cf))
- Correct the publish bootstrap ([9b9a729](https://github.com/GMOD/hic/commit/9b9a729fc7df04733a97fa19c8a9529db44cd055))
- Trim the one-time publish bootstrap now that it is done ([174b99f](https://github.com/GMOD/hic/commit/174b99f924385abd4102d4717d52ce0011c6ce98))
- Put the prose in the active voice ([3422488](https://github.com/GMOD/hic/commit/3422488dc7c5f34244bbc95d61abd5cec07d6831))
- Correct the release command in CONTRIBUTING, and its voice ([8db3282](https://github.com/GMOD/hic/commit/8db32826f6ec7da64bb1ea2394d87a416b5a0876))
- Describe the release gate CONTRIBUTING actually runs ([ec22015](https://github.com/GMOD/hic/commit/ec22015eecd5635e0a45b8cc960ea71094251ad2))
- Add a dataflow diagram ([8144ab5](https://github.com/GMOD/hic/commit/8144ab5f567c2dd09816687f892518df068656af))
- Correct two edges in the dataflow diagram, and tighten its prose ([5fe2b1b](https://github.com/GMOD/hic/commit/5fe2b1b184aa509c6d9d25aa89d012f686e13ce4))
- Teach the .hic vocabulary the dataflow diagram assumes ([bf202cd](https://github.com/GMOD/hic/commit/bf202cd94c272a37fd16393346fe21383eb75453))
- Tighten optimizations.md and correct three claims against hic-straw 2.1.4 ([e435fc7](https://github.com/GMOD/hic/commit/e435fc73d24d80489a91b6d98bdfffd8e91e1a8a))
- Cut the parts of optimizations.md that api.md or the prose already said ([6794c55](https://github.com/GMOD/hic/commit/6794c55fd847df3927db91862d7563bc4db3b686))
- Say that round trips, not CPU, are what a remote fetch spends ([bcbef89](https://github.com/GMOD/hic/commit/bcbef89a6e537414d2895bd4e6fcd8a9eeb0e369))
- Measure the round-trip cost on a real file in a real browser ([28a87ac](https://github.com/GMOD/hic/commit/28a87ac14324e93e7ab5b72b4598ae8f3e2ab949))

### Features

- Fork hic-straw as @gmod/hic ([ba507c6](https://github.com/GMOD/hic/commit/ba507c6de27473ca7cca624fc3d4ca5449d49e82))
- Make the block cache's memory ceiling configurable, and close the API surface ([c5357b4](https://github.com/GMOD/hic/commit/c5357b46fef4fee5fe46be349ca96e40438b1e9d))
- Commit the benchmarks behind docs/optimizations.md, and fix what they disprove ([f57d329](https://github.com/GMOD/hic/commit/f57d3291e7f4ae211f2e5ac44d87205ed00119db))
- Inflate blocks through @gmod/inflate instead of pako ([f8a0912](https://github.com/GMOD/hic/commit/f8a09129bdf181002d16a1bff03a3958b31c6703))

### Tests

- Gate releases on the packed tarball, not just src/ ([654cbd6](https://github.com/GMOD/hic/commit/654cbd67050b7a7af2f0d371708aaad1aef8ef45))

