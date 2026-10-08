import { describe, it } from 'node:test'
import { expect } from '@std/expect'
import { Store as Engine } from 'oxigraph'
import type { Term as EngineTerm } from 'oxigraph'
import { blankNode, literal, namedNode, variable as rdfVariable } from '@okikio/rdf'
import { query } from '../../conformance/query.ts'
import {
  add,
  alternative,
  ask,
  bind,
  construct,
  decimal,
  describe as describeQuery,
  double,
  exprList,
  fluent,
  integer,
  inverse,
  isSparqlTerm,
  mul,
  node,
  oneOrMore,
  prefixed,
  raw,
  rawTerm,
  rdfTerm,
  rel,
  select,
  sequence,
  SPARQL_EXPR_BRAND,
  SPARQL_TERM_BRAND,
  strlit,
  toGraphRef,
  toPredicateToken,
  triple,
  undef,
  update,
  uri,
  v,
  validatePrefixedName,
  validatePrefixName,
  valuesList,
  variable,
} from './mod.ts'

/** Narrows the actual SELECT result union before accessing solution bindings. */
function solutions(value: ReturnType<Engine['query']>): Map<string, EngineTerm>[] {
  if (!Array.isArray(value) || !value.every((row) => row instanceof Map)) {
    throw new TypeError('Expected SELECT solution maps, not a boolean, serialized result or quads.')
  }
  return value
}

