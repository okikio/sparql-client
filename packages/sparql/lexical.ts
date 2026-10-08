/** Complete SPARQL token validation, independent of source scanning. @module */

/** PN_CHARS_BASE excludes underscore; local names and variables add it explicitly. */
const BASE =
  'A-Za-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}'
const CHARS = `${BASE}_0-9\\-\\u00B7\\u0300-\\u036F\\u203F-\\u2040`
const PLX = "(?:%[0-9A-Fa-f]{2}|\\\\[_~.\\-!$&'()*+,;=/?#@%])"
const PREFIX = new RegExp(`^(?:[${BASE}](?:[${CHARS}.]*[${CHARS}])?)?$`, 'u')
const LOCAL = new RegExp(
  `^(?:[${BASE}_:0-9]|${PLX})(?:(?:[${CHARS}.:]|${PLX})*(?:[${CHARS}:]|${PLX}))?$`,
  'u',
)
/** Full VARNAME token; a leading digit is permitted by SPARQL. */
export const VARNAME = new RegExp(
  `^[${BASE}_0-9][${BASE}_0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$`,
  'u',
)

/** Rejects semantic IRI inputs that cannot be emitted as an ordinary absolute IRIREF. */
export function iri(value: string): void {
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
    throw new TypeError('IRI must have an absolute scheme.')
  }
  for (const char of value) {
    const point = char.codePointAt(0)!
    if (point <= 0x20 || '<>"{}|^`\\'.includes(char) || (point >= 0xd800 && point <= 0xdfff)) {
      throw new TypeError('IRI contains a character forbidden by IRIREF.')
    }
  }
}

/** Validates the whole PN_PREFIX production, including the default empty prefix. */
export function prefix(value: string): void {
  if (!PREFIX.test(value)) throw new TypeError('Prefix does not match PN_PREFIX.')
}

/** Validates a prefixed name without confusing local colons with its separating colon. */
export function prefixed(value: string): void {
  const index = value.indexOf(':')
  if (index < 0) throw new TypeError('Prefixed name needs a colon.')
  prefix(value.slice(0, index))
  const local = value.slice(index + 1)
  if (local !== '' && !LOCAL.test(local)) throw new TypeError('Local name does not match PN_LOCAL.')
}

/** Validates SPARQL LANGTAG spelling; this is not a language-registry lookup. */
export function language(value: string): void {
  if (!/^[A-Za-z]+(?:-[A-Za-z0-9]+)*$/.test(value)) {
    throw new TypeError('Language tag does not match LANGTAG.')
  }
}

/** Validates a complete BLANK_NODE_LABEL without its _: prefix. */
export function blank(value: string): void {
  const spelling = new RegExp(`^[${BASE}_0-9](?:[${CHARS}.]*[${CHARS}])?$`, 'u')
  if (!spelling.test(value)) {
    throw new TypeError('Blank node label does not match BLANK_NODE_LABEL.')
  }
}

/** Character admission is provisional for UTF-16 halves; complete tokens validate scalar ranges. */
const VAR_START = new RegExp(`^[${BASE}_0-9\\uD800-\\uDFFF]$`, 'u')
const VAR_CONTINUE = new RegExp(
  `^[${BASE}_0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040\\uD800-\\uDFFF]$`,
  'u',
)
const PN_START = new RegExp(`^[${BASE}_\\uD800-\\uDFFF]$`, 'u')
const PN_CONTINUE = new RegExp(`^[${CHARS}.:\\uD800-\\uDFFF]$`, 'u')
/** Scanner candidate character for VARNAME, followed by complete-token validation. */
export function varStart(value: string): boolean {
  return VAR_START.test(value)
}
/** Scanner candidate continuation for VARNAME. */
export function varContinue(value: string): boolean {
  return VAR_CONTINUE.test(value)
}
/** Scanner candidate start for PN_PREFIX or a keyword. */
export function pnStart(value: string): boolean {
  return PN_START.test(value)
}
/** Scanner candidate continuation for prefixed names. */
export function pnContinue(value: string): boolean {
  return PN_CONTINUE.test(value)
}
