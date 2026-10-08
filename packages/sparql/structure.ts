/** Compact construction records. No source parser or engine is imported here. @module */

/** One expression/path record; child references preserve grouping without repeated string copies. */
export type NodeType =
  | { readonly kind: 'atom'; readonly text: string }
  | { readonly kind: 'binary'; readonly operator: string; readonly children: readonly NodeType[] }
  | { readonly kind: 'fragment'; readonly parts: readonly (NodeType | string)[] }
  | { readonly kind: 'path'; readonly operator: string; readonly children: readonly NodeType[] }

/** Graph roles carry actual constructor metadata, never variables guessed from arbitrary source. */
export interface PatternType {
  /** Grammar category determines scope and template admission. */
  readonly kind:
    | 'triples'
    | 'group'
    | 'bind'
    | 'filter'
    | 'optional'
    | 'union'
    | 'graph'
    | 'service'
    | 'minus'
    | 'subselect'
    | 'values'
  /** Variables introduced into the surrounding group. */
  readonly bindings: readonly string[]
  /** Nested checked clauses; raw fragments have no inspectable record. */
  readonly children?: readonly object[]
  /** Explicit BIND output variable used for rebinding validation. */
  readonly target?: string
  /** Whether data contains variables, including embedded list/triple terms. */
  readonly variables?: boolean
  /** Whether the template allocates or references blank nodes. */
  readonly blanks?: boolean
  /** Predicate paths belong to query patterns, never data templates. */
  readonly paths?: boolean
  /** Prefixes that an enclosing query must hoist from a checked SubSelect. */
  readonly prefixes?: ReadonlyMap<string, string>
}

/** Expression ownership is private and does not retain disposed consumer facades. */
const nodes = new WeakMap<object, NodeType>()
/** Checked graph-pattern facts are distinct from explicitly raw syntax. */
const patterns = new WeakMap<object, PatternType>()
/** Mutable convenience builders expose live metadata until admission is snapshotted. */
const sources = new WeakMap<object, () => PatternType | undefined>()
/** Projection targets are recorded instead of inferred from text. */
const aliases = new WeakMap<object, string>()

/** Returns an owned record, or an explicitly opaque text atom for a foreign/raw facade. */
export function node(value: { readonly value: string }): NodeType {
  return nodes.get(value) ?? { kind: 'atom', text: value.value }
}

/** Attaches a lazy serialization view to a newly owned facade. Never mutates an operand. */
export function view<Value extends { readonly value: string }>(
  value: Value,
  record: NodeType,
): Value {
  nodes.set(value, record)
  Object.defineProperty(value, 'value', { enumerable: true, get: () => write(record) })
  return value
}

/** Serializes without recursive stack growth. Emitted text is bounded independently of shared nodes. */
export function write(record: NodeType): string {
  const stack: (NodeType | string)[] = [record]
  const output: string[] = []
  let units = 0
  while (stack.length) {
    const item = stack.pop()!
    if (typeof item === 'string') {
      units += item.length
      if (units > 16 * 1024 * 1024) {
        throw new RangeError('Constructed SPARQL exceeds 16Mi UTF-16 units.')
      }
      output.push(item)
    } else if (item.kind === 'atom') stack.push(item.text)
    else if (item.kind === 'fragment') {
      for (let i = item.parts.length - 1; i >= 0; i--) stack.push(item.parts[i]!)
    } else {
      const children = item.children
      if (item.kind === 'binary') {
        stack.push(')')
        for (let i = children.length - 1; i >= 0; i--) {
          stack.push(children[i]!)
          if (i > 0) stack.push(` ${item.operator} `)
        }
        stack.push('(')
      } else if (item.operator === '/' || item.operator === '|') {
        if (item.operator === '|') stack.push(')')
        for (let i = children.length - 1; i >= 0; i--) {
          stack.push(children[i]!)
          if (i > 0) stack.push(item.operator)
        }
        if (item.operator === '|') stack.push('(')
      } else if (item.operator === '^') {
        if (children[0]?.kind === 'atom') stack.push(children[0], '^')
        else stack.push(')', children[0]!, '^(')
      } else if (item.operator === '!') {
        stack.push(')')
        for (let i = children.length - 1; i >= 0; i--) {
          stack.push(children[i]!)
          if (i > 0) stack.push('|')
        }
        stack.push('!(')
      } else if (children[0]?.kind === 'atom') stack.push(item.operator, children[0])
      else stack.push(`)${item.operator}`, children[0]!, '(')
    }
  }
  return output.join('')
}

/** Marks a newly constructed pattern with grammar/scope facts. RawPattern deliberately has no record. */
export function pattern<Value extends object>(value: Value, record: PatternType): Value {
  patterns.set(value, record)
  return value
}

/** Reads checked pattern facts; absence means the caller owns opaque syntax correctness. */
export function inspect(value: object): PatternType | undefined {
  return patterns.get(value) ?? sources.get(value)?.()
}

