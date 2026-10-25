/** RDF IRI resolution preserves lexical identity using RFC 3986 section 5.2. @module */

/** Resolves an IRI reference without browser URL host, Unicode, or percent normalization. */
export function resolve(reference: string, base?: string): string {
  const ref = parts(reference)
  if (ref.scheme) return join({ ...ref, path: dots(ref.path) })
  if (base === undefined) throw new TypeError(`Relative IRI '${reference}' requires a base IRI.`)
  const origin = parts(base)
  if (!origin.scheme) throw new TypeError(`Base IRI '${base}' must be absolute.`)
  if (ref.authority !== undefined) {
    return join({ ...ref, scheme: origin.scheme, path: dots(ref.path) })
  }
  const path = ref.path === '' ? origin.path : ref.path.startsWith('/') ? dots(ref.path) : dots(
    origin.authority !== undefined && origin.path === ''
      ? `/${ref.path}`
      : `${origin.path.slice(0, origin.path.lastIndexOf('/') + 1)}${ref.path}`,
  )
  return join({
    scheme: origin.scheme,
    authority: origin.authority,
    path,
    query: ref.path === '' && ref.query === undefined ? origin.query : ref.query,
    fragment: ref.fragment,
  })
}

/** Parsed RFC 3986 components; delimiters remain attached so empty components remain distinct. */
interface PartsType {
  readonly scheme?: string
  readonly authority?: string
  readonly path: string
  readonly query?: string
  readonly fragment?: string
}

/** Splits an IRI reference without transforming its Unicode scalar values. */
function parts(value: string): PartsType {
  const match = /^(?:([A-Za-z][A-Za-z0-9+.-]*:))?(\/\/[^/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?$/su.exec(
    value,
  )
  if (!match) throw new TypeError(`Invalid IRI reference '${value}'.`)
  return {
    scheme: match[1],
    authority: match[2],
    path: match[3]!,
    query: match[4],
    fragment: match[5],
  }
}

/** Recombines components without adding trailing slashes or changing their spelling. */
function join(value: PartsType): string {
  return `${value.scheme ?? ''}${value.authority ?? ''}${value.path}${value.query ?? ''}${
    value.fragment ?? ''
  }`
}

/** Removes only literal dot segments according to RFC 3986; encoded dots remain data. */
function dots(value: string): string {
  let input = value, output = ''
  while (input) {
    if (input.startsWith('../')) input = input.slice(3)
    else if (input.startsWith('./')) input = input.slice(2)
    else if (input.startsWith('/./')) input = input.slice(2)
    else if (input === '/.') input = '/'
    else if (input.startsWith('/../') || input === '/..') {
      input = input === '/..' ? '/' : input.slice(3)
      output = output.slice(0, output.lastIndexOf('/'))
    } else if (input === '.' || input === '..') input = ''
    else {
      const next = input.indexOf('/', input.startsWith('/') ? 1 : 0)
      if (next < 0) {
        output += input
        input = ''
      } else {
        output += input.slice(0, next)
        input = input.slice(next)
      }
    }
  }
  return output
}
