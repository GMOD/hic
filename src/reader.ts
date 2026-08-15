import type { Reader } from './types.ts'
import type { GenericFilehandle } from 'generic-filehandle2'

export function readerFromFilehandle(filehandle: GenericFilehandle): Reader {
  return {
    async read(position: number, length: number) {
      const buf = await filehandle.read(length, position)
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    },
  }
}
