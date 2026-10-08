/** Bounded host input decoding. @module */
import { chunks, type TextSourceType, throwIfAborted } from '../text.ts'
/** Reads and decodes source chunks under one byte limit. */
export async function collect(
  source: TextSourceType,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const encoder = new TextEncoder()
  let bytes = 0
  let out = ''
  for await (const chunk of chunks(source, signal)) {
    throwIfAborted(signal)
    if (typeof chunk === 'string') {
      bytes += encoder.encode(chunk).byteLength
      out += decoder.decode() + chunk
    } else {
      bytes += chunk.byteLength
      out += decoder.decode(chunk, { stream: true })
    }
    if (bytes > maxBytes) throw new RangeError(`Markup input exceeds maxBytes (${maxBytes}).`)
  }
  return out + decoder.decode()
}
