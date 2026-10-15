## [2.0.0](https://github.com/GMOD/hic/compare/v1.3.2...v2.0.0) (2026-10-15)

### Features

- **BREAKING** Drop the units parameter and chromosome-name aliasing ([ca14ac8](https://github.com/GMOD/hic/commit/ca14ac8d300e60a67f49767ad01afd64ddaaec09))

### Other Changes

- Rewrite AI-writing tropes in README and docs ([2d921ca](https://github.com/GMOD/hic/commit/2d921ca8850c0f942de36699e47498b01bf57d54))
- Restore claims changed by the tropes rewrite ([087b1ec](https://github.com/GMOD/hic/commit/087b1ecf95f3c17ed09aecc772535cbfd17b12da))
- Fold short verdict sentences into their neighbours ([03b32c9](https://github.com/GMOD/hic/commit/03b32c93fb60fca1f2306db2cf49c5430c002027))
- Fix doc errors found in the tropes audit ([cf46b18](https://github.com/GMOD/hic/commit/cf46b188ba1b936ccab8135c3d10bab9d22bcda9))
- Restore wording the tropes rewrite changed without a trope ([cfaac1c](https://github.com/GMOD/hic/commit/cfaac1cb848c5ac70dd68f51ae3b24fe7d8dcd60))
- Trim README and docs wordiness ([30c1c4f](https://github.com/GMOD/hic/commit/30c1c4fc7a90faf6ebc8ee5890933a449213f5f0))
- Fetch an inter-chromosomal pair's two vectors concurrently ([722e2e1](https://github.com/GMOD/hic/commit/722e2e178857794e41bb4a686a445e79a8d82890))
- Stop writing nvi into the caller's config, and loop the index refill ([067a901](https://github.com/GMOD/hic/commit/067a901a34e5f6eadd39e52b7614a897725628ad))
- Drop BufferedFile's unreachable branches ([7ffadf6](https://github.com/GMOD/hic/commit/7ffadf62d48f65251478fc04a653ec21ffe518e4))
- Reword two new comments flagged by the tropes scan ([d1c6c00](https://github.com/GMOD/hic/commit/d1c6c00ca77cb62a033c6a9a3f6ad7a96455caa9))
- Share in-flight block reads through SharedReadCache ([b6fe438](https://github.com/GMOD/hic/commit/b6fe438500dedf7c59e0553e9af110587414c6ef))

## [1.3.2](https://github.com/GMOD/hic/compare/v1.3.1...v1.3.2) (2026-10-11)

### Documentation

- Plainer README wording ([5de84bc](https://github.com/GMOD/hic/commit/5de84bcd8488df93c10db971e47c46604f7d4a00))
- Say which contacts a normalization leaves out ([54b0347](https://github.com/GMOD/hic/commit/54b0347554f4fba98e8f4f6a9a8e0b1270ec02a5))
- Break up README walls of text ([f08c26e](https://github.com/GMOD/hic/commit/f08c26eedce2d4de107f5addd5c8c6ff251cb71a))

### Tests

- Fail when docs/api.md misses a public member or export ([bb35c60](https://github.com/GMOD/hic/commit/bb35c60bea584ec73356b93ae603690bdf289fe4))

## [1.3.1](https://github.com/GMOD/hic/compare/v1.3.0...v1.3.1) (2026-10-09)

### Chores

- Bump @gmod/shared-read-cache to 2.0.0 ([a9aa08e](https://github.com/GMOD/hic/commit/a9aa08e86273c7a3f850ac71e34cd68dae069b37))

## [1.3.0](https://github.com/GMOD/hic/compare/v1.2.1...v1.3.0) (2026-10-01)

### Documentation

- Say what the read pattern actually is before recommending the range cache ([a20f191](https://github.com/GMOD/hic/commit/a20f1910b6ffef5c98fb44aca32e49ec0719b3af))
- Measure the hic-straw comparison instead of asserting it ([f6aeda7](https://github.com/GMOD/hic/commit/f6aeda75076469b73d6250754315c2e32d3b365b))
- Restore the Not DecompressionStream heading, for the external anchor ([2ffcec0](https://github.com/GMOD/hic/commit/2ffcec0d94229f80d012be7f175a763df6458c1c))
- Cut dataflow.md's overlap with optimizations.md ([3045ec0](https://github.com/GMOD/hic/commit/3045ec08f5fa07daa38969a20c6753f24fe6843a))
- Cite hic-straw source lines, and drop a claim that doesn't reproduce ([efa4458](https://github.com/GMOD/hic/commit/efa44586e119c0010def761d243058b3faf80ffe))
- Drop two-line subtext labels from the dataflow diagram ([cdd96cc](https://github.com/GMOD/hic/commit/cdd96cc6dbea9b90e5b9d8d7feaf2805e9e47c47))
- Spell out ContactRecords' typed-array shape on the dataflow diagram ([d5e068d](https://github.com/GMOD/hic/commit/d5e068d3249d387e8e566c85195813c39fd72356))
- State dataflow.md's results positively instead of by negation ([ee973ec](https://github.com/GMOD/hic/commit/ee973ecf07118477f8fc3c502cd1e48b3282359d))
- Fix agency, contrastive framing, and figures of speech in prose ([465caee](https://github.com/GMOD/hic/commit/465caee9ce56b5c0cc17cfc9f21d8a142e607938))

### Features

- Honour an AbortSignal on every read ([47fac3e](https://github.com/GMOD/hic/commit/47fac3e19767501d2d1a34525763c8429188a4a5))

### Other Changes

- Point the dataflow SYNC note at gbz-base-js ([ccefe53](https://github.com/GMOD/hic/commit/ccefe53653851de0b9500c10bd7c86c88d2aa9a8))

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

