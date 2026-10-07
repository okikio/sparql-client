import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { bundleGraph } from './bundle.ts'
import { processorRoots } from './ownership.ts'

const approved = ['file:///entry.ts', 'file:///core.ts']

function graph() {
  return {
    roots: ['file:///entry.ts'],
    redirects: {},
    modules: [
      {
        kind: 'esm',
        specifier: 'file:///entry.ts',
        dependencies: [{
          code: { specifier: 'file:///core.ts' },
          type: { specifier: 'npm:/oxigraph@0.5.9' },
        }],
      },
      { kind: 'esm', specifier: 'file:///core.ts' },
      { kind: 'npm', specifier: 'npm:/oxigraph@0.5.9', npmPackage: 'oxigraph@0.5.9' },
    ],
    npmPackages: { 'oxigraph@0.5.9': { name: 'oxigraph', dependencies: [] } },
  }
}

describe('runtime distribution graph', () => {
  it('ignores type-only dependencies and unrelated cached package metadata', () => {
    expect(bundleGraph(graph(), approved)).toEqual({
      modules: ['file:///core.ts', 'file:///entry.ts'],
      packages: [],
    })
  })
  it('permits explicit native subpaths but excludes their runtime edges from light roots', () => {
    for (const root of processorRoots) {
      const specifier = root.endsWith('/') ? `${root}mod.ts` : root
      const value = {
        roots: [specifier],
        redirects: {},
        npmPackages: {},
        modules: [{ kind: 'esm', specifier }],
      }
      expect(bundleGraph(value).modules).toEqual([specifier])
      expect(() => bundleGraph(value, undefined, processorRoots)).toThrow(Error)
    }
  })
  it('rejects a reachable optional package and a transitive engine dependency', () => {
    const direct = graph()
    direct.modules[0]!.dependencies![0]!.code.specifier = 'npm:/oxigraph@0.5.9'
    expect(() => bundleGraph(direct, approved)).toThrow(Error)
    expect(() =>
      bundleGraph({
        roots: ['npm:/bridge@1.0.0'],
        redirects: {},
        modules: [{ kind: 'npm', specifier: 'npm:/bridge@1.0.0', npmPackage: 'bridge@1.0.0' }],
        npmPackages: {
          'bridge@1.0.0': { name: 'bridge', dependencies: ['oxigraph@0.5.9'] },
          'oxigraph@0.5.9': { name: 'oxigraph', dependencies: [] },
        },
      })
    ).toThrow(Error)
  })
  it('rejects local node_modules, outside sources, and renamed external packages', () => {
    for (const specifier of ['file:///node_modules/renamed/index.js', 'file:///outside.ts']) {
      const value = graph()
      value.modules[0]!.dependencies![0]!.code.specifier = specifier
      value.modules.push({ kind: 'esm', specifier })
      expect(() => bundleGraph(value, approved)).toThrow(Error)
    }
    expect(() =>
      bundleGraph({
        roots: ['npm:/renamed@1.0.0'],
        redirects: {},
        modules: [{ kind: 'npm', specifier: 'npm:/renamed@1.0.0', npmPackage: 'renamed@1.0.0' }],
        npmPackages: { 'renamed@1.0.0': { name: 'renamed', dependencies: [] } },
      })
    ).toThrow(Error)
  })
  it('rejects unresolved or malformed graphs and redirect cycles', () => {
    for (
      const value of [null, {}, { ...graph(), modules: [] }, {
        ...graph(),
        redirects: { 'file:///entry.ts': 'file:///entry.ts' },
      }]
    ) {
      expect(() => bundleGraph(value, approved)).toThrow(TypeError)
    }
    const failedNode = graph()
    expect(() =>
      bundleGraph({
        ...failedNode,
        modules: failedNode.modules.map((module) => ({ ...module, error: 'Resolution failed' })),
      }, approved)
    ).toThrow(TypeError)
    const failedEdge = graph()
    expect(() =>
      bundleGraph({
        ...failedEdge,
        modules: [{
          ...failedEdge.modules[0],
          dependencies: [{ code: { specifier: 'file:///core.ts', error: 'Resolution failed' } }],
        }, ...failedEdge.modules.slice(1)],
      }, approved)
    ).toThrow(TypeError)
  })
})
