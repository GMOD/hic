/**
 * A run of contact records, held struct-of-arrays.
 *
 * hic-straw models a contact as an object, and the whole read path inherits
 * that shape: a block holds `ContactRecord[]` and the window filter rebuilds
 * the array. A renderer then has to unpack that into typed arrays anyway, so a
 * contact was allocated several times over on its way to a vertex buffer — and
 * a matrix is routinely millions of contacts.
 *
 * The per-contact allocation is the obvious cost, but the block cache is the
 * expensive one: cached blocks are long-lived, so as objects they left millions
 * of live pointers for every GC to trace for the rest of the session. Twelve
 * bytes a contact here against ~50 for an object, and nothing for the collector
 * to walk.
 *
 * The three arrays are always exactly the same length — `bin1.length` is the
 * record count. Counts are float32 because that is what the file stores
 * (`getFloat`/`getShort`) and what a GPU renderer takes, so carrying them as
 * doubles only ever widened a value on its way back down to float32.
 */
export interface ContactRecords {
  bin1: Int32Array
  bin2: Int32Array
  counts: Float32Array
}
