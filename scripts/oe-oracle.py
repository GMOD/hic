"""Write test/data/test.oe.json: straw's observed and observed/expected for
region pairs of test/data/test.hic, the oracle `observedExpected.test.ts`
checks `getExpectedValues` against.

    uv venv --python 3.11 /tmp/straw && VIRTUAL_ENV=/tmp/straw uv pip install hic-straw
    /tmp/straw/bin/python -I scripts/oe-oracle.py
"""

import json
import pathlib

import hicstraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
HIC = str(ROOT / 'test' / 'data' / 'test.hic')

CASES = [
    ('1', '1', 2_500_000, 'KR'),
    ('1', '1', 2_500_000, 'NONE'),
    ('1:100000000:149999999', '1:120000000:199999999', 100_000, 'KR'),
    ('1', '1', 100_000, 'SCALE'),
    ('Y', 'Y', 2_500_000, 'VC_SQRT'),
    ('1', '2', 2_500_000, 'KR'),
    ('1', '2', 2_500_000, 'NONE'),
]

SAMPLE = 200


# straw's end is inclusive; the fixture stores the half-open region HicFile takes
def region(loc):
    chrom, *span = loc.split(':')
    return {'chr': chrom, 'start': int(span[0]), 'end': int(span[1]) + 1} if span else {'chr': chrom}


cases = []
for loc1, loc2, res, norm in CASES:
    observed = hicstraw.straw('observed', norm, HIC, loc1, loc2, 'BP', res)
    oe = hicstraw.straw('oe', norm, HIC, loc1, loc2, 'BP', res)
    ratio = {(r.binX, r.binY): r.counts for r in oe}
    step = max(1, len(observed) // SAMPLE)
    records = [
        [r.binX // res, r.binY // res, r.counts, ratio[(r.binX, r.binY)]]
        for r in observed[::step]
        if (r.binX, r.binY) in ratio
    ]
    cases.append({
        'region1': region(loc1),
        'region2': region(loc2),
        'binsize': res,
        'normalization': norm,
        'records': records,
    })

out = ROOT / 'test' / 'data' / 'test.oe.json'
out.write_text(json.dumps(cases) + '\n')
print(out, [len(c['records']) for c in cases])
