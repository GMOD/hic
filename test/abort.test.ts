import { LocalFile } from 'generic-filehandle2'
import { expect, test, vi } from 'vitest'

import { TEST_HIC, openTestHicInMemory } from './testFile.ts'
import { HicFile } from '../src/index.ts'

import type { BaseOpts, HicRegion, Reader } from '../src/index.ts'

const RES = 100_000
const CHR1: HicRegion = { chr: '1', start: 0, end: 20_000_000 }
// Same matrix and vectors as CHR1, other blocks.
const FAR: HicRegion = { chr: '1', start: 200_000_000, end: 220_000_000 }

/**
 * Holds every read until `resume`, and rejects a held read when its signal
 * aborts — what a `RemoteFile` does with a fetch in flight. A read whose signal
 * never arrives stays held, so a dropped signal shows up as a hang.
 */
function pausableReader(inner: Reader, { honoursSignal = true } = {}) {
  let paused = false
  let held: (() => void)[] = []
  const state = { aborted: 0 }
  return {
    state,
    held: () => held.length,
    pause() {
      paused = true
    },
    resume() {
      paused = false
      const batch = held
      held = []
      for (const release of batch) {
        release()
      }
    },
    read(position: number, length: number, opts?: BaseOpts) {
      if (!paused) {
        return inner.read(position, length, opts)
      }
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const signal = honoursSignal ? opts?.signal : undefined
        signal?.addEventListener(
          'abort',
          () => {
            state.aborted++
            reject(signal.reason as Error)
          },
          { once: true },
        )
        held.push(() => {
          resolve(inner.read(position, length, opts))
        })
      })
    },
  }
}

async function heldFile(opts?: { honoursSignal?: boolean }) {
  const reader = pausableReader(await openTestHicInMemory(), opts)
  return { reader, hic: new HicFile({ reader }) }
}

async function krCount(hic: HicFile, opts?: BaseOpts) {
  const { records, appliedNormalization } = await hic.getContactRecords(
    'KR',
    CHR1,
    CHR1,
    'BP',
    RES,
    opts,
  )
  expect(appliedNormalization).toBe('KR')
  return records.bin1.length
}

async function expectedKrCount() {
  return krCount(new HicFile({ reader: await openTestHicInMemory() }))
}

test('aborting getMetaData mid-read rejects, and the next call parses afresh', async () => {
  const { reader, hic } = await heldFile()
  reader.pause()
  const controller = new AbortController()
  const p = hic.getMetaData({ signal: controller.signal })
  await vi.waitFor(() => {
    expect(reader.held()).toBe(1)
  })
  controller.abort()

  await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  expect(reader.state.aborted).toBe(1)

  reader.resume()
  const meta = await hic.getMetaData()
  expect(meta.genome).toBe('hg19')
  expect(meta.chromosomes.length).toBe(26)
})

test('aborting getContactRecords mid-read rejects, and the next call returns every record', async () => {
  const { reader, hic } = await heldFile()
  await hic.getMetaData()
  reader.pause()
  const controller = new AbortController()
  const p = krCount(hic, { signal: controller.signal })
  await vi.waitFor(() => {
    expect(reader.held()).toBeGreaterThan(0)
  })
  controller.abort()

  await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  expect(reader.state.aborted).toBe(reader.held())

  reader.resume()
  expect(await krCount(hic)).toBe(await expectedKrCount())
})

// Cold, the abort lands on the header read; with the header and index warm, on
// the matrix and normalization-vector reads.
test.each([
  ['the header', () => Promise.resolve()],
  ['a matrix and its vectors', (hic: HicFile) => hic.getNormalizationOptions()],
])(
  'one caller aborting leaves another caller of %s intact',
  async (_name, warm) => {
    const { reader, hic } = await heldFile()
    await warm(hic)
    reader.pause()
    const controller = new AbortController()
    const leaving = krCount(hic, { signal: controller.signal })
    const staying = krCount(hic)
    await vi.waitFor(() => {
      expect(reader.held()).toBeGreaterThan(0)
    })
    controller.abort()
    await expect(leaving).rejects.toMatchObject({ name: 'AbortError' })

    reader.resume()
    expect(await staying).toBe(await expectedKrCount())
  },
)

// The pre-v9 walk logs and swallows a failed read, answering "no
// normalization". An abort swallowed there would cache that answer for the
// life of the file.
test('aborting the normalization-index walk does not cache an empty index', async () => {
  const { reader, hic } = await heldFile()
  await hic.getMetaData()
  reader.pause()
  const controller = new AbortController()
  const p = hic.getNormalizationOptions({ signal: controller.signal })
  await vi.waitFor(() => {
    expect(reader.held()).toBe(1)
  })
  controller.abort()
  await expect(p).rejects.toMatchObject({ name: 'AbortError' })

  reader.resume()
  await expect(hic.getNormalizationOptions()).resolves.toEqual([
    'NONE',
    'VC',
    'VC_SQRT',
    'KR',
    'SCALE',
  ])
})

test('a reader that ignores the signal still cancels once its read lands', async () => {
  const { reader, hic } = await heldFile({ honoursSignal: false })
  await krCount(hic)
  reader.pause()
  const controller = new AbortController()
  const p = hic.getContactRecords('KR', FAR, FAR, 'BP', RES, {
    signal: controller.signal,
  })
  await vi.waitFor(() => {
    expect(reader.held()).toBeGreaterThan(0)
  })
  controller.abort()
  reader.resume()
  await expect(p).rejects.toMatchObject({ name: 'AbortError' })
})

test('an already-aborted signal reads nothing', async () => {
  const { reader, hic } = await heldFile()
  reader.pause()
  await expect(
    hic.getContactRecords('KR', CHR1, CHR1, 'BP', RES, {
      signal: AbortSignal.abort(),
    }),
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(reader.held()).toBe(0)
})

test('every filehandle read of a cold fetch carries a signal', async () => {
  const inner = new LocalFile(TEST_HIC)
  const unsignalled: number[] = []
  const filehandle = Object.assign(Object.create(inner) as LocalFile, {
    read(length: number, position: number, opts?: BaseOpts) {
      if (!opts?.signal) {
        unsignalled.push(position)
      }
      return inner.read(length, position, opts)
    },
  })
  const hic = new HicFile({ filehandle })
  await krCount(hic, { signal: new AbortController().signal })
  expect(unsignalled).toEqual([])
})
