/**
 * Loss-preserving SHACL Core shapes-graph reader.
 *
 * The reader materializes the shapes graph because SHACL lists and property
 * paths require random access. It does not validate data graphs and it does not
 * evaluate SHACL 1.2 Node Expressions. Known Core statements are normalized
 * into the semantic model; unsupported or malformed statements remain in the
 * assertion set with diagnostics.
 *
 * @module
 */

import { iterate } from '../source.ts'
import { key, RDF, XSD } from '../term.ts'
import type { Literal, ObjectTerm, Quad, Subject } from '../term.ts'
import { ShapeIndex } from './index.ts'
import { readList } from './list.ts'
import type {
  AssertionType,
  ConstraintType,
  DiagnosticType,
  GraphType,
  IdType,
  LiteralType,
  MetadataType,
  PathType,
  ShapeType,
  TargetType,
  TermType,
  TextType,
  VersionType,
} from './model.ts'
import { readPath } from './path.ts'
import { assertion, id, literal, term, text } from './value.ts'

/** SHACL namespace used to identify Core shapes, targets, constraints, and metadata. */
const SH = 'http://www.w3.org/ns/shacl#'
/** RDFS namespace used for label/comment metadata understood by the shape reader. */
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#'

/** IRI identifying explicit SHACL node shapes. */
const NODE_SHAPE = `${SH}NodeShape`
/** IRI identifying explicit SHACL property shapes. */
const PROPERTY_SHAPE = `${SH}PropertyShape`
/** SHACL 1.2 class used for resources that act as both classes and shapes. */
const SHAPE_CLASS = `${SH}ShapeClass`
/** SHACL 1.2 `sh:ByTypes` value accepted by the expanded closed-shape constraint. */
const BY_TYPES = `${SH}ByTypes`

/** Known SHACL predicates that are sufficient evidence to discover an implicit shape resource. */
const SHAPE_PREDICATES = new Set([
  `${SH}path`, `${SH}targetNode`, `${SH}targetClass`, `${SH}targetSubjectsOf`, `${SH}targetObjectsOf`,
  `${SH}targetWhere`, `${SH}shape`, `${SH}severity`, `${SH}message`, `${SH}deactivated`,
  `${SH}class`, `${SH}datatype`, `${SH}nodeKind`, `${SH}minCount`, `${SH}maxCount`,
  `${SH}minExclusive`, `${SH}minInclusive`, `${SH}maxExclusive`, `${SH}maxInclusive`,
  `${SH}minLength`, `${SH}maxLength`, `${SH}pattern`, `${SH}flags`, `${SH}singleLine`,
  `${SH}languageIn`, `${SH}uniqueLang`, `${SH}memberShape`, `${SH}minListLength`, `${SH}maxListLength`,
  `${SH}uniqueMembers`, `${SH}equals`, `${SH}disjoint`, `${SH}subsetOf`, `${SH}lessThan`,
  `${SH}lessThanOrEquals`, `${SH}not`, `${SH}and`, `${SH}or`, `${SH}xone`, `${SH}node`, `${SH}property`,
  `${SH}someValue`, `${SH}qualifiedValueShape`, `${SH}qualifiedMinCount`, `${SH}qualifiedMaxCount`,
  `${SH}qualifiedValueShapesDisjoint`, `${SH}reifierShape`, `${SH}reificationRequired`, `${SH}closed`,
  `${SH}ignoredProperties`, `${SH}hasValue`, `${SH}in`, `${SH}rootClass`, `${SH}uniqueValuesFor`,
  `${SH}name`, `${SH}description`, `${SH}intent`, `${SH}agentInstruction`, `${SH}codeIdentifier`,
  `${SH}unit`, `${SH}order`, `${SH}group`, `${SH}values`, `${SH}defaultValue`,
])

/** Core predicates that require an `unsupported-version` diagnostic when read in SHACL 1.0 mode. */
const SHACL_12_PREDICATES = new Set([
  `${SH}targetWhere`, `${SH}shape`, `${SH}singleLine`, `${SH}memberShape`, `${SH}minListLength`,
  `${SH}maxListLength`, `${SH}uniqueMembers`, `${SH}subsetOf`, `${SH}someValue`, `${SH}reifierShape`,
  `${SH}reificationRequired`, `${SH}rootClass`, `${SH}uniqueValuesFor`, `${SH}intent`, `${SH}agentInstruction`,
  `${SH}codeIdentifier`, `${SH}values`, `${SH}defaultValue`,
])

/** Reader resource limits and draft-version interpretation. */
export interface ReadOptions {
  /** Core vocabulary generation to interpret. Default is the current 1.2 draft. */
  readonly version?: VersionType
  /** Maximum number of quads to materialize. Default is 1,000,000. */
  readonly maxQuads?: number
  /** Maximum members followed from one SHACL list. Default is 100,000. */
  readonly maxListItems?: number
  /** Maximum nested property-path depth. Default is 256. */
  readonly maxPathDepth?: number
  readonly signal?: AbortSignal
}

/** Shared materialized-shape read state carrying version policy, random-access index, diagnostics, and recursion/list limits. */
interface StateType {
  readonly version: VersionType
  readonly index: ShapeIndex
  readonly diagnostics: DiagnosticType[]
  readonly maxListItems: number
  readonly maxPathDepth: number
}

