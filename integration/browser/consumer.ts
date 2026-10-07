import * as rdf from '@okikio/rdf'
import * as nquads from '@okikio/rdf/nquads'
import * as canon from '@okikio/rdf/canon'
import * as sparql from '@okikio/sparql'
import * as http from '@okikio/sparql/http'

/** Cases execute the same public entrypoints in Window and DedicatedWorker. */
export type ScenarioType = 'semantics' | 'cancel' | 'early' | 'limits' | 'canon' | 'http'

/** Collects a finite semantic stream; this is an explicit test materialization boundary. */
async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of source) values.push(value)
  return values
}

/** Encodes one RDF fixture as single-byte chunks, including split multibyte Unicode. */
function split(source: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(source)
  let index = 0
  return new ReadableStream({
    pull(controller) {
      if (index === bytes.byteLength) controller.close()
      else controller.enqueue(bytes.slice(index, ++index))
    },
  })
}

/** Verifies RDF identity, indexed matching, chunk invariance and immutable query construction. */
async function semantics() {
  const source =
    '<urn:s> <urn:p> "零 café 😀"@fr <urn:g> .\n<urn:s> <urn:n> "7"^^<http://www.w3.org/2001/XMLSchema#integer> .\n'
  const values = await collect(nquads.parse(split(source)))
  const whole = await collect(nquads.parse(source))
  const dataset = rdf.dataset(values)
  const subject = rdf.namedNode('urn:s')
  const match = Array.from(dataset.match(subject, rdf.namedNode('urn:p')))
  const base = sparql.select(['o'])
  const built = base.where(sparql.triple(subject, rdf.namedNode('urn:p'), '?o'))
  return {
    size: dataset.size,
    invariant: values.every((value, index) => value.equals(whole[index]!)),
    roundTrip: rdf.datasetEquals(values, await collect(nquads.parse(nquads.write(values)))),
    object: match[0]?.object.value,
    language: match[0]?.object.termType === 'Literal' ? match[0].object.language : null,
    datatype: values[1]?.object.termType === 'Literal' ? values[1].object.datatype.value : null,
    graph: match[0]?.graph.value,
    base: base.build().value,
    query: built.build().value.replace(/\s+/gu, ' ').trim(),
  }
}

/** Cancels a parser while its actual Web Stream source has a pending read. */
async function cancel() {
  let cancelled = 0
  let entered!: () => void
  const ready = new Promise<void>((resolve) => entered = resolve)
  const source = new ReadableStream<Uint8Array>({
    pull() {
      entered()
      return new Promise<void>(() => {})
    },
    cancel() {
      cancelled += 1
    },
  }, { highWaterMark: 0 })
  const controller = new AbortController()
  const iterator = nquads.parse(source, { signal: controller.signal })
  const pending = iterator.next()
  await ready
  controller.abort(new DOMException('browser parser cancelled', 'AbortError'))
  let name = ''
  try {
    await pending
  } catch (error) {
    name = error instanceof Error ? error.name : String(error)
  }
  await iterator.return(undefined)
  return { name, cancelled, locked: source.locked }
}

/** Early return releases upstream even when a second statement has not arrived. */
async function early() {
  let cancelled = 0
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('<urn:s> <urn:p> "first" .\n'))
    },
    cancel() {
      cancelled += 1
    },
  })
  const values: string[] = []
  for await (const value of nquads.parse(source)) {
    values.push(value.object.value)
    break
  }
  return { values, cancelled, locked: source.locked }
}

/** Limits and tolerant recovery reject malformed records without leaking partial quads. */
async function limits() {
  const line = '<urn:s> <urn:p> "value" .'
  const at = await collect(nquads.parse(`${line}\n`, { maxLineLength: line.length }))
  let failure = ''
  try {
    await collect(nquads.parse(`${line}\n`, { maxLineLength: line.length - 1 }))
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }
  const events = await collect(nquads.analyze(`${line}\nnot rdf\n${line}\n`, { tolerant: true }))
  return { at: at.length, failure, events: events.map((event) => event.kind) }
}

/** Native browser Web Crypto participates in canonical bytes and digest identity. */
async function canonical() {
  const a = [rdf.quad(rdf.blankNode('a'), rdf.namedNode('urn:p'), rdf.literal('value'))]
  const b = [rdf.quad(rdf.blankNode('b'), rdf.namedNode('urn:p'), rdf.literal('value'))]
  return {
    text: await canon.canonicalize(a),
    hash: await canon.hash(a),
    invariant: await canon.isomorphic(a, b),
  }
}

/** Sends native browser fetch requests, decodes RDF terms, and aborts a real stalled body. */
async function protocol() {
  const query = sparql.select(['o']).where(
    sparql.triple(rdf.namedNode('urn:s'), rdf.namedNode('urn:p'), '?o'),
  )
  const wire = []
  const headers = new Headers({ authorization: 'Bearer browser-fixture' })
  for (const method of ['get', 'post-form', 'post-direct'] as const) {
    const client = http.create({
      endpoint: new URL('/__sparql/wire', location.href),
      queryMethod: method,
      headers,
    })
    const rows = await collect(await client.queryBindings(query))
    wire.push(JSON.parse(rows[0]!.get('wire')!.value))
  }
  const client = http.create({ endpoint: new URL('/__sparql/query', location.href) })
  const rows = await collect(await client.queryBindings(query))
  const literal = rows[0]!.get('o')!
  const quads = await collect(await client.queryQuads('CONSTRUCT WHERE { ?s ?p ?o }'))
  const aborter = new AbortController()
  const stalled = http.create({ endpoint: new URL('/__sparql/stall', location.href) })
  let fetched!: () => void
  const received = new Promise<void>((resolve) => fetched = resolve)
  const nativeFetch = fetch
  const observed = http.create({
    endpoint: stalled.endpoint,
    fetch: async (...args: Parameters<typeof fetch>) => {
      const response = await nativeFetch(...args)
      fetched()
      return response
    },
  })
  const pending = observed.queryBoolean('ASK {}', { signal: aborter.signal })
  await received
  aborter.abort(new DOMException('stop browser fetch', 'AbortError'))
  let abortKind = ''
  try {
    await pending
  } catch (error) {
    abortKind = error instanceof http.QueryError ? error.kind : String(error)
  }
  const recovered = await client.queryBoolean('ASK {}')
  return {
    wire,
    headers: Array.from(headers.entries()),
    literal: {
      type: literal.termType,
      value: literal.value,
      language: literal.termType === 'Literal' ? literal.language : null,
    },
    graph: quads[0]?.graph.value,
    object: quads[0]?.object.value,
    abortKind,
    recovered,
  }
}

/** Dispatch is explicit so browser and worker consumers run precisely the same contracts. */
export async function run(scenario: ScenarioType) {
  switch (scenario) {
    case 'semantics':
      return await semantics()
    case 'cancel':
      return await cancel()
    case 'early':
      return await early()
    case 'limits':
      return await limits()
    case 'canon':
      return await canonical()
    case 'http':
      return await protocol()
  }
}