/** Records the projected output variable at alias construction. */
export function alias<Value extends object>(value: Value, variable: string): Value {
  aliases.set(value, variable)
  return value
}

/** Returns an explicit constructed projection alias without parsing expression text. */
export function projection(value: object): string | undefined {
  return aliases.get(value)
}

/** Paths are predicate syntax and cannot become expression atoms or graph objects. */
export function isPath(value: object): boolean {
  return nodes.get(value)?.kind === 'path'
}

/** Validates checked group BIND targets in source order. Raw patterns remain scope-unknown. */
export function scope(
  values: readonly object[],
  initial: ReadonlySet<string> = new Set(),
): Set<string> {
  const bindings = new Set(initial)
  for (const value of values) {
    const record = inspect(value)
    if (!record) continue
    if (record.kind === 'bind' && record.target && bindings.has(record.target)) {
      throw new TypeError(`BIND target ${record.target} is already in scope.`)
    }
    if (record.children) {
      if (record.kind === 'group') {
        for (const name of scope(record.children, bindings)) bindings.add(name)
      } else if (record.kind !== 'subselect') {
        for (const child of record.children) scope([child])
      }
    }
    for (const name of record.bindings) bindings.add(name)
  }
  return bindings
}

/** Rejects evaluated patterns in template/data grammar; explicit raw fragments retain caller responsibility. */
export function template(
  value: object,
  mode: 'construct' | 'insert' | 'delete' | 'insert-data' | 'delete-data' | 'delete-where',
): void {
  const record = inspect(value)
  if (!record) return
  if (record.kind === 'group') {
    for (const child of record.children ?? []) template(child, mode)
    return
  }
  if (record.kind === 'graph' && mode !== 'construct') {
    for (const child of record.children ?? []) template(child, mode)
  } else if (record.kind !== 'triples') {
    throw new TypeError('Evaluated group clauses cannot appear in a graph template.')
  }
  if (record.paths) throw new TypeError('Property paths cannot appear in graph templates.')
  if (mode.endsWith('data') && record.variables) {
    throw new TypeError('DATA cannot contain variables.')
  }
  if ((mode === 'delete' || mode === 'delete-data' || mode === 'delete-where') && record.blanks) {
    throw new TypeError('DELETE templates cannot contain blank nodes.')
  }
}

/** Mutable convenience builders expose current checked facts through this private seam. */
export function source(value: object, inspect: () => PatternType | undefined): void {
  sources.set(value, inspect)
}

/** Captures text and checked facts when an immutable query admits a mutable pattern builder. */
export function snapshot<Value extends { readonly value: string }>(value: Value): Value {
  if (!sources.has(value)) return value
  const record = inspect(value)
  const copy = { ...value, value: value.value }
  if (record) patterns.set(copy, record)
  return copy
}

/** Checked term role and embedded bindings, separate from opaque raw syntax. */
export interface TermType {
  /** Semantic role determines legal grammar positions. */
  readonly role: 'iri' | 'variable' | 'literal' | 'blank' | 'collection' | 'triple'
  /** Embedded variables carried by collections and triple terms. */
  readonly bindings?: readonly string[]
  /** Blank identity or allocation appears inside this term. */
  readonly blanks?: boolean
}
/** Checked term facts share no parser or engine dependency. */
const terms = new WeakMap<object, TermType>()
/** Constructors record facts once; graph/data role checks never parse their strings. */
export function term<Value extends object>(value: Value, record: TermType): Value {
  terms.set(value, record)
  return value
}
/** Missing facts mean raw caller-owned syntax, not a checked literal or expression. */
export function meaning(value: object): TermType | undefined {
  const owned = terms.get(value)
  if (owned) return owned
  const term = value as { readonly termType?: string; readonly value?: string }
  if (term.termType === 'Variable') return { role: 'variable', bindings: [`?${term.value}`] }
  if (term.termType === 'BlankNode') return { role: 'blank', blanks: true }
  if (term.termType === 'NamedNode') return { role: 'iri' }
  if (term.termType === 'Literal') return { role: 'literal' }
  if (term.termType !== 'Quad') return undefined
  const stack: object[] = [value]
  const seen = new Set<object>()
  const bindings = new Set<string>()
  let blanks = false
  while (stack.length) {
    const next = stack.pop()!
    if (seen.has(next)) continue
    seen.add(next)
    const record = next as {
      readonly termType?: string
      readonly value?: string
      readonly subject?: object
      readonly predicate?: object
      readonly object?: object
    }
    if (record.termType === 'Variable') bindings.add(`?${record.value}`)
    else if (record.termType === 'BlankNode') blanks = true
    else if (record.termType === 'Quad') {
      if (record.subject) stack.push(record.subject)
      if (record.predicate) stack.push(record.predicate)
      if (record.object) stack.push(record.object)
    }
  }
  return { role: 'triple', bindings: [...bindings], blanks }
}