/** Read from the supplied source while preserving caller ownership. */
export async function read(
  source: Iterable<Quad> | AsyncIterable<Quad>,
  options: ReadOptions = {},
): Promise<GraphType> {
  const version = options.version ?? '1.2'
  if (version !== '1.0' && version !== '1.2') throw new TypeError(`Unsupported SHACL version '${String(version)}'.`)
  const maxQuads = options.maxQuads ?? 1_000_000
  const index = new ShapeIndex()
  const quads: Quad[] = []

  for await (const quad of iterate(source)) {
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Aborted', 'AbortError')
    if (quads.length >= maxQuads) throw new RangeError(`SHACL shapes graph exceeds the configured ${maxQuads} quad limit.`)
    quads.push(quad)
    index.add(quad)
  }

  const diagnostics: DiagnosticType[] = []
  const state: StateType = {
    version,
    index,
    diagnostics,
    maxListItems: options.maxListItems ?? 100_000,
    maxPathDepth: options.maxPathDepth ?? 256,
  }
  const candidates = discoverShapes(index)
  const shapes: ShapeType[] = []
  const shapeKeys = new Set<string>()

  for (const subject of candidates) {
    const shape = readShape(state, subject)
    if (!shape) continue
    shapes.push(shape)
    shapeKeys.add(key(subject))
  }

  const graphAssertions: AssertionType[] = []
  for (const quad of quads) {
    if (shapeKeys.has(key(quad.subject))) continue
    if (!quad.predicate.value.startsWith(SH)) continue
    const value = assertion(quad)
    if (value) graphAssertions.push(value)
  }

  shapes.sort((left, right) => idKey(left.id).localeCompare(idKey(right.id)))
  graphAssertions.sort(compareAssertion)
  diagnostics.sort(compareDiagnostic)
  return { version, shapes, diagnostics, assertions: graphAssertions }
}

/** Discovers resources with SHACL type, target, path, or constraint evidence without treating arbitrary labelled ontology resources as shapes. */
function discoverShapes(index: ShapeIndex): Subject[] {
  const values = new Map<string, Subject>()
  for (const subject of index.subjects()) {
    const types = index.get(subject, RDF.type)
    const explicit = types.some((value) =>
      value.termType === 'NamedNode' &&
      (value.value === NODE_SHAPE || value.value === PROPERTY_SHAPE || value.value === SHAPE_CLASS)
    )
    const hasShapePredicate = index.quads(subject).some((quad) => SHAPE_PREDICATES.has(quad.predicate.value))
    if (explicit || hasShapePredicate) values.set(key(subject), subject)
  }
  return [...values.values()].sort((left, right) => key(left).localeCompare(key(right)))
}

/** Read shape from the supplied source while preserving caller ownership. */
function readShape(state: StateType, subject: Subject): ShapeType | undefined {
  const shapeId = id(subject)
  if (!shapeId) {
    state.diagnostics.push({ code: 'invalid-shape-id', severity: 'error', message: 'SHACL shape identifier must be an IRI or blank node.' })
    return undefined
  }

  recordVersionDiagnostics(state, subject, shapeId)
  const consumed = new Set<string>([RDF.type])
  const types = state.index.get(subject, RDF.type)
    .filter((value) => value.termType === 'NamedNode')
    .map((value) => value.value)
    .sort()
  const pathValues = state.index.get(subject, `${SH}path`)
  const explicitProperty = state.index.get(subject, RDF.type).some((value) => value.termType === 'NamedNode' && value.value === PROPERTY_SHAPE)
  const kind = explicitProperty || pathValues.length > 0 ? 'property' : 'node'
  let path: PathType | undefined
  if (pathValues.length > 0) {
    consumed.add(`${SH}path`)
    if (pathValues.length !== 1) addCardinality(state, shapeId, `${SH}path`, 'A property shape must have at most one sh:path value.')
    path = readPath(state.index, pathValues[0]!, pathOptions(state, shapeId, `${SH}path`))
  }

  const targets = readTargets(state, subject, shapeId, consumed)
  const severity = readIriSingleton(state, subject, shapeId, `${SH}severity`, consumed)
  const messages = readTextValues(state, subject, shapeId, `${SH}message`, consumed)
  const deactivated = readTermValues(state, subject, `${SH}deactivated`, consumed)
  const constraints = readConstraints(state, subject, shapeId, consumed)
  const metadata = readMetadata(state, subject, shapeId, consumed)
  const assertions = readAssertions(state, subject, consumed)

  const value: {
    id: IdType
    kind: 'node' | 'property'
    types: readonly string[]
    path?: PathType
    targets: readonly TargetType[]
    severity?: string
    messages: readonly TextType[]
    deactivated: readonly TermType[]
    constraints: readonly ConstraintType[]
    metadata: MetadataType
    assertions: readonly AssertionType[]
  } = { id: shapeId, kind, types, targets, messages, deactivated, constraints, metadata, assertions }
  if (path) value.path = path
  if (severity) value.severity = severity
  return value
}

