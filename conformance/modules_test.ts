import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { dependencyErrors, references } from './modules.ts'

describe('structural core dependency inspection', () => {
  it('ignores comments, ordinary strings and erased type references', () => {
    const source = `
      // import { Store } from 'oxigraph'
      /* export * from 'jsonld'; import('testcontainers') */
      const documentation = "import('oxigraph')";
      const template = \`export * from 'jsonld'\`;
      import type { Store } from 'oxigraph';
      import { type Thing } from 'jsonld';
      export type { Engine } from '@comunica/query-sparql';
      type Remote = import('oxigraph').Store;
      export { namedNode } from '@okikio/rdf';
    `
    expect(dependencyErrors(source)).toEqual([])
    expect(references(source).filter((value) => value.kind === 'runtime')).toEqual([
      { kind: 'runtime', specifier: '@okikio/rdf' },
    ])
  })
  it('recognizes actual multiline static, side-effect, mixed type/value and require declarations', () => {
    for (
      const source of [
        `import /* comment */ {\n Store\n} from 'oxigraph';`,
        `import\n 'jsonld';`,
        `export\n *\n from 'rdf-canonize';`,
        `import { type Thing, actual } from 'jsonld';`,
        `export { type Thing, actual } from 'jsonld';`,
        `import engine = require('oxigraph');`,
      ]
    ) expect(dependencyErrors(source)).toHaveLength(1)
    expect(
      dependencyErrors(
        `import { namedNode } from '@okikio/rdf'; export * from './terms.ts';`,
        'packages/rdf/mod.ts',
      ),
    )
      .toEqual([])
  })
  it('resolves relative ownership and rejects traversal into adapters or node_modules', () => {
    const file = 'packages/rdf/format/parse.ts'
    for (
      const target of [
        '../../comunica/mod.ts',
        '../../../node_modules/engine/index.js',
        '../../../outside.ts',
        '../../../packages/rdf-extra/mod.ts',
        '../node_modules/engine.ts',
      ]
    ) {
      expect(dependencyErrors(`import '${target}';`, file)).toHaveLength(1)
    }
    for (const target of ['../mod.ts', '../../sparql/mod.ts', '../../vocab/mod.ts']) {
      expect(dependencyErrors(`import '${target}';`, file)).toEqual([])
    }
  })
  it('rejects actual dynamic calls with strings, templates and computed expressions', () => {
    for (
      const source of [
        `const load = () => import('oxigraph');`,
        'const load = () => import(`./terms.ts`);',
        `const target = './terms.ts'; const load = () => import(target);`,
        'const load = (name: string) => import(`./${name}.ts`);',
      ]
    ) expect(references(source).filter((value) => value.kind === 'dynamic')).toHaveLength(1)
    for (
      const source of [
        `import('./terms.ts');`,
        `import(target);`,
      ]
    ) expect(dependencyErrors(source)).toHaveLength(1)
  })
  it('rejects malformed syntax instead of returning incomplete inspection', () => {
    expect(() => references(`import { from 'oxigraph'`)).toThrow(TypeError)
  })
})
