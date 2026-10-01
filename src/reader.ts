import type { BaseOpts, Reader } from './types.ts'
import type { GenericFilehandle } from 'generic-filehandle2'

export function readerFromFilehandle(filehandle: GenericFilehandle): Reader {
  return {
    async read(position: number, length: number, opts?: BaseOpts) {
      const buf = await filehandle.read(length, position, {
        signal: opts?.signal,
      })
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    },
  }
}