/** Read targets from the supplied source while preserving caller ownership. */
function readTargets(
  state: StateType,
  subject: Subject,
  shape: IdType,
  consumed: Set<string>,
): TargetType[] {
  const targets: TargetType[] = []
  for (const value of state.index.get(subject, `${SH}targetNode`)) {
    const record = term(value)
    if (record) targets.push({ kind: 'node', value: record })
    else addInvalid(state, shape, `${SH}targetNode`, 'sh:targetNode value cannot be represented as a shape term.')
  }
  consumeWhenPresent(state, subject, consumed, `${SH}targetNode`)
  pushIriTargets(state, subject, shape, consumed, `${SH}targetClass`, 'class', targets)
  pushIriTargets(state, subject, shape, consumed, `${SH}targetSubjectsOf`, 'subjectsOf', targets)
  pushIriTargets(state, subject, shape, consumed, `${SH}targetObjectsOf`, 'objectsOf', targets)

  for (const value of state.index.get(subject, `${SH}targetWhere`)) {
    const record = term(value)
    if (record) targets.push({ kind: 'where', expression: record })
    else addInvalid(state, shape, `${SH}targetWhere`, 'sh:targetWhere value cannot be represented as an RDF term.')
  }
  consumeWhenPresent(state, subject, consumed, `${SH}targetWhere`)

  for (const value of state.index.get(subject, `${SH}shape`)) {
    const shapeValue = id(value)
    if (shapeValue) targets.push({ kind: 'shape', shape: shapeValue })
    else addInvalid(state, shape, `${SH}shape`, 'sh:shape target must reference an IRI or blank node.')
  }
  consumeWhenPresent(state, subject, consumed, `${SH}shape`)
  return targets
}

/** Reads every IRI-valued target assertion, retaining invalid values through diagnostics instead of silently coercing them. */
function pushIriTargets(
  state: StateType,
  subject: Subject,
  shape: IdType,
  consumed: Set<string>,
  predicate: string,
  kind: 'class' | 'subjectsOf' | 'objectsOf',
  targets: TargetType[],
): void {
  for (const value of state.index.get(subject, predicate)) {
    if (value.termType === 'NamedNode') targets.push({ kind, iri: value.value })
    else addInvalid(state, shape, predicate, `${local(predicate)} must reference an IRI.`)
  }
  consumeWhenPresent(state, subject, consumed, predicate)
}

/** Read constraints from the supplied source while preserving caller ownership. */
function readConstraints(
  state: StateType,
  subject: Subject,
  shape: IdType,
  consumed: Set<string>,
): ConstraintType[] {
  const constraints: ConstraintType[] = []

  pushChoiceConstraints(state, subject, shape, consumed, `${SH}class`, 'class', constraints)
  pushChoiceConstraints(state, subject, shape, consumed, `${SH}datatype`, 'datatype', constraints)
  pushChoiceConstraints(state, subject, shape, consumed, `${SH}nodeKind`, 'nodeKind', constraints)
  pushIntegerConstraints(state, subject, shape, consumed, `${SH}minCount`, 'minCount', 'count', constraints)
  pushIntegerConstraints(state, subject, shape, consumed, `${SH}maxCount`, 'maxCount', 'count', constraints)
  pushLiteralConstraints(state, subject, shape, consumed, `${SH}minExclusive`, 'minExclusive', constraints)
  pushLiteralConstraints(state, subject, shape, consumed, `${SH}minInclusive`, 'minInclusive', constraints)
  pushLiteralConstraints(state, subject, shape, consumed, `${SH}maxExclusive`, 'maxExclusive', constraints)
  pushLiteralConstraints(state, subject, shape, consumed, `${SH}maxInclusive`, 'maxInclusive', constraints)
  pushIntegerConstraints(state, subject, shape, consumed, `${SH}minLength`, 'minLength', 'length', constraints)
  pushIntegerConstraints(state, subject, shape, consumed, `${SH}maxLength`, 'maxLength', 'length', constraints)
  pushPatternConstraints(state, subject, shape, consumed, constraints)
  pushBooleanConstraints(state, subject, shape, consumed, `${SH}singleLine`, 'singleLine', constraints)
  pushLanguageConstraints(state, subject, shape, consumed, constraints)
  pushBooleanConstraints(state, subject, shape, consumed, `${SH}uniqueLang`, 'uniqueLang', constraints)
  pushShapeConstraints(state, subject, shape, consumed, `${SH}memberShape`, 'memberShape', constraints)
  pushIntegerConstraints(state, subject, shape, consumed, `${SH}minListLength`, 'minListLength', 'length', constraints)
  pushIntegerConstraints(state, subject, shape, consumed, `${SH}maxListLength`, 'maxListLength', 'length', constraints)
  pushBooleanConstraints(state, subject, shape, consumed, `${SH}uniqueMembers`, 'uniqueMembers', constraints)

  for (const [predicate, kind] of [
    [`${SH}equals`, 'equals'], [`${SH}disjoint`, 'disjoint'], [`${SH}subsetOf`, 'subsetOf'],
    [`${SH}lessThan`, 'lessThan'], [`${SH}lessThanOrEquals`, 'lessThanOrEquals'],
  ] as const) pushPathConstraints(state, subject, shape, consumed, predicate, kind, constraints)

  pushShapeConstraints(state, subject, shape, consumed, `${SH}not`, 'not', constraints)
  pushShapeListConstraints(state, subject, shape, consumed, `${SH}and`, 'and', constraints)
  pushShapeListConstraints(state, subject, shape, consumed, `${SH}or`, 'or', constraints)
  pushShapeListConstraints(state, subject, shape, consumed, `${SH}xone`, 'xone', constraints)
  pushShapeConstraints(state, subject, shape, consumed, `${SH}node`, 'node', constraints)
  pushShapeConstraints(state, subject, shape, consumed, `${SH}property`, 'property', constraints)
  pushShapeConstraints(state, subject, shape, consumed, `${SH}someValue`, 'someValue', constraints)
  pushQualifiedConstraints(state, subject, shape, consumed, constraints)
  pushShapeConstraints(state, subject, shape, consumed, `${SH}reifierShape`, 'reifierShape', constraints)
  pushBooleanConstraints(state, subject, shape, consumed, `${SH}reificationRequired`, 'reificationRequired', constraints)
  pushClosedConstraints(state, subject, shape, consumed, constraints)

  for (const value of state.index.get(subject, `${SH}hasValue`)) {
    const record = term(value)
    if (record) constraints.push({ kind: 'hasValue', value: record })
    else addInvalid(state, shape, `${SH}hasValue`, 'sh:hasValue cannot be represented as a shape term.')
  }
  consumeWhenPresent(state, subject, consumed, `${SH}hasValue`)
  pushTermListConstraints(state, subject, shape, consumed, `${SH}in`, constraints)
  pushIriConstraints(state, subject, shape, consumed, `${SH}rootClass`, 'rootClass', constraints)
  pushUniqueValuesFor(state, subject, shape, consumed, constraints)

  return constraints
}

