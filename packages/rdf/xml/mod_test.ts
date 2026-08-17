import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { literal, namedNode, quad, type Quad } from '../mod.ts'
import { parse, type ParserType } from './mod.ts'

const fixture = quad(namedNode('https://example.test/s'), namedNode('https://example.test/p'), literal('value'))
type EventType = 'drain' | 'close' | 'error'
type ListenerType = (...args: unknown[]) => void

/** Minimal event surface for testing the Node Transform bridge without owning a host emitter dependency. */
class Emitter {
  private readonly listeners = new Map<EventType, Set<ListenerType>>()

  once(event: EventType, listener: ListenerType): this {
    const wrapper: ListenerType = (...args) => { this.off(event, wrapper); listener(...args) }
    const values = this.listeners.get(event) ?? new Set<ListenerType>()
    values.add(wrapper)
    this.listeners.set(event, values)
    return this
  }

  off(event: EventType, listener: ListenerType): this {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  protected emit(event: EventType, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args)
  }
}

/** Parser fixture that records constructor options and exercises writable backpressure. */
class TestParser extends Emitter implements ParserType {
  static options: Readonly<Record<string, unknown>> | undefined
  private ended = false
  private resolveEnd: (() => void) | undefined
  private first = true

  constructor(options: Readonly<Record<string, unknown>>) {
    super()
    TestParser.options = options
  }

  write(_value: string | Uint8Array): boolean {
    if (this.first) {
      this.first = false
      queueMicrotask(() => this.emit('drain'))
      return false
    }
    return true
  }

  end(): void { this.ended = true; this.resolveEnd?.() }
  destroy(error?: Error): void {
    if (error) this.emit('error', error)
    this.ended = true
    this.resolveEnd?.()
    this.emit('close')
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Quad> {
    if (!this.ended) await new Promise<void>((resolve) => { this.resolveEnd = resolve })
    yield fixture
  }
}

/** Parser fixture that leaves output open so early iterator return must destroy it. */
class EarlyParser extends Emitter implements ParserType {
  static destroyed = false
  private available = false
  private resolveValue: (() => void) | undefined

  constructor(_options: Readonly<Record<string, unknown>>) {
    super()
    EarlyParser.destroyed = false
  }

  write(_value: string | Uint8Array): boolean {
    this.available = true
    this.resolveValue?.()
    return true
  }

  end(): void {}
  destroy(error?: Error): void {
    EarlyParser.destroyed = true
    if (error) this.emit('error', error)
    this.emit('close')
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Quad> {
    if (!this.available) await new Promise<void>((resolve) => { this.resolveValue = resolve })
    yield fixture
    await new Promise<void>(() => {})
  }
}

describe('@okikio/rdf/xml', () => {
  it('forwards RDF/XML options and supplies the native RDF 1.2 factory', async () => {
    const values: Quad[] = []
    for await (const value of parse('<rdf:RDF/>', {
      parser: TestParser,
      base: 'https://example.test/base/',
      version: '1.2',
    })) values.push(value)

    expect(values).toHaveLength(1)
    expect(values[0]?.equals(fixture)).toBe(true)
    expect(TestParser.options?.strict).toBe(true)
    expect(TestParser.options?.trackPosition).toBe(true)
    expect(TestParser.options?.baseIRI).toBe('https://example.test/base/')
    expect(TestParser.options?.version).toBe('1.2')
    const factory = TestParser.options?.dataFactory as {
      literal(value: string, language?: string, direction?: 'ltr' | 'rtl'): ReturnType<typeof literal>
    }
    const directional = factory.literal('مرحبا', 'ar', 'rtl')
    expect(directional.language).toBe('ar')
    expect(directional.direction).toBe('rtl')
  })

  it('honors writable backpressure before ending the external parser', async () => {
    const values: Quad[] = []
    for await (const value of parse(['<rdf:', 'RDF/>'], { parser: TestParser })) values.push(value)
    expect(values).toHaveLength(1)
  })

  it('cancels a pending Web Stream read and destroys the parser on early return', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('<rdf:RDF>')) },
      cancel() { cancelled = true },
    })

    for await (const _value of parse(stream, { parser: EarlyParser })) break
    expect(EarlyParser.destroyed).toBe(true)
    expect(cancelled).toBe(true)
  })
})
