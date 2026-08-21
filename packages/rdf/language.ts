/** BCP 47 language-tag validation shared by RDF concrete syntaxes. @module */

/** RFC 5646 grandfathered tags that do not follow the modern `langtag` production. */
const GRANDFATHERED = new Set([
  'art-lojban',
  'cel-gaulish',
  'en-gb-oed',
  'i-ami',
  'i-bnn',
  'i-default',
  'i-enochian',
  'i-hak',
  'i-klingon',
  'i-lux',
  'i-mingo',
  'i-navajo',
  'i-pwn',
  'i-tao',
  'i-tay',
  'i-tsu',
  'no-bok',
  'no-nyn',
  'sgn-be-fr',
  'sgn-be-nl',
  'sgn-ch-de',
  'zh-guoyu',
  'zh-hakka',
  'zh-min',
  'zh-min-nan',
  'zh-xiang',
])

/** Returns whether one subtag consists only of ASCII letters. */
function alpha(value: string, min: number, max = min): boolean {
  return value.length >= min && value.length <= max && /^[A-Za-z]+$/.test(value)
}

/** Returns whether one subtag consists only of ASCII letters and digits. */
function alnum(value: string, min: number, max = min): boolean {
  return value.length >= min && value.length <= max && /^[A-Za-z0-9]+$/.test(value)
}

/**
 * Checks the RFC 5646 well-formed language-tag grammar used by RDF literals.
 *
 * RDF 1.2 concrete syntaxes first match their intentionally broad `LANG_DIR`
 * terminal and then require its language component to be well-formed BCP 47.
 * This function validates the RFC grammar directly. It does not use `Intl`
 * because JavaScript runtimes can reject valid grandfathered or private-use
 * tags that RDF parsers must still accept.
 */
export function valid(value: string): boolean {
  const lower = value.toLowerCase()
  if (GRANDFATHERED.has(lower)) return true

  const parts = value.split('-')
  if (parts.some((part) => part.length === 0)) return false

  // `privateuse = "x" 1*("-" (1*8alphanum))`
  if (parts[0]?.toLowerCase() === 'x') {
    return parts.length > 1 && parts.slice(1).every((part) => alnum(part, 1, 8))
  }

  let index = 0
  const primary = parts[index++]
  if (!primary) return false

  if (alpha(primary, 2, 3)) {
    // A 2-3 letter primary language may carry up to three 3-letter extlangs.
    let extlangs = 0
    while (extlangs < 3 && parts[index] !== undefined && alpha(parts[index]!, 3)) {
      index++
      extlangs++
    }
  } else if (!alpha(primary, 4) && !alpha(primary, 5, 8)) {
    return false
  }

  if (parts[index] !== undefined && alpha(parts[index]!, 4)) index++
  if (
    parts[index] !== undefined &&
    (alpha(parts[index]!, 2) || /^[0-9]{3}$/.test(parts[index]!))
  ) {
    index++
  }

  const variants = new Set<string>()
  while (parts[index] !== undefined) {
    const part = parts[index]!
    const variant = alnum(part, 5, 8) || /^[0-9][A-Za-z0-9]{3}$/.test(part)
    if (!variant) break
    const key = part.toLowerCase()
    if (variants.has(key)) return false
    variants.add(key)
    index++
  }

  const singletons = new Set<string>()
  while (parts[index] !== undefined && /^[0-9A-WY-Za-wy-z]$/.test(parts[index]!)) {
    const singleton = parts[index]!.toLowerCase()
    if (singletons.has(singleton)) return false
    singletons.add(singleton)
    index++
    const start = index
    while (parts[index] !== undefined && alnum(parts[index]!, 2, 8)) index++
    if (index === start) return false
  }

  if (parts[index]?.toLowerCase() === 'x') {
    index++
    const start = index
    while (parts[index] !== undefined && alnum(parts[index]!, 1, 8)) index++
    if (index === start) return false
  }

  return index === parts.length
}
