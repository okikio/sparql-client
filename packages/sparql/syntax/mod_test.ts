import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { events, inspect, tokens } from './mod.ts'

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) values.push(value)
  return values
}

describe('@okikio/sparql/syntax', () => {
  it('emits source-ranged version and SPARQL 1.2 feature events without building an AST', async () => {
    const document = await inspect(
      'VERSION "1.2"\nSELECT ?s WHERE { BIND( <<( ?s :p :o )>> AS ?t ) }',
    )
    expect(document.version).toBe('1.2')
    expect(document.features.some((value) => value.feature === 'triple-term')).toBe(true)
    expect(document.tokens.find((value) => value.kind === 'variable')?.range.line).toBe(2)
  })

  it('reports triple terms against the 1.2-basic compatibility profile', async () => {
    const document = await inspect(
      'VERSION "1.2-basic" SELECT * WHERE { BIND( <<( :s :p :o )>> AS ?t ) }',
    )
    expect(document.diagnostics.some((value) => value.code === 'sparql-version-feature')).toBe(true)
  })

  it('distinguishes relational less-than from an IRI reference without whitespace', async () => {
    const values = await collect(
      tokens('SELECT * WHERE { FILTER(?x<5) BIND(<https://example/> AS ?iri) }'),
    )
    expect(values.some((value) => value.kind === 'operator' && value.raw === '<')).toBe(true)
    expect(values.some((value) => value.kind === 'iri' && value.value === 'https://example/')).toBe(
      true,
    )
  })

  it('keeps long literals across hostile chunk splits', async () => {
    const source = (async function* () {
      yield 'SELECT * WHERE { BIND(""'
      yield '"hello\\nworld"'
      yield '"" AS ?value) }'
    })()
    const values = await collect(tokens(source))
    expect(values.find((value) => value.kind === 'string')?.value).toBe('hello\nworld')
  })

  it('emits directional language tags and 1.2-only diagnostics under 1.1', async () => {
    const document = await inspect('VERSION "1.1" SELECT * WHERE { ?s :p "hello"@en--ltr }')
    expect(document.features.some((value) => value.feature === 'directional-literal')).toBe(true)
    expect(document.diagnostics.some((value) => value.code === 'sparql-version-feature')).toBe(true)
  })

  it('can retain comments and whitespace without changing semantic token limits', async () => {
    const values = await collect(tokens('# comment\nSELECT\t?s {}', { trivia: true, maxTokens: 4 }))
    expect(values.some((value) => value.kind === 'comment')).toBe(true)
    expect(values.some((value) => value.kind === 'whitespace')).toBe(true)
  })

  it('cancels a pending Web Stream read when the consumer returns early', async () => {
    let cancelled = false
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('SELECT ?s '))
        return new Promise(() => undefined)
      },
      cancel() {
        cancelled = true
      },
    })

    for await (const _token of tokens(source)) break
    await Promise.resolve()
    expect(cancelled).toBe(true)
  })

  it('keeps malformed tokens observable in tolerant mode', async () => {
    const values = await collect(events('SELECT * WHERE { ?s :p @-- }', { tolerant: true }))
    expect(values.some((value) => value.kind === 'diagnostic')).toBe(true)
  })
})
