/** Stack-independent positional permutations used by RDFC candidate exploration. @module */

/**
 * Yields candidates in source-position order without using the host call stack.
 *
 * Equal values retain distinct positions. Each yielded array belongs to the
 * consumer. Early return releases operation-local search state; the caller owns
 * the canonicalization work budget between candidates.
 */
export function* permutations(values: readonly string[]): Generator<string[]> {
  const source = [...values]
  if (source.length === 0) {
    yield []
    return
  }
  const used = new Uint8Array(source.length)
  const next = new Uint32Array(source.length)
  const chosen = new Uint32Array(source.length)
  const current: string[] = []
  let depth = 0
  while (depth >= 0) {
    if (depth === source.length) {
      yield [...current]
      depth--
      used[chosen[depth]!] = 0
      current.pop()
      continue
    }
    let position = next[depth]!
    while (position < source.length && used[position]) position++
    if (position === source.length) {
      next[depth] = 0
      depth--
      if (depth >= 0) {
        used[chosen[depth]!] = 0
        current.pop()
      }
      continue
    }
    next[depth] = position + 1
    chosen[depth] = position
    used[position] = 1
    current.push(source[position]!)
    depth++
    if (depth < source.length) next[depth] = 0
  }
}
