import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { select, triple, update } from '@okikio/sparql'
import { create } from './mod.ts'
import { literal, namedNode, quad, RDF, XSD } from '@okikio/rdf'
import type { Term } from '@okikio/rdf'

describe('@okikio/oxigraph', () => {
  it('does not dispatch a deferred update after caller cancellation', async () => {
    let submitted = 0
    const client = create({
      query: () => true,
      update: () => {
        submitted++
      },
    })
    const controller = new AbortController()
    const pending = client.update('INSERT DATA { <urn:s> <urn:p> <urn:o> }', {
      signal: controller.signal,
    })
    const reason = new Error('stop before engine dispatch')
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
    expect(submitted).toBe(0)
  })
  it('does not pretend a synchronous Store supports timeout cancellation', async () => {
    const client = create({ query: () => true, update: () => undefined })
    let kind = ''
    try {
      await client.queryBoolean('ASK {}', { timeoutMs: 1 })
    } catch (error) {
      kind = error instanceof Error ? error.name : ''
    }
    expect(kind).toBe('TypeError')
    for (const timeoutMs of [NaN, Infinity, -1]) {
      expect(() => client.queryBoolean('ASK {}', { timeoutMs })).toThrow(RangeError)
    }
    expect(await client.queryBoolean('ASK {}', { timeoutMs: 0 })).toBe(true)
    expect(await client.queryBoolean('ASK {}', { timeoutMs: null })).toBe(true)
  })

  it('accepts structured query and update documents without taking store ownership', async () => {
    let queryText = ''
    let updateText = ''
    const client = create({
      query(query: string) {
        queryText = query
        return true
      },
      update(value: string) {
        updateText = value
      },
    })
    const query = select('*').where(triple('?s', '?p', '?o'))
    expect(await client.queryBoolean(query)).toBe(true)
    const change = update().deleteWhere(triple('?s', '?p', '?o'))
    await client.update(change)
    expect(queryText).toBe(query.build().value)
    expect(updateText).toBe(change.build().value)
  })
})

/** An authored native-resource double: semantic values outlive only its explicit free call. */
function resource(
  label: string,
  released: string[],
  termType: Term['termType'] = 'NamedNode',
  failure?: unknown,
): Term & { free(): void } {
  let alive = true
  return {
    termType,
    get value() {
      if (!alive) throw new Error(`Read after free: ${label}`)
      return termType === 'DefaultGraph' || termType === 'Quad' ? '' : label
    },
    equals: () => false,
    free() {
      if (!alive) throw new Error(`Double free: ${label}`)
      alive = false
      released.push(label)
      if (failure !== undefined) throw failure
    },
  }
}

/** Consumers wait for actual operation cleanup, not an arbitrary delay or a garbage collector. */
async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) values.push(value)
  return values
}