/** Reads class/datatype/node-kind constraints as either one IRI or a SHACL 1.2 IRI choice list. */
function pushChoiceConstraints(
  state: StateType,
  subject: Subject,
  shape: IdType,
  consumed: Set<string>,
  predicate: string,
  kind: 'class' | 'datatype' | 'nodeKind',
  constraints: ConstraintType[],
): void {
  for (const value of state.index.get(subject, predicate)) {
    const choices = readIriChoices(state, value, shape, predicate)
    if (choices) constraints.push({ kind, choices })
  }
  consumeWhenPresent(state, subject, consumed, predicate)
}

/** Read iri choices from the supplied source while preserving caller ownership. */
function readIriChoices(
  state: StateType,
  value: ObjectTerm,
  shape: IdType,
  predicate: string,
): readonly string[] | undefined {
  if ((value.termType === 'NamedNode' || value.termType === 'BlankNode') && state.index.isList(value)) {
    const members = readList(state.index, value, listOptions(state, shape, predicate))
    if (!members) return undefined
    const choices: string[] = []
    for (const member of members) {
      if (member.termType !== 'NamedNode') {
        addInvalid(state, shape, predicate, `${local(predicate)} list members must be IRIs.`)
        return undefined
      }
      choices.push(member.value)
    }
    return choices
  }
  if (value.termType === 'NamedNode') return [value.value]
  addInvalid(state, shape, predicate, `${local(predicate)} must be an IRI or SHACL list of IRIs.`)
  return undefined
}

/** Reads non-negative integer constraints and records malformed/cardinality violations without dropping their source assertions. */
function pushIntegerConstraints(
  state: StateType,
  subject: Subject,
  shape: IdType,
  consumed: Set<string>,
  predicate: string,
  kind: 'minCount' | 'maxCount' | 'minLength' | 'maxLength' | 'minListLength' | 'maxListLength',
  field: 'count' | 'length',
  constraints: ConstraintType[],
): void {
  for (const value of state.index.get(subject, predicate)) {
    const integer = integerValue(value)
    if (integer === undefined || integer < 0) {
      addInvalid(state, shape, predicate, `${local(predicate)} must be a non-negative xsd:integer literal.`)
      continue
    }
    constraints.push(field === 'count' ? { kind: kind as 'minCount' | 'maxCount', count: integer } : { kind: kind as 'minLength' | 'maxLength' | 'minListLength' | 'maxListLength', length: integer })
  }
  consumeWhenPresent(state, subject, consumed, predicate)
}

/** Preserves literal-valued comparison constraints as RDF terms so datatype ordering remains a validator concern. */
function pushLiteralConstraints(
  state: StateType,
  subject: Subject,
  shape: IdType,
  consumed: Set<string>,
  predicate: string,
  kind: 'minExclusive' | 'minInclusive' | 'maxExclusive' | 'maxInclusive',
  constraints: ConstraintType[],
): void {
  for (const value of state.index.get(subject, predicate)) {
    if (value.termType === 'Literal') constraints.push({ kind, value: literal(value) })
    else addInvalid(state, shape, predicate, `${local(predicate)} must be a literal.`)
  }
  consumeWhenPresent(state, subject, consumed, predicate)
}

/** Combines `sh:pattern` with its optional `sh:flags` value while diagnosing duplicate or non-string values. */
function pushPatternConstraints(
  state: StateType,
  subject: Subject,
  shape: IdType,
  consumed: Set<string>,
  constraints: ConstraintType[],
): void {
  const flags = state.index.get(subject, `${SH}flags`)
  let flag: string | undefined
  if (flags.length > 1) addCardinality(state, shape, `${SH}flags`, 'A shape must have at most one sh:flags value.')
  if (flags[0]) {
    if (isStringLiteral(flags[0])) flag = flags[0].value
    else addInvalid(state, shape, `${SH}flags`, 'sh:flags must be an xsd:string literal.')
  }
  if (flags.length) consumed.add(`${SH}flags`)

  for (const value of state.index.get(subject, `${SH}pattern`)) {
    if (!isStringLiteral(value)) {
      addInvalid(state, shape, `${SH}pattern`, 'sh:pattern must be an xsd:string literal.')
      continue
    }
    constraints.push(flag === undefined ? { kind: 'pattern', pattern: value.value } : { kind: 'pattern', pattern: value.value, flags: flag })
  }
  consumeWhenPresent(state, subject, consumed, `${SH}pattern`)
}