/** Owns the concrete Wasm store and every materialized result wrapper, preserving all failures. */
function use<Value>(body: (engine: Pick<Engine, 'query' | 'update'>) => Value): Value {
  const engine = new Engine()
  const terms = new Set<object>()
  const failures: unknown[] = []
  let output!: Value
  const view: Pick<Engine, 'query' | 'update'> = {
    query(...options) {
      const result = engine.query(...options)
      if (Array.isArray(result)) {
        for (const row of result) {
          if (row instanceof Map) {
            for (const term of row.values()) terms.add(term)
          } else terms.add(row)
        }
      }
      return result
    },
    update: (...options) => engine.update(...options),
  }
  try {
    output = body(view)
  } catch (error) {
    failures.push(error)
  } finally {
    for (const resource of [...terms].reverse().concat(engine)) {
      try {
        const free: unknown = Reflect.get(resource, 'free')
        if (typeof free !== 'function') {
          failures.push(new TypeError('Owned pinned Wasm resource has no disposal.'))
        } else Reflect.apply(free, resource, [])
      } catch (error) {
        failures.push(error)
      }
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length) {
    throw new AggregateError(failures, 'Construction scenario and cleanup failed.')
  }
  return output
}

/** One real owned engine evaluates expressions; expected results do not use our serializer. */
function scalar(expression: { readonly value: string }): string {
  return use((engine) => {
    const rows = engine.query(`SELECT (${expression.value} AS ?answer) WHERE {}`)
    if (!Array.isArray(rows) || !rows[0] || !(rows[0] instanceof Map)) {
      throw new Error('Expected one solution')
    }
    const term = rows[0].get('answer')
    if (!term) throw new Error('Expected answer term')
    return term.value
  })
}

describe('checked SPARQL construction semantics', () => {
  it('preserves arithmetic trees and datatypes through real evaluation', () => {
    expect(scalar(mul(add(1, 2), 3))).toBe('9')
    expect(scalar(mul(3, add(1, 2)))).toBe('9')
    expect(scalar(add(1, mul(2, 3)))).toBe('7')
    expect(scalar(raw(`DATATYPE(${decimal(1e21).value})`))).toBe(
      'http://www.w3.org/2001/XMLSchema#decimal',
    )
    expect(scalar(raw(`DATATYPE(${double(2).value})`))).toBe(
      'http://www.w3.org/2001/XMLSchema#double',
    )
    expect(scalar(integer(9007199254740993n))).toBe('9007199254740993')
    for (const invalid of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => integer(invalid)).toThrow()
    }
    for (const invalid of ['1e3', 'NaN', '', '1 2']) expect(() => decimal(invalid)).toThrow()
    expect('mod' in fluent(integer(2))).toBe(false)
    expect(exprList([add(1, 2), mul(3, 4)]).value).toBe('(1 + 2), (3 * 4)')
  })

  it('preserves compound path grouping and cycles through real graph traversal', () => {
    use((engine) => {
      engine.update(
        'INSERT DATA { <urn:a> <urn:p> <urn:b> . <urn:b> <urn:q> <urn:c> . <urn:c> <urn:p> <urn:d> . <urn:d> <urn:q> <urn:a> }',
      )
      const built = select(['endpoint']).where(
        triple(uri('urn:a'), oneOrMore(sequence('urn:p', 'urn:q')), '?endpoint'),
      ).build()
      const rows = solutions(engine.query(built.value))
      expect(rows.map((row) => row.get('endpoint')?.value).sort()).toEqual(['urn:a', 'urn:c'])
      expect(
        query(
          select('*').where(triple('?s', inverse(sequence('urn:p', 'urn:q')), '?o')).build().value,
        ),
      )
        .toEqual(query('SELECT * WHERE { ?s ^(<urn:p>/<urn:q>) ?o }'))
      expect(
        query(
          select('*').where(triple('?s', sequence(alternative('urn:p', 'urn:q'), 'urn:r'), '?o'))
            .build().value,
        ),
      )
        .toEqual(query('SELECT * WHERE { ?s (<urn:p>|<urn:q>)/<urn:r> ?o }'))
      engine.update(
        'INSERT DATA { <urn:s> a <urn:o> . _:edge a <http://www.w3.org/1999/02/22-rdf-syntax-ns#Statement>; <http://www.w3.org/1999/02/22-rdf-syntax-ns#subject> <urn:s>; <http://www.w3.org/1999/02/22-rdf-syntax-ns#predicate> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type>; <http://www.w3.org/1999/02/22-rdf-syntax-ns#object> <urn:o>; <urn:source> <urn:source> }',
      )
      const reified = select(['s', 'o']).where(
        rel('s', 'a', 'o').prop('urn:source', uri('urn:source')),
      ).build()
      expect(
        solutions(engine.query(reified.value)).map((
          row,
        ) => [row.get('s')?.value, row.get('o')?.value]),
      )
        .toEqual([['urn:s', 'urn:o']])
      expect(() => triple('?s', 'urn:p', oneOrMore('urn:p') as never)).toThrow()
      expect(() => add(oneOrMore('urn:p'), 1)).toThrow()
      expect(() => construct(triple('?s', oneOrMore('urn:p'), '?o')).build()).toThrow()
    })
  })

  it('retains BIND/OPTIONAL/VALUES order and checks rebinding without imposing FILTER order', () => {
    use((engine) => {
      engine.update('INSERT DATA { <urn:person> <urn:age> 20 . <urn:person> <urn:target> 21 }')
      const built = select(['newAge'])
        .where(triple('?person', 'urn:age', '?oldAge'))
        .bind(add(v('oldAge'), 1), 'newAge')
        .where(triple('?person', 'urn:target', '?newAge')).build()
      const rows = solutions(engine.query(built.value))
      expect(rows.map((row) => row.get('newAge')?.value)).toEqual(['21'])
      const repeated = select('*').values('x', [1, 2]).values('x', [2, 3]).build()
      const values = solutions(engine.query(repeated.value))
      expect(values.map((row) => row.get('x')?.value)).toEqual(['2'])
      const native = select(['x']).values('x', [
        1,
        2n,
        true,
        'text',
        namedNode('urn:item'),
        literal('rdf'),
        undef(),
      ]).build()
      expect(solutions(engine.query(native.value)).map((row) => row.get('x')?.value).sort())
        .toEqual(['1', '2', 'rdf', 'text', 'true', 'urn:item', undefined])
      for (
        const invalid of [
          variable('other'),
          rdfVariable('other'),
          blankNode('item'),
          add(1, 2),
          oneOrMore('urn:p'),
        ]
      ) {
        expect(() => select().values('x', [invalid as never])).toThrow(TypeError)
        expect(() => valuesList([invalid as never])).toThrow(TypeError)
      }
      expect(() => solutions(true)).toThrow(TypeError)
      expect(() => solutions('serialized')).toThrow(TypeError)

      expect(() => select('*').where(triple('?s', 'urn:p', '?x')).bind(add(1, 2), 'x').build())
        .toThrow(TypeError)
      const filtered = select(['oldAge']).filter(v('oldAge').eq(20)).where(
        triple('?s', 'urn:age', '?oldAge'),
      ).build()
      expect(engine.query(filtered.value)).toHaveLength(1)
      // OPTIONAL before BIND can observe different scope than OPTIONAL after BIND.
      const before = select('*').optional(bind(variable('x'), 'y')).bind(integer(1), 'x').build()
      const after = select('*').bind(integer(1), 'x').optional(bind(variable('x'), 'y')).build()
      expect(query(before.value)).not.toEqual(query(after.value))
    })
  })

  it('makes empty SELECT valid, restricts SubSelect, and hoists compatible prefixes', () => {
    expect(query(select().build().value)).toEqual(query('SELECT * WHERE {}'))
    expect(() => select([]).build()).toThrow()
    for (
      const builder of [
        ask(),
        describeQuery([uri('urn:s')]),
        construct(),
        select().from('urn:g'),
        select().fromNamed('urn:g'),
      ]
    ) {
      expect(() => builder.asSubquery()).toThrow(TypeError)
    }
    const subselect = select(['s']).prefix('ex', 'urn:').where(triple('?s', 'ex:p', '?o'))
      .asSubquery()
    const built = select(['s']).where(subselect).build()
    expect(query(built.value)).toEqual(
      query('PREFIX ex: <urn:> SELECT ?s WHERE { { SELECT ?s WHERE { ?s ex:p ?o } } }'),
    )
    expect(() => select().prefix('ex', 'urn:other:').where(subselect).build()).toThrow()
  })

  it('enforces token roles consistently and keeps fluent facades immutable', () => {
    for (const name of ['', 'é', '前', 'a.b', 'a-1']) {
      expect(() => validatePrefixName(name)).not.toThrow()
    }
    for (const name of ['_bad', 'a.', 'a b']) expect(() => validatePrefixName(name)).toThrow()
    for (const name of [':', 'é:前', 'a:part:other', 'a:x%20y', 'a:x\\~y']) {
      expect(() => validatePrefixedName(name)).not.toThrow()
    }
    for (const name of ['a:x.', 'a:x%ZZ', '_a:x', 'a:x y']) {
      expect(() => validatePrefixedName(name)).toThrow()
    }
    expect(prefixed('é', '前').value).toBe('é:前')
    expect(toGraphRef(prefixed('ex', 'graph'))).toBe('ex:graph')
    for (const term of [literal('bad'), variable('g'), oneOrMore('urn:p')]) {
      expect(() => toGraphRef(term as never)).toThrow()
    }
    expect(() => toPredicateToken(literal('bad') as never)).toThrow()
    expect(isSparqlTerm(null)).toBe(false)
    expect(isSparqlTerm(namedNode('urn:item'))).toBe(false)
    expect(isSparqlTerm(rawTerm('<urn:item>'))).toBe(true)
    expect(() => variable(uri('urn:item'))).toThrow(TypeError)
    expect(() => variable(raw('?other') as never)).toThrow(TypeError)
    const path = oneOrMore('urn:p')
    expect(() => node('s', path as never)).toThrow(TypeError)
    expect(() => node('s').a(path as never)).toThrow(TypeError)
    expect(() => node('s').types([path as never])).toThrow(TypeError)
    expect(query(select().where(rel('s', path, 'o')).build().value))
      .toEqual(query('SELECT * WHERE { ?s <urn:p>+ ?o }'))
    expect(() => rel('s', path, 'o').prop('urn:source', uri('urn:source')).value)
      .toThrow(TypeError)
    expect(() => rdfTerm({ ...namedNode('urn:a'), value: 'urn:a> } UNION {' } as never)).toThrow()
    const term = uri('urn:resource')
    const expression = fluent(term)
    expect(term[SPARQL_TERM_BRAND]).toBe(true)
    expect(SPARQL_EXPR_BRAND in term).toBe(false)
    expect(expression[SPARQL_EXPR_BRAND]).toBe(true)
    expect(triple(term, 'urn:p', strlit('x')).value).toContain('<urn:resource>')
    const mutable = node('s').prop('urn:p', variable('x'))
    const frozen = select(['x']).where(mutable)
    mutable.prop('urn:q', variable('y'))
    expect(query(frozen.build().value)).toEqual(query('SELECT ?x WHERE { ?s <urn:p> ?x }'))
    expect(() => update().insertData(mutable).build()).toThrow()
  })

  it('builds graph DATA and MODIFY tutorial stories with independent semantic outcomes', () => {
    use((engine) => {
      engine.update(
        update().insertData(
          triple(uri('urn:person'), 'urn:type', uri('https://schema.org/Person')),
          'urn:g',
        ).build().value,
      )
      expect(
        engine.query(
          'ASK { GRAPH <urn:g> { <urn:person> <urn:type> <https://schema.org/Person> } }',
        ),
      ).toBe(true)
      expect(engine.query('ASK { GRAPH <urn:g> { <urn:person> <urn:type> "schema:Person" } }'))
        .toBe(false)
      engine.update('INSERT DATA { <urn:person> <urn:age> 20 }')
      const modified = update().modify()
        .delete(triple('?person', 'urn:age', '?oldAge'))
        .insert(triple('?person', 'urn:age', '?newAge'))
        .where(triple('?person', 'urn:age', '?oldAge'))
        .where(bind(add(v('oldAge'), 1), 'newAge')).done().build()
      engine.update(modified.value)
      expect(engine.query('ASK { <urn:person> <urn:age> 21 }')).toBe(true)
      expect(engine.query('ASK { <urn:person> <urn:age> 20 }')).toBe(false)
      expect(() => update().deleteData(triple('?s', 'urn:p', '?o')).build()).toThrow()
      expect(() => update().insertData(bind(integer(1), 'x')).build()).toThrow()
    })
  })
})
