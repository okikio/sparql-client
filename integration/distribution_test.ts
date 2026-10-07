import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { toFileUrl } from '@std/path'
import { bundleGraph } from '../conformance/bundle.ts'
import { coreRoots, processorRoots } from '../conformance/ownership.ts'

/** Inspects actual Deno parser output without executing the fixture's imports. */
async function inspect(path: string): Promise<unknown> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      'info',
      '--json',
      '--no-config',
      '--no-lock',
      '--node-modules-dir=none',
      '--no-remote',
      path,
    ],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr))
  return JSON.parse(new TextDecoder().decode(result.stdout))
}

describe('actual distribution dependency graph', () => {
  it('distinguishes data/comment text and erased imports from an actual multiline engine import', async () => {
    const directory = await Deno.makeTempDir({ prefix: 'distribution-graph-control-' })
    try {
      const entry = `${directory}/entry.ts`
      await Deno.writeTextFile(
        entry,
        `
        // import { Store } from 'npm:oxigraph@0.5.9'
        const text = "oxigraph jsonld import('testcontainers')";
        export { text };
      `,
      )
      expect(bundleGraph(await inspect(entry), [toFileUrl(entry).href]).packages).toEqual([])
      await Deno.writeTextFile(
        entry,
        `import type { Store } from 'npm:oxigraph@0.5.9'; export type { Store };`,
      )
      expect(bundleGraph(await inspect(entry), [toFileUrl(entry).href]).packages).toEqual([])
      await Deno.writeTextFile(
        entry,
        `import /* actual edge */ {\n Store\n} from 'npm:oxigraph@0.5.9'; export { Store };`,
      )
      const graph = await inspect(entry)
      expect(() => bundleGraph(graph, [toFileUrl(entry).href])).toThrow(Error)
    } finally {
      await Deno.remove(directory, { recursive: true })
    }
  })
  it('permits an explicit Turtle subpath while rejecting the same parser edge in a light root', async () => {
    const directory = await Deno.makeTempDir({ prefix: 'distribution-native-control-' })
    try {
      const entry = `${directory}/entry.ts`
      const syntax = new URL('../packages/rdf/turtle/mod.ts', import.meta.url).href
      await Deno.writeTextFile(entry, `export { parse } from ${JSON.stringify(syntax)};\n`)
      const graph = await inspect(entry)
      const approved = [...coreRoots, toFileUrl(entry).href]
      expect(bundleGraph(graph, approved).modules).toContain(syntax)
      expect(() => bundleGraph(graph, approved, processorRoots)).toThrow(Error)
    } finally {
      await Deno.remove(directory, { recursive: true })
    }
  })
})