/** Reads language-list constraints from RDF lists and preserves their declared member order. */
function pushLanguageConstraints(
  state: StateType,
  subject: Subject,
  shape: IdType,
  consumed: Set<string>,
  constraints: ConstraintType[],
): void {
  for (const value of state.index.get(subject, `${SH}languageIn`)) {
    const members = readList(state.index, value, listOptions(state, shape, `${SH}languageIn`))
    if (!members) continue
    const languages: string[] = []
    let valid = true
    for (const member of members) {
      if (!isStringLiteral(member)) {
        addInvalid(state, shape, `${SH}languageIn`, 'sh:languageIn list members must be xsd:string literals.')
        valid = false
        break
      }
      languages.push(member.value)
    }
    if (valid) constraints.push({ kind: 'languageIn', languages })
  }
  consumeWhenPresent(state, subject, consumed, `${SH}languageIn`)
}

/** Reads singleton `xsd:boolean` constraints using RDF lexical boolean rules. */
function pushBooleanConstraints(
  state: StateType,
  subject: Subject,
  shape: IdType,
  consumed: Set<string>,
  predicate: string,
  kind: 'singleLine' | 'uniqueLang' | 'uniqueMembers' | 'reificationRequired',
  constraints: ConstraintType[],
): void {
  for (const value of state.index.get(subject, predicate)) {
    const boolean = booleanValue(value)
    if (boolean === undefined) {
      addInvalid(state, shape, predicate, `${local(predicate)} must be an xsd:boolean literal.`)
      continue
    }
    constraints.push({ kind, value: boolean })
  }
  consumeWhenPresent(state, subject, consumed, predicate)
}

/** Reads constraints that reference exactly one named or blank-node shape and diagnoses non-shape terms. */
function pushShapeConstraints(
  state: StateType,
  subject: Subject,
  shape: IdType,
  consumed: Set<string>,
  predicate: string,
  kind: 'memberShape' | 'not' | 'node' | 'property' | 'someValue' | 'reifierShape',
  constraints: ConstraintType[],
): void {
  for (const value of state.index.get(subject, predicate)) {
    const reference = id(value)
    if (reference) constraints.push({ kind, shape: reference })
    else addInvalid(state, shape, predicate, `${local(predicate)} must reference a shape IRI or blank node.`)
  }
  consumeWhenPresent(state, subject, consumed, predicate)
}

/** Resolves SHACL shape lists such as `and`, `or`, and `xone` under the configured list limits. */
function pushShapeListConstraints(
  state: StateType,
  subject: Subject,
  shape: IdType,
  consumed: Set<string>,
  predicate: string,
  kind: 'and' | 'or' | 'xone',
  constraints: ConstraintType[],
): void {
  for (const value of state.index.get(subject, predicate)) {
    const members = readList(state.index, value, listOptions(state, shape, predicate))
    if (!members) continue
    const shapes: IdType[] = []
    let valid = true
    for (const member of members) {
      const reference = id(member)
      if (!reference) {
        addInvalid(state, shape, predicate, `${local(predicate)} list members must reference shapes.`)
        valid = false
        break
      }
      shapes.push(reference)
    }
    if (valid) constraints.push({ kind, shapes })
  }
  consumeWhenPresent(state, subject, consumed, predicate)
}

/** Reads property-pair constraints using the full SHACL path reader rather than restricting them to predicate IRIs. */
function pushPathConstraints(
  state: StateType,
  subject: Subject,
  shape: IdType,
  consumed: Set<string>,
  predicate: string,
  kind: 'equals' | 'disjoint' | 'subsetOf' | 'lessThan' | 'lessThanOrEquals',
  constraints: ConstraintType[],
): void {
  for (const value of state.index.get(subject, predicate)) {
    const path = readPath(state.index, value, pathOptions(state, shape, predicate))
    constraints.push({ kind, path })
  }
  consumeWhenPresent(state, subject, consumed, predicate)
}

/** Aggregates qualified shape, min/max count, and disjointness assertions into one qualified-value constraint. */
function pushQualifiedConstraints(
  state: StateType,
  subject: Subject,
  shape: IdType,
  consumed: Set<string>,
  constraints: ConstraintType[],
): void {
  const shapes = state.index.get(subject, `${SH}qualifiedValueShape`)
  const mins = state.index.get(subject, `${SH}qualifiedMinCount`)
  const maxes = state.index.get(subject, `${SH}qualifiedMaxCount`)
  const disjoints = state.index.get(subject, `${SH}qualifiedValueShapesDisjoint`)
  for (const predicate of [`${SH}qualifiedValueShape`, `${SH}qualifiedMinCount`, `${SH}qualifiedMaxCount`, `${SH}qualifiedValueShapesDisjoint`]) {
    consumeWhenPresent(state, subject, consumed, predicate)
  }
  if (!shapes.length && !mins.length && !maxes.length && !disjoints.length) return
  if (shapes.length !== 1) {
    addInvalid(state, shape, `${SH}qualifiedValueShape`, 'Qualified cardinality requires exactly one sh:qualifiedValueShape.')
    return
  }
  const reference = id(shapes[0]!)
  if (!reference) {
    addInvalid(state, shape, `${SH}qualifiedValueShape`, 'sh:qualifiedValueShape must reference a shape.')
    return
  }
  const minCount = optionalInteger(state, mins, shape, `${SH}qualifiedMinCount`)
  const maxCount = optionalInteger(state, maxes, shape, `${SH}qualifiedMaxCount`)
  const disjoint = optionalBoolean(state, disjoints, shape, `${SH}qualifiedValueShapesDisjoint`)
  if (minCount === undefined && maxCount === undefined) {
    addInvalid(state, shape, `${SH}qualifiedValueShape`, 'Qualified cardinality requires sh:qualifiedMinCount or sh:qualifiedMaxCount.')
    return
  }
  const value: {
    kind: 'qualified'
    shape: IdType
    minCount?: number
    maxCount?: number
    disjoint?: boolean
  } = { kind: 'qualified', shape: reference }
  if (minCount !== undefined) value.minCount = minCount
  if (maxCount !== undefined) value.maxCount = maxCount
  if (disjoint !== undefined) value.disjoint = disjoint
  constraints.push(value)
}

