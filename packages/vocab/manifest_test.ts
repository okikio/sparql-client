import { describe, it } from 'node:test'
import { expect } from '@std/expect'
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
