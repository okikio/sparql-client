/** Owned source boundaries for dependency-free public core packages. @module */

export const repository = new URL('../', import.meta.url)
export const names = [
  '@okikio/rdf',
  '@okikio/sparql',
  '@okikio/vocab',
  '@okikio/triplestore',
] as const
export const coreRoots = names.map((name) =>
  new URL(`packages/${name.slice('@okikio/'.length)}/`, repository).href
)

/**
 * Light RDF/SPARQL roots must not reach concrete syntax/standards processors. Explicit subpath
 * consumers remain allowed. Generic term serialization, lexical semantics and source adaptation
 * are core capabilities, so text/write/iri/language and ontology/shape/stream are not excluded.
 */
export const processorRoots = [
  'ntriples/',
  'nquads/',
  'turtle/',
  'trig/',
  'jsonld/',
  'canon/',
  'xml/',
  'rdfa/',
  'microdata/',
  'line.ts',
  'compact.ts',
  'markup.ts',
].map((path) => new URL(`packages/rdf/${path}`, repository).href)

/** Exact entry files or directory boundaries establish ownership; similarly named siblings do not. */
export function ownedModule(specifier: string, approved: readonly string[] = coreRoots): boolean {
  let url: URL
  try {
    url = new URL(specifier)
  } catch {
    return false
  }
  if (url.protocol !== 'file:') return false
  try {
    if (url.pathname.split('/').some((segment) => decodeURIComponent(segment) === 'node_modules')) {
      return false
    }
  } catch {
    return false
  }
  return approved.some((root) => root.endsWith('/') ? url.href.startsWith(root) : url.href === root)
}

/** Resolves traversal before checking a relative module's actual source boundary. */
export function allowed(specifier: string, fileName?: string): boolean {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return fileName !== undefined &&
      ownedModule(new URL(specifier, new URL(fileName, repository)).href)
  }
  return names.some((name) => specifier === name || specifier.startsWith(`${name}/`))
}