/** Reads `sh:closed` as boolean or SHACL 1.2 `sh:ByTypes` and resolves the optional ignored-properties list. */
function pushClosedConstraints(
  state: StateType,
  subject: Subject,
  shape: IdType,
  consumed: Set<string>,
  constraints: ConstraintType[],
): void {
  const ignored = readIriList(state, state.index.get(subject, `${SH}ignoredProperties`)[0], shape, `${SH}ignoredProperties`) ?? []
  consumeWhenPresent(state, subject, consumed, `${SH}ignoredProperties`)
  for (const value of state.index.get(subject, `${SH}closed`)) {
    const boolean = booleanValue(value)
    if (boolean !== undefined) {
      constraints.push({ kind: 'closed', mode: boolean, ignoredProperties: ignored })
      continue
    }
    if (state.version === '1.2' && value.termType === 'NamedNode' && value.value === BY_TYPES) {
      constraints.push({ kind: 'closed', mode: 'byTypes', ignoredProperties: ignored })
      continue
    }
    addInvalid(state, shape, `${SH}closed`, 'sh:closed must be xsd:boolean or sh:ByTypes in SHACL 1.2.')
  }
  consumeWhenPresent(state, subject, consumed, `${SH}closed`)
}

/** Resolves RDF-list term constraints such as `sh:in` while retaining each RDF term without JSON coercion. */
function pushTermListConstraints(
  state: StateType,
  subject: Subject,
  shape: IdType,
  consumed: Set<string>,
  predicate: string,
  constraints: ConstraintType[],
): void {
  for (const value of state.index.get(subject, predicate)) {
    const members = readList(state.index, value, listOptions(state, shape, predicate))
    if (!members) continue
    const values = members.map(term)
    if (values.some((entry) => entry === undefined)) {
      addInvalid(state, shape, predicate, `${local(predicate)} contains an unsupported RDF term.`)
      continue
    }
    constraints.push({ kind: 'in', values: values as TermType[] })
  }
  consumeWhenPresent(state, subject, consumed, predicate)
}

/** Reads singleton IRI-valued constraints such as `sh:rootClass` and diagnoses non-IRI values. */
function pushIriConstraints(
  state: StateType,
  subject: Subject,
  shape: IdType,
  consumed: Set<string>,
  predicate: string,
  kind: 'rootClass',
  constraints: ConstraintType[],
): void {
  for (const value of state.index.get(subject, predicate)) {
    if (value.termType === 'NamedNode') constraints.push({ kind, iri: value.value })
    else addInvalid(state, shape, predicate, `${local(predicate)} must reference an IRI.`)
  }
  consumeWhenPresent(state, subject, consumed, predicate)
}

/** Reads SHACL 1.2 `sh:uniqueValuesFor` as a non-empty list of property paths. */
function pushUniqueValuesFor(
  state: StateType,
  subject: Subject,
  shape: IdType,
  consumed: Set<string>,
  constraints: ConstraintType[],
): void {
  for (const value of state.index.get(subject, `${SH}uniqueValuesFor`)) {
    const members = state.index.isList(value) ? readList(state.index, value, listOptions(state, shape, `${SH}uniqueValuesFor`)) : [value]
    if (!members) continue
    const paths = members.map((member) => readPath(state.index, member, pathOptions(state, shape, `${SH}uniqueValuesFor`)))
    constraints.push({ kind: 'uniqueValuesFor', paths })
  }
  consumeWhenPresent(state, subject, consumed, `${SH}uniqueValuesFor`)
}

/** Read metadata from the supplied source while preserving caller ownership. */
function readMetadata(
  state: StateType,
  subject: Subject,
  shape: IdType,
  consumed: Set<string>,
): MetadataType {
  const names = [
    ...readTextValues(state, subject, shape, `${SH}name`, consumed),
    ...readTextValues(state, subject, shape, `${RDFS}label`, consumed),
  ]
  const descriptions = [
    ...readTextValues(state, subject, shape, `${SH}description`, consumed),
    ...readTextValues(state, subject, shape, `${RDFS}comment`, consumed),
  ]
  const intents = readTextValues(state, subject, shape, `${SH}intent`, consumed)
  const agentInstructions = readTextValues(state, subject, shape, `${SH}agentInstruction`, consumed)
  const codeIdentifiers = readStringValues(state, subject, shape, `${SH}codeIdentifier`, consumed)
  const units = readTermValues(state, subject, `${SH}unit`, consumed)
  const order = readLiteralValues(state, subject, shape, `${SH}order`, consumed)
  const groups = readIdValues(state, subject, shape, `${SH}group`, consumed)
  const values = readTermValues(state, subject, `${SH}values`, consumed)
  const defaultValues = readTermValues(state, subject, `${SH}defaultValue`, consumed)
  return { names, descriptions, intents, agentInstructions, codeIdentifiers, units, order, groups, values, defaultValues }
}

