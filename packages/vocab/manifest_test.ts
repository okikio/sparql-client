import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { toFileUrl } from '@std/path'
import metadata from './deno.json' with { type: 'json' }
import bootstrap from './schema/manifest.json' with { type: 'json' }
import { compile } from './compile.ts'
import { createManifest } from './manifest.ts'
import type { VocabularyModelType } from './model.ts'
import { plan } from './name.ts'

describe('@okikio/vocab generator provenance', () => {
  it('identifies the declared package version in newly compiled output', async () => {
    const result = await compile([], {
      vocabulary: 'Example',
      namespace: 'urn:example:',
      prefix: 'example',
    })
    expect(result.manifest.generator).toBe(`${metadata.name}/${metadata.version}`)

    // Exercise the real producer module with JSR's transformed npm metadata.
    // This isolated copy changes no repository file or shared JSON module state.
    const directory = await Deno.makeTempDir({ prefix: 'vocab-transport-' })
    try {
      await Deno.writeTextFile(
        `${directory}/package.json`,
        JSON.stringify({ name: '@jsr/okikio__vocab', version: metadata.version, type: 'module' }),
      )
      await Deno.copyFile(new URL('./manifest.ts', import.meta.url), `${directory}/manifest.ts`)
      const compatible: { createManifest: typeof createManifest } = await import(
        toFileUrl(`${directory}/manifest.ts`).href
      )
      const model: VocabularyModelType = {
        sources: [],
        classes: [],
        properties: [],
        datatypes: [],
        assertions: [],
        diagnostics: [],
      }
      expect(
        compatible.createManifest('Example', model, plan(model, { prefix: 'example' })).generator,
      )
        .toBe(`${metadata.name}/${metadata.version}`)
    } finally {
      await Deno.remove(directory, { recursive: true })
    }
  })

  it('preserves explicit provenance and saved historical manifests', () => {
    const model: VocabularyModelType = {
      sources: [],
      classes: [],
      properties: [],
      datatypes: [],
      assertions: [],
      diagnostics: [],
    }
    const names = plan(model, { prefix: 'example' })
    expect(createManifest('Example', model, names, 'custom-compiler/7').generator)
      .toBe('custom-compiler/7')
    expect(createManifest('Example', model, names, '').generator).toBe('')
    expect(bootstrap.generator).toBe('@okikio/vocab/0.1.0')
  })
})
