/** Traverses Deno's resolved runtime module graph for distribution isolation evidence. @module */

import { coreRoots, ownedModule } from './ownership.ts'

interface ModuleType {
  readonly specifier: string
  readonly kind: string
  readonly error?: unknown
  readonly npmPackage?: string
  readonly dependencies?: readonly {
    readonly code?: { readonly specifier?: string; readonly error?: unknown }
  }[]
}
interface PackageType {
  readonly name: string
  readonly dependencies: readonly string[]
}

/**
 * Uses graph edges and package identities, not text in generated JavaScript. The npmPackages table
 * can include unrelated cached packages, so only runtime-reachable IDs are checked. Type-only edges
 * do not enter a browser artifact. Runtime graph isolation is deliberately stronger than shaking
 * an unused optional import out of one particular consumer bundle.
 */
export function bundleGraph(
  value: unknown,
  approved: readonly string[] = coreRoots,
  excluded: readonly string[] = [],
): { modules: string[]; packages: string[] } {
  if (
    !record(value) || !Array.isArray(value.roots) || value.roots.length === 0 ||
    !Array.isArray(value.modules) || !record(value.redirects) || !record(value.npmPackages)
  ) {
    throw new TypeError('Unsupported Deno module graph schema.')
  }
  const graph = value
  const modules = new Map<string, ModuleType>()
  for (const item of graph.modules as unknown[]) {
    if (
      !record(item) || typeof item.specifier !== 'string' || typeof item.kind !== 'string' ||
      modules.has(item.specifier)
    ) {
      throw new TypeError('Malformed or duplicate module graph node.')
    }
    modules.set(item.specifier, item as unknown as ModuleType)
  }
  const visited = new Set<string>(), packages = new Map<string, string>()
  function npm(id: string): void {
    if (packages.has(id)) return
    const item = graph.npmPackages as Record<string, unknown>
    const metadata = item[id]
    if (
      !record(metadata) || typeof metadata.name !== 'string' ||
      !Array.isArray(metadata.dependencies)
    ) {
      throw new TypeError(`Missing npm graph metadata for ${id}.`)
    }
    const node = metadata as unknown as PackageType
    packages.set(id, node.name)

    for (const dependency of node.dependencies) {
      if (typeof dependency !== 'string') throw new TypeError('Malformed npm dependency edge.')
      npm(dependency)
    }
  }
  function visit(input: unknown): void {
    if (typeof input !== 'string') throw new TypeError('Malformed module graph root or edge.')
    let specifier = input
    const redirects = graph.redirects as Record<string, unknown>
    const seen = new Set<string>()
    while (Object.hasOwn(redirects, specifier)) {
      if (seen.has(specifier) || typeof redirects[specifier] !== 'string') {
        throw new TypeError('Malformed module redirect.')
      }
      seen.add(specifier)
      specifier = redirects[specifier] as string
    }
    if (visited.has(specifier)) return
    visited.add(specifier)
    const module = modules.get(specifier)
    if (!module) throw new TypeError(`Missing runtime graph node ${specifier}.`)
    if (module.error !== undefined) {
      throw new TypeError(`Unresolved runtime graph node ${specifier}.`)
    }
    if (ownedModule(specifier, excluded)) {
      throw new Error(`Concrete processor ${specifier} enters a light root graph.`)
    }
    if (module.kind !== 'npm' && !ownedModule(specifier, approved)) {
      throw new Error(`Runtime module ${specifier} is outside approved core source.`)
    }
    if (module.kind === 'npm') {
      if (typeof module.npmPackage !== 'string') {
        throw new TypeError('Missing npm package identity.')
      }
      npm(module.npmPackage)
    }
    for (const dependency of module.dependencies ?? []) {
      if (dependency.code) {
        if (dependency.code.error !== undefined) {
          throw new TypeError(`Unresolved runtime graph edge from ${specifier}.`)
        }
        visit(dependency.code.specifier)
      }
    }
  }
  for (const root of graph.roots as unknown[]) visit(root)
  if (packages.size) {
    throw new Error(
      `External runtime dependencies enter the light core graph: ${
        [...packages.values()].join(', ')
      }.`,
    )
  }
  return { modules: [...visited].sort(), packages: [...packages.values()].sort() }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