/** Read assertions from the supplied source while preserving caller ownership. */
function readAssertions(state: StateType, subject: Subject, consumed: ReadonlySet<string>): AssertionType[] {
  const values: AssertionType[] = []
  const invalidPredicates = new Set(
    state.diagnostics
      .filter((diagnostic) => diagnostic.shape && idKey(diagnostic.shape) === idKey(id(subject)!) && diagnostic.predicate)
      .map((diagnostic) => diagnostic.predicate!),
  )
  for (const quad of state.index.quads(subject)) {
    if (consumed.has(quad.predicate.value) && !invalidPredicates.has(quad.predicate.value)) continue
    const value = assertion(quad)
    if (value) values.push(value)
  }
  values.sort(compareAssertion)
  return values
}

/** Read text values from the supplied source while preserving caller ownership. */
function readTextValues(
  state: StateType,
  subject: Subject,
  shape: IdType,
  predicate: string,
  consumed: Set<string>,
): TextType[] {
  const values: TextType[] = []
  for (const value of state.index.get(subject, predicate)) {
    if (value.termType === 'Literal') values.push(text(value))
    else addInvalid(state, shape, predicate, `${local(predicate)} must be a literal.`)
  }
  consumeWhenPresent(state, subject, consumed, predicate)
  return values
}

/** Read string values from the supplied source while preserving caller ownership. */
function readStringValues(
  state: StateType,
  subject: Subject,
  shape: IdType,
  predicate: string,
  consumed: Set<string>,
): string[] {
  const values: string[] = []
  for (const value of state.index.get(subject, predicate)) {
    if (isStringLiteral(value)) values.push(value.value)
    else addInvalid(state, shape, predicate, `${local(predicate)} must be an xsd:string literal.`)
  }
  consumeWhenPresent(state, subject, consumed, predicate)
  return values
}

/** Read term values from the supplied source while preserving caller ownership. */
function readTermValues(state: StateType, subject: Subject, predicate: string, consumed: Set<string>): TermType[] {
  const values: TermType[] = []
  for (const value of state.index.get(subject, predicate)) {
    const record = term(value)
    if (record) values.push(record)
  }
  consumeWhenPresent(state, subject, consumed, predicate)
  return values
}

/** Read literal values from the supplied source while preserving caller ownership. */
function readLiteralValues(
  state: StateType,
  subject: Subject,
  shape: IdType,
  predicate: string,
  consumed: Set<string>,
): LiteralType[] {
  const values: LiteralType[] = []
  for (const value of state.index.get(subject, predicate)) {
    if (value.termType === 'Literal') values.push(literal(value))
    else addInvalid(state, shape, predicate, `${local(predicate)} must be a literal.`)
  }
  consumeWhenPresent(state, subject, consumed, predicate)
  return values
}

/** Read id values from the supplied source while preserving caller ownership. */
function readIdValues(
  state: StateType,
  subject: Subject,
  shape: IdType,
  predicate: string,
  consumed: Set<string>,
): IdType[] {
  const values: IdType[] = []
  for (const value of state.index.get(subject, predicate)) {
    const reference = id(value)
    if (reference) values.push(reference)
    else addInvalid(state, shape, predicate, `${local(predicate)} must reference an IRI or blank node.`)
  }
  consumeWhenPresent(state, subject, consumed, predicate)
  return values
}

/** Read iri singleton from the supplied source while preserving caller ownership. */
function readIriSingleton(
  state: StateType,
  subject: Subject,
  shape: IdType,
  predicate: string,
  consumed: Set<string>,
): string | undefined {
  const values = state.index.get(subject, predicate)
  consumeWhenPresent(state, subject, consumed, predicate)
  if (values.length > 1) addCardinality(state, shape, predicate, `${local(predicate)} must have at most one value.`)
  const value = values[0]
  if (!value) return undefined
  if (value.termType === 'NamedNode') return value.value
  addInvalid(state, shape, predicate, `${local(predicate)} must reference an IRI.`)
  return undefined
}

/** Read iri list from the supplied source while preserving caller ownership. */
function readIriList(
  state: StateType,
  value: ObjectTerm | undefined,
  shape: IdType,
  predicate: string,
): readonly string[] | undefined {
  if (!value) return undefined
  const members = readList(state.index, value, listOptions(state, shape, predicate))
  if (!members) return undefined
  const values: string[] = []
  for (const member of members) {
    if (member.termType !== 'NamedNode') {
      addInvalid(state, shape, predicate, `${local(predicate)} list members must be IRIs.`)
      return undefined
    }
    values.push(member.value)
  }
  return values
}

/** Reads an optional singleton non-negative `xsd:integer`, diagnosing duplicate or invalid lexical values. */
function optionalInteger(
  state: StateType,
  values: readonly ObjectTerm[],
  shape: IdType,
  predicate: string,
): number | undefined {
  if (values.length > 1) addCardinality(state, shape, predicate, `${local(predicate)} must have at most one value.`)
  if (!values[0]) return undefined
  const value = integerValue(values[0])
  if (value === undefined || value < 0) addInvalid(state, shape, predicate, `${local(predicate)} must be a non-negative xsd:integer.`)
  return value !== undefined && value >= 0 ? value : undefined
}