describe('explicit Oxigraph materialized result ownership', () => {
  it('preserves structural borrowed values and never disposes the injected Store', async () => {
    const released: string[] = []
    const term = resource('urn:borrowed', released)
    const store = {
      query: () => [new Map([['s', term]])],
      update: () => undefined,
      free: () => released.push('store'),
    }
    const result = await create(store).queryBindings('SELECT ?s WHERE {}')
    const [row] = await collect(result)
    await result.cleanup
    expect(row?.get('s')?.equals(namedNode('urn:borrowed'))).toBe(true)
    expect(term.value).toBe('urn:borrowed')
    expect(released).toEqual([])
  })

  for (
    const terminal of ['complete', 'close-before-pull', 'abort-before-pull', 'early-break'] as const
  ) {
    it(`retires every acquired materialized parent on ${terminal}`, async () => {
      const released: string[] = []
      const first = resource('urn:first', released)
      const last = resource('urn:last', released)
      const controller = new AbortController()
      const store = {
        query: () => [new Map([['s', first], ['alias', first]]), new Map([['s', last]])],
        update: () => undefined,
        free: () => released.push('store'),
      }
      const result = await create(store, { results: 'owned' }).queryBindings('SELECT * WHERE {}', {
        signal: controller.signal,
      })
      if (terminal === 'complete') {
        const rows = await collect(result)
        expect(rows.map((row) => row.get('s')?.value)).toEqual(['urn:first', 'urn:last'])
      } else if (terminal === 'close-before-pull') await result.close()
      else if (terminal === 'abort-before-pull') controller.abort(new Error('stop conversion'))
      else {for await (const row of result) {
          expect(row.get('s')?.value).toBe('urn:first')
          break
        }}
      await result.cleanup
      expect(released.toSorted()).toEqual(['urn:first', 'urn:last'])
      expect(() => first.value).toThrow('Read after free')
      expect(() => last.value).toThrow('Read after free')
      expect(released).not.toContain('store')
    })
  }

  it('captures getter-created literal children once and keeps detached values usable', async () => {
    const released: string[] = []
    const children: Term[] = []
    const parent = resource('42', released, 'Literal')
    const native = Object.assign(parent, { language: '', direction: '' })
    Object.defineProperty(native, 'datatype', {
      get() {
        const child = resource(XSD.integer, released)
        children.push(child)
        return child
      },
    })
    const result = await create({
      query: () => [new Map([['value', native]])],
      update: () => undefined,
    }, {
      results: 'owned',
    }).queryBindings('SELECT ?value WHERE {}')
    const [row] = await collect(result)
    await result.cleanup
    expect(children).toHaveLength(1)
    expect(released).toEqual([XSD.integer, '42'])
    expect(row?.get('value')?.equals(literal('42', namedNode(XSD.integer)))).toBe(true)
  })

  it('retires nested quad children before parents and handles shared child identities once', async () => {
    const released: string[] = []
    const subject = resource('urn:s', released)
    const predicate = resource('urn:p', released)
    const object = resource('urn:o', released)
    const graph = resource('graph', released, 'DefaultGraph')
    const nested = resource('nested', released, 'Quad')
    const outer = resource('outer', released, 'Quad')
    const reads = new Map<string, number>()
    const fields = (target: object, values: Record<string, Term>): void => {
      for (const [name, value] of Object.entries(values)) {
        Object.defineProperty(target, name, {
          get() {
            const key = `${target === outer ? 'outer' : 'nested'}.${name}`
            reads.set(key, (reads.get(key) ?? 0) + 1)
            return value
          },
        })
      }
    }
    fields(nested, { subject, predicate, object, graph })
    fields(outer, { subject, predicate, object: nested, graph })
    const result = await create({ query: () => [outer], update: () => undefined }, {
      results: 'owned',
    })
      .queryQuads('CONSTRUCT {} WHERE {}')
    const [value] = await collect(result)
    await result.cleanup
    expect([...reads.values()]).toEqual(Array(8).fill(1))
    expect(released).toHaveLength(6)
    expect(new Set(released).size).toBe(6)
    expect(released.indexOf('urn:o')).toBeLessThan(released.indexOf('nested'))
    expect(released.indexOf('nested')).toBeLessThan(released.indexOf('outer'))
    expect(
      value?.equals(
        quad(
          namedNode('urn:s'),
          namedNode('urn:p'),
          quad(namedNode('urn:s'), namedNode('urn:p'), namedNode('urn:o')),
        ),
      ),
    ).toBe(true)
  })

  it('rejects owned lazy sources without draining or disposing borrowed iterator values', () => {
    let pulled = 0
    const released: string[] = []
    const source = {
      *[Symbol.iterator]() {
        pulled++
        yield new Map([['s', resource('urn:lazy', released)]])
      },
    }
    const client = create({ query: () => source, update: () => undefined }, { results: 'owned' })
    expect(() => client.queryBindings('SELECT * WHERE {}')).toThrow('materialized array')
    expect(pulled).toBe(0)
    expect(released).toEqual([])
  })

  it('retires all acquired rows when acquisition rejects a wrong query mode', () => {
    const released: string[] = []
    const store = {
      query: () => [
        new Map([['s', resource('urn:first', released)]]),
        resource('urn:invalid-row', released),
        new Map([['s', resource('urn:last', released)]]),
      ],
      update: () => undefined,
    }
    expect(() => create(store, { results: 'owned' }).queryBindings('SELECT * WHERE {}')).toThrow(
      'invalid row',
    )
    expect(released.toSorted()).toEqual(['urn:first', 'urn:invalid-row', 'urn:last'])
    released.length = 0
    const ask = create({ query: () => [resource('urn:ask', released)], update: () => undefined }, {
      results: 'owned',
    })
    expect(() => ask.queryBoolean('ASK {}')).toThrow('boolean')
    expect(released).toEqual(['urn:ask'])
  })

  it('retains getter failure and every cleanup failure while attempting remaining parents', async () => {
    const released: string[] = []
    const primary = new Error('datatype acquisition failed')
    const secondary = new Error('first wrapper cleanup failed')
    const first = Object.assign(resource('bad literal', released, 'Literal', secondary), {
      language: '',
      direction: '',
    })
    Object.defineProperty(first, 'datatype', {
      get() {
        throw primary
      },
    })
    const last = resource('urn:last', released)
    const result = await create({
      query: () => [new Map([['bad', first]]), new Map([['s', last]])],
      update: () => undefined,
    }, {
      results: 'owned',
    }).queryBindings('SELECT * WHERE {}')
    await expect(collect(result)).rejects.toBe(primary)
    let cleanup: unknown
    try {
      await result.cleanup
    } catch (reason) {
      cleanup = reason
    }
    expect(cleanup).toBeInstanceOf(AggregateError)
    expect((cleanup as AggregateError).errors).toEqual([primary, secondary])
    expect(released).toEqual(['bad literal', 'urn:last'])
  })

  it('releases earlier and unconsumed parents after a malformed later binding', async () => {
    const released: string[] = []
    const first = resource('urn:first', released)
    const invalid = resource('urn:invalid', released)
    const last = resource('urn:last', released)
    const rows = [
      new Map<unknown, unknown>([['s', first]]),
      new Map<unknown, unknown>([[42, invalid]]),
      new Map<unknown, unknown>([['s', last]]),
    ]
    const result = await create({ query: () => rows, update: () => undefined }, {
      results: 'owned',
    })
      .queryBindings('SELECT * WHERE {}')
    const iterator = result[Symbol.asyncIterator]()
    expect((await iterator.next()).value?.get('s')?.value).toBe('urn:first')
    await expect(iterator.next()).rejects.toThrow('variable name')
    await result.cleanup
    expect(released.toSorted()).toEqual(['urn:first', 'urn:invalid', 'urn:last'])
    expect(rows).toHaveLength(3)
  })

  it('never disposes the injected Store when a malformed owned result returns it', () => {
    const released: string[] = []
    const store = {
      query(): unknown {
        return [store, new Map([['s', resource('urn:term', released)]])]
      },
      update: () => undefined,
      free: () => released.push('store'),
    }
    expect(() => create(store, { results: 'owned' }).queryBindings('SELECT * WHERE {}')).toThrow(
      'invalid row',
    )
    expect(released).toEqual(['urn:term'])
    expect(() => create(store, { results: 'owned' }).queryBoolean('ASK {}')).toThrow('boolean')
    expect(released).toEqual(['urn:term', 'urn:term'])
  })

  it('releases all other parents when one acquired disposal protocol is malformed', () => {
    const released: string[] = []
    const invalid = { free: 1 }
    const client = create({
      query: () => [new Map([['bad', invalid]]), new Map([['s', resource('urn:valid', released)]])],
      update: () => undefined,
    }, { results: 'owned' })
    expect(() => client.queryBindings('SELECT * WHERE {}')).toThrow('not callable')
    expect(released).toEqual(['urn:valid'])
  })

  it('keeps language and direction literal semantics when disposing native metadata', async () => {
    for (const direction of ['', 'rtl'] as const) {
      const released: string[] = []
      const parent = Object.assign(resource('مرحبا', released, 'Literal'), {
        language: 'ar',
        direction,
      })
      Object.defineProperty(parent, 'datatype', {
        get: () => resource(direction ? RDF.dirLangString : RDF.langString, released),
      })
      const result = await create({
        query: () => [new Map([['value', parent]])],
        update: () => undefined,
      }, { results: 'owned' })
        .queryBindings('SELECT ?value WHERE {}')
      const [row] = await collect(result)
      await result.cleanup
      expect(
        row?.get('value')?.equals(
          literal('مرحبا', direction ? { language: 'ar', direction } : { language: 'ar' }),
        ),
      ).toBe(true)
      expect(released).toHaveLength(2)
    }
  })
})
