import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { literal, namedNode, quad, type Quad } from '../mod.ts'
import { parse, type ParserType } from './mod.ts'

const fixture = quad(namedNode('https://example.test/s'), namedNode('https://example.test/p'), literal('value'))
type EventType = 'drain' | 'close' | 'error'
type ListenerType = (...args: unknown[]) => void

class TestParser implements ParserType {
  static options: Readonly<Record<string, unknown>> | undefined
  private readonly listeners = new Map<EventType, Set<ListenerType>>()
  private ended = false
  private resolveEnd: (() => void) | undefined
  constructor(options: Readonly<Record<string, unknown>>) { TestParser.options = options }
  write(_value: string | Uint8Array): boolean { return true }
  end(): void { this.ended = true; this.resolveEnd?.() }
  destroy(error?: Error): void { if (error) this.emit('error', error); this.ended = true; this.resolveEnd?.(); this.emit('close') }
  once(event: EventType, listener: ListenerType): this { const values = this.listeners.get(event) ?? new Set(); values.add(listener); this.listeners.set(event, values); return this }
  off(event: EventType, listener: ListenerType): this { this.listeners.get(event)?.delete(listener); return this }
  private emit(event: EventType, ...args: unknown[]): void { for (const listener of this.listeners.get(event) ?? []) listener(...args) }
  async *[Symbol.asyncIterator](): AsyncIterator<Quad> { if (!this.ended) await new Promise<void>((resolve) => { this.resolveEnd = resolve }); yield fixture }
}

describe('@okikio/rdf/rdfa', () => {
  it('adapts RDFa parser output back to native RDF terms', async () => {
    const values: Quad[] = []
    for await (const value of parse('<div></div>', { parser: TestParser, contentType: 'text/html' })) values.push(value)
    expect(values).toHaveLength(1)
    expect(values[0]?.equals(fixture)).toBe(true)
  })

  it('forwards RDFa host-language options and the native RDF factory', async () => {
    for await (const _value of parse('<div></div>', {
      parser: TestParser,
      base: 'https://example.test/base/',
      contentType: 'text/html',
      language: 'en',
      vocab: 'https://schema.org/',
    })) { /* drain */ }

    expect(TestParser.options?.baseIRI).toBe('https://example.test/base/')
    expect(TestParser.options?.contentType).toBe('text/html')
    expect(TestParser.options?.language).toBe('en')
    expect(TestParser.options?.vocab).toBe('https://schema.org/')
    const factory = TestParser.options?.dataFactory as { namedNode(value: string): { value: string } }
    expect(factory.namedNode('urn:test').value).toBe('urn:test')
  })

})