/** Reads an optional singleton `xsd:boolean`, accepting canonical and numeric RDF boolean lexical forms. */
function optionalBoolean(
  state: StateType,
  values: readonly ObjectTerm[],
  shape: IdType,
  predicate: string,
): boolean | undefined {
  if (values.length > 1) addCardinality(state, shape, predicate, `${local(predicate)} must have at most one value.`)
  if (!values[0]) return undefined
  const value = booleanValue(values[0])
  if (value === undefined) addInvalid(state, shape, predicate, `${local(predicate)} must be xsd:boolean.`)
  return value
}

/** Decodes a safe JavaScript integer only from an `xsd:integer` lexical form. */
function integerValue(value: ObjectTerm): number | undefined {
  if (value.termType !== 'Literal' || value.datatype.value !== XSD.integer || !/^[+-]?\d+$/.test(value.value)) return undefined
  const integer = Number(value.value)
  return Number.isSafeInteger(integer) ? integer : undefined
}

/** Decodes RDF `xsd:boolean` lexical forms without accepting JavaScript truthiness. */
function booleanValue(value: ObjectTerm): boolean | undefined {
  if (value.termType !== 'Literal' || value.datatype.value !== XSD.boolean) return undefined
  if (value.value === 'true' || value.value === '1') return true
  if (value.value === 'false' || value.value === '0') return false
  return undefined
}

/** Returns whether the supplied value satisfies the string literal contract. */
function isStringLiteral(value: ObjectTerm): value is Literal {
  return value.termType === 'Literal' && value.datatype.value === XSD.string
}

/** Marks a predicate consumed only when the source graph actually contains at least one value for it. */
function consumeWhenPresent(state: StateType, subject: Subject, consumed: Set<string>, predicate: string): void {
  if (state.index.get(subject, predicate).length) consumed.add(predicate)
}

/** Creates bounded RDF-list read options that attach diagnostics to the owning shape and predicate. */
function listOptions(state: StateType, shape: IdType, predicate: string) {
  return { maxItems: state.maxListItems, diagnostics: state.diagnostics, shape, predicate }
}

/** Creates bounded SHACL-path read options that attach recursion diagnostics to the owning assertion. */
function pathOptions(state: StateType, shape: IdType, predicate: string) {
  return {
    maxDepth: state.maxPathDepth,
    maxListItems: state.maxListItems,
    diagnostics: state.diagnostics,
    shape,
    predicate,
  }
}

/** Records SHACL 1.2-only terms encountered in 1.0 mode while leaving those assertions available for loss-preserving reads. */
function recordVersionDiagnostics(state: StateType, subject: Subject, shape: IdType): void {
  if (state.version !== '1.0') return
  const types = state.index.get(subject, RDF.type)
  if (types.some((value) => value.termType === 'NamedNode' && value.value === SHAPE_CLASS)) {
    state.diagnostics.push({
      code: 'unsupported-version',
      severity: 'warning',
      message: 'sh:ShapeClass is a SHACL 1.2 feature and is retained while reading in 1.0 mode.',
      shape,
      predicate: RDF.type,
    })
  }
  for (const predicate of SHACL_12_PREDICATES) {
    if (!state.index.get(subject, predicate).length) continue
    state.diagnostics.push({
      code: 'unsupported-version',
      severity: 'warning',
      message: `${local(predicate)} is a SHACL 1.2 Core feature and is retained while reading in 1.0 mode.`,
      shape,
      predicate,
    })
  }
}

/** Records a SHACL source-cardinality error without mutating or discarding the original RDF assertion. */
function addCardinality(state: StateType, shape: IdType, predicate: string, message: string): void {
  state.diagnostics.push({ code: 'invalid-cardinality', severity: 'error', message, shape, predicate })
}

/** Records an invalid known SHACL value; raw assertions remain available to newer or external interpreters. */
function addInvalid(state: StateType, shape: IdType, predicate: string, message: string): void {
  state.diagnostics.push({ code: 'invalid-value', severity: 'error', message, shape, predicate })
}

/** Produces a compact SHACL term label for diagnostics only; it is never used as semantic identity. */
function local(predicate: string): string {
  return predicate.startsWith(SH) ? `sh:${predicate.slice(SH.length)}` : predicate
}

/** Produces a stable sort/deduplication key that distinguishes named and blank-node shape identifiers. */
function idKey(value: IdType): string {
  return `${value.kind}:${value.value}`
}

/** Compare assertion using deterministic semantic ordering. */
function compareAssertion(left: AssertionType, right: AssertionType): number {
  return `${idKey(left.subject)}\u0000${left.predicate}\u0000${JSON.stringify(left.object)}`.localeCompare(`${idKey(right.subject)}\u0000${right.predicate}\u0000${JSON.stringify(right.object)}`)
}

/** Compare diagnostic using deterministic semantic ordering. */
function compareDiagnostic(left: DiagnosticType, right: DiagnosticType): number {
  return `${left.code}\u0000${left.predicate ?? ''}\u0000${left.message}`.localeCompare(`${right.code}\u0000${right.predicate ?? ''}\u0000${right.message}`)
}
