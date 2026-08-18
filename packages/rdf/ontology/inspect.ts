/** RDFS and directly interpretable OWL ontology inspector. @module */

import { iterate } from '../source.ts'
import { key, XSD } from '../term.ts'
import type { Literal, Quad } from '../term.ts'
import type {
  AssertionType,
  ClassType,
  DiagnosticType,
  ModelType,
  PropertyCharacteristicType,
  PropertyKindType,
  PropertyType,
  SourceType,
  TextType,
} from './model.ts'

/** `rdf:type` predicate used to classify ontology resources. */
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
/** `rdf:Property` class used to recognize generic RDF properties. */
const RDF_PROPERTY = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Property'
/** `rdfs:Class` IRI used to recognize declared RDFS classes. */
const RDFS_CLASS = 'http://www.w3.org/2000/01/rdf-schema#Class'
/** `rdfs:Datatype` IRI used to recognize declared RDF datatypes. */
const RDFS_DATATYPE = 'http://www.w3.org/2000/01/rdf-schema#Datatype'
/** `rdfs:subClassOf` predicate used to build direct class inheritance edges. */
const RDFS_SUBCLASS = 'http://www.w3.org/2000/01/rdf-schema#subClassOf'
/** `rdfs:subPropertyOf` predicate used to build direct property inheritance edges. */
const RDFS_SUBPROPERTY = 'http://www.w3.org/2000/01/rdf-schema#subPropertyOf'
/** `rdfs:domain` predicate retained as ontology inference metadata, not JSON requiredness. */
const RDFS_DOMAIN = 'http://www.w3.org/2000/01/rdf-schema#domain'
/** `rdfs:range` predicate retained as ontology inference/range metadata. */
const RDFS_RANGE = 'http://www.w3.org/2000/01/rdf-schema#range'
/** `rdfs:label` predicate used for human-readable ontology names. */
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'
/** `rdfs:comment` predicate used for generated documentation when available. */
const RDFS_COMMENT = 'http://www.w3.org/2000/01/rdf-schema#comment'
/** OWL namespace prefix used to derive directly interpreted OWL terms. */
const OWL = 'http://www.w3.org/2002/07/owl#'
/** `owl:Class` IRI used to recognize declared OWL classes. */
const OWL_CLASS = `${OWL}Class`
/** `owl:ObjectProperty` class mapped to the ontology object-property kind. */
const OWL_OBJECT_PROPERTY = `${OWL}ObjectProperty`
/** `owl:DatatypeProperty` class mapped to the ontology data-property kind. */
const OWL_DATATYPE_PROPERTY = `${OWL}DatatypeProperty`
/** `owl:AnnotationProperty` class mapped to the ontology annotation-property kind. */
const OWL_ANNOTATION_PROPERTY = `${OWL}AnnotationProperty`
/** OWL class that marks a property functional. */
const OWL_FUNCTIONAL_PROPERTY = `${OWL}FunctionalProperty`
/** OWL class that marks a property inverse-functional. */
const OWL_INVERSE_FUNCTIONAL_PROPERTY = `${OWL}InverseFunctionalProperty`
/** OWL class that marks a property transitive. */
const OWL_TRANSITIVE_PROPERTY = `${OWL}TransitiveProperty`
/** OWL class that marks a property symmetric. */
const OWL_SYMMETRIC_PROPERTY = `${OWL}SymmetricProperty`
/** OWL class that marks a property asymmetric. */
const OWL_ASYMMETRIC_PROPERTY = `${OWL}AsymmetricProperty`
/** OWL class that marks a property reflexive. */
const OWL_REFLEXIVE_PROPERTY = `${OWL}ReflexiveProperty`
/** OWL class that marks a property irreflexive. */
const OWL_IRREFLEXIVE_PROPERTY = `${OWL}IrreflexiveProperty`
/** `owl:equivalentClass` predicate used for named-class equivalence edges. */
const OWL_EQUIVALENT_CLASS = `${OWL}equivalentClass`
/** `owl:disjointWith` predicate retained for named-class disjointness. */
const OWL_DISJOINT_CLASS = `${OWL}disjointWith`
/** `owl:equivalentProperty` predicate used for named-property equivalence edges. */
const OWL_EQUIVALENT_PROPERTY = `${OWL}equivalentProperty`
/** `owl:propertyDisjointWith` predicate retained for named-property disjointness. */
const OWL_PROPERTY_DISJOINT = `${OWL}propertyDisjointWith`
/** `owl:inverseOf` predicate used for directly named inverse-property relationships. */
const OWL_INVERSE = `${OWL}inverseOf`
/** `owl:deprecated` predicate used to mark generated ontology symbols deprecated. */
const OWL_DEPRECATED = `${OWL}deprecated`

/** Maps recognized RDF/OWL property class IRIs to the normalized property-kind model. */
const PROPERTY_TYPES = new Map<string, PropertyKindType>([
  [RDF_PROPERTY, 'rdf'],
  [OWL_OBJECT_PROPERTY, 'object'],
  [OWL_DATATYPE_PROPERTY, 'data'],
  [OWL_ANNOTATION_PROPERTY, 'annotation'],
])

/** Maps recognized OWL characteristic classes to normalized property-characteristic values. */
const PROPERTY_CHARACTERISTICS = new Map<string, PropertyCharacteristicType>([
  [OWL_FUNCTIONAL_PROPERTY, 'functional'],
  [OWL_INVERSE_FUNCTIONAL_PROPERTY, 'inverseFunctional'],
  [OWL_TRANSITIVE_PROPERTY, 'transitive'],
  [OWL_SYMMETRIC_PROPERTY, 'symmetric'],
  [OWL_ASYMMETRIC_PROPERTY, 'asymmetric'],
  [OWL_REFLEXIVE_PROPERTY, 'reflexive'],
  [OWL_IRREFLEXIVE_PROPERTY, 'irreflexive'],
])

/** One RDF source contributing to an ontology model. */
export interface OntologySourceType extends SourceType {
  /** RDF quads supplied by or retained for this source. */
  readonly quads: Iterable<Quad> | AsyncIterable<Quad>
}

/** Extension predicates and resource limits for ontology ingestion. */
export interface InspectOptionsType {
  /** Additional predicates that behave like vocabulary-domain declarations. */
  readonly domainPredicates?: readonly string[]
  /** Additional predicates that behave like vocabulary-range declarations. */
  readonly rangePredicates?: readonly string[]
  /** Maximum quads across all sources. Default is 5,000,000. */
  readonly maxQuads?: number
  /** Caller-owned abort signal checked before expensive work and between long-running steps. */
  readonly signal?: AbortSignal
}

/** Mutable accumulation record for one named class before deterministic sets/metadata are frozen into the public ontology model. */
interface MutableClassType {
  /** Absolute IRI represented by this record. */
  readonly iri: string
  /** Localized labels retained from the RDF source. */
  readonly labels: TextType[]
  /** Localized descriptive comments retained from the RDF source. */
  readonly comments: TextType[]
  /** Direct superclass IRIs declared for this class. */
  readonly superClasses: Set<string>
  /** Class IRIs declared equivalent to this class. */
  readonly equivalentClasses: Set<string>
  /** Class IRIs declared disjoint with this class. */
  readonly disjointClasses: Set<string>
  /** Whether the source explicitly marks this ontology term as deprecated. */
  deprecated: boolean
}

/** Mutable accumulation record for one named property before relationship sets and characteristics are normalized. */
interface MutablePropertyType {
  /** Absolute IRI represented by this record. */
  readonly iri: string
  /** RDF/OWL property kinds observed for this property. */
  readonly kinds: Set<PropertyKindType>
  /** Localized labels retained from the RDF source. */
  readonly labels: TextType[]
  /** Localized descriptive comments retained from the RDF source. */
  readonly comments: TextType[]
  /** Class IRIs declared as domains of this property. */
  readonly domains: Set<string>
  /** Class or datatype IRIs declared as ranges of this property. */
  readonly ranges: Set<string>
  /** Direct super-property IRIs declared for this property. */
  readonly superProperties: Set<string>
  /** Property IRIs declared equivalent to this property. */
  readonly equivalentProperties: Set<string>
  /** Property IRIs declared as inverses of this property. */
  readonly inverseOf: Set<string>
  /** Property IRIs declared disjoint with this property. */
  readonly disjointProperties: Set<string>
  /** OWL property characteristics, such as functional or transitive, retained as normalized identifiers. */
  readonly characteristics: Set<PropertyCharacteristicType>
  /** Whether the source explicitly marks this ontology term as deprecated. */
  deprecated: boolean
}

/** Label/comment assertion deferred until its subject is known to be a modeled class, property, or datatype. */
interface PendingTextType {
  /** Stable identifier of the source document that contributed this record. */
  readonly sourceId: string
  /** Semantic model field that receives the deferred ontology value after all source declarations are known. */
  readonly field: 'labels' | 'comments'
  /** Source quad retained until the referenced ontology term is available. */
  readonly quad: Quad
}

/** `owl:deprecated` assertion deferred until the subject kind is known, avoiding premature lossy classification. */
interface PendingDeprecatedType {
  /** Stable identifier of the source document that contributed this record. */
  readonly sourceId: string
  /** Source quad retained until deprecation metadata can be attached to its ontology term. */
  readonly quad: Quad
}

/**
 * Inspects named RDFS/OWL declarations into a deterministic ontology model.
 *
 * This operation does not perform RDFS or OWL entailment. It records declared
 * named relationships and preserves every unsupported assertion so reasoning
 * engines or future consumers can interpret richer class expressions later.
 *
 * Input sources remain caller-owned. `maxQuads` limits materialized work across
 * all sources, and `signal` can stop ingestion between quads.
 *
 * @example
 * ```ts
 * import { namedNode, quad } from '@okikio/rdf'
 * import * as ontology from '@okikio/rdf/ontology'
 *
 * const model = await ontology.inspect([{
 *   id: 'example',
 *   quads: [quad(
 *     namedNode('https://example.test/Person'),
 *     namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
 *     namedNode('http://www.w3.org/2002/07/owl#Class'),
 *   )],
 * }])
 * ```
 */
export async function inspect(
  sources: readonly OntologySourceType[],
  options: InspectOptionsType = {},
): Promise<ModelType> {
  const classes = new Map<string, MutableClassType>()
  const properties = new Map<string, MutablePropertyType>()
  const datatypes = new Set<string>()
  const assertions: AssertionType[] = []
  const diagnostics: DiagnosticType[] = []
  const pendingText: PendingTextType[] = []
  const pendingDeprecated: PendingDeprecatedType[] = []
  const domainPredicates = new Set([RDFS_DOMAIN, ...(options.domainPredicates ?? [])])
  const rangePredicates = new Set([RDFS_RANGE, ...(options.rangePredicates ?? [])])
  const maxQuads = options.maxQuads ?? 5_000_000
  let count = 0

  for (const source of sources) {
    for await (const quad of iterate(source.quads)) {
      if (options.signal?.aborted) {
        throw options.signal.reason ?? new DOMException('Aborted', 'AbortError')
      }
      if (++count > maxQuads) {
        throw new RangeError(`Ontology input exceeds the configured ${maxQuads} quad limit.`)
      }
      if (quad.subject.termType !== 'NamedNode') {
        assertions.push(toAssertion(quad, source.id))
        continue
      }

      const subject = quad.subject.value
      const predicate = quad.predicate.value
      const objectIri = quad.object.termType === 'NamedNode' ? quad.object.value : undefined

      if (predicate === RDF_TYPE && objectIri) {
        if (objectIri === RDFS_CLASS || objectIri === OWL_CLASS) {
          getClass(classes, subject)
          continue
        }
        const propertyKind = PROPERTY_TYPES.get(objectIri)
        if (propertyKind) {
          getProperty(properties, subject).kinds.add(propertyKind)
          continue
        }
        const characteristic = PROPERTY_CHARACTERISTICS.get(objectIri)
        if (characteristic) {
          getProperty(properties, subject).characteristics.add(characteristic)
          continue
        }
        if (
          objectIri === RDFS_DATATYPE ||
          objectIri.startsWith(`${XSD.string.slice(0, XSD.string.lastIndexOf('#') + 1)}`)
        ) {
          datatypes.add(subject)
          continue
        }
      }

      if (predicate === RDFS_SUBCLASS && objectIri) {
        getClass(classes, subject).superClasses.add(objectIri)
        continue
      }
      if (predicate === OWL_EQUIVALENT_CLASS && objectIri) {
        getClass(classes, subject).equivalentClasses.add(objectIri)
        continue
      }
      if (predicate === OWL_DISJOINT_CLASS && objectIri) {
        getClass(classes, subject).disjointClasses.add(objectIri)
        continue
      }
      if (predicate === RDFS_SUBPROPERTY && objectIri) {
        getProperty(properties, subject).superProperties.add(objectIri)
        continue
      }
      if (predicate === OWL_EQUIVALENT_PROPERTY && objectIri) {
        getProperty(properties, subject).equivalentProperties.add(objectIri)
        continue
      }
      if (predicate === OWL_PROPERTY_DISJOINT && objectIri) {
        getProperty(properties, subject).disjointProperties.add(objectIri)
        continue
      }
      if (predicate === OWL_INVERSE && objectIri) {
        getProperty(properties, subject).inverseOf.add(objectIri)
        continue
      }
      if (domainPredicates.has(predicate) && objectIri) {
        getProperty(properties, subject).domains.add(objectIri)
        continue
      }
      if (rangePredicates.has(predicate) && objectIri) {
        getProperty(properties, subject).ranges.add(objectIri)
        continue
      }
      if (predicate === RDFS_LABEL && quad.object.termType === 'Literal') {
        pendingText.push({ sourceId: source.id, field: 'labels', quad })
        continue
      }
      if (predicate === RDFS_COMMENT && quad.object.termType === 'Literal') {
        pendingText.push({ sourceId: source.id, field: 'comments', quad })
        continue
      }
      if (predicate === OWL_DEPRECATED) {
        pendingDeprecated.push({ sourceId: source.id, quad })
        continue
      }

      assertions.push(toAssertion(quad, source.id))
    }
  }

  attachText(classes, properties, pendingText, assertions, diagnostics)
  attachDeprecation(classes, properties, pendingDeprecated, assertions, diagnostics)

  return {
    sources: sources.map(stripQuads),
    classes: [...classes.values()].map(freezeClass).sort(byIri),
    properties: [...properties.values()].map(freezeProperty).sort(byIri),
    datatypes: [...datatypes].sort(),
    assertions: assertions.sort(compareAssertion),
    diagnostics: diagnostics.sort(compareDiagnostic),
  }
}

/** Attaches labels/comments only to classified named ontology resources and records otherwise-unclassified text. */
function attachText(
  classes: ReadonlyMap<string, MutableClassType>,
  properties: ReadonlyMap<string, MutablePropertyType>,
  pending: readonly PendingTextType[],
  assertions: AssertionType[],
  diagnostics: DiagnosticType[],
): void {
  for (const entry of pending) {
    const subject = entry.quad.subject
    const object = entry.quad.object
    if (subject.termType !== 'NamedNode' || object.termType !== 'Literal') continue
    const target = classes.get(subject.value) ?? properties.get(subject.value)
    if (target) {
      target[entry.field].push(toText(object))
      continue
    }
    assertions.push(toAssertion(entry.quad, entry.sourceId))
    diagnostics.push({
      code: 'unclassified-text',
      message: `Text metadata retained for unclassified ontology term ${subject.value}.`,
      sourceId: entry.sourceId,
      term: subject.value,
    })
  }
}

/** Interprets supported deprecation literals while retaining malformed or unclassified declarations diagnostically. */
function attachDeprecation(
  classes: ReadonlyMap<string, MutableClassType>,
  properties: ReadonlyMap<string, MutablePropertyType>,
  pending: readonly PendingDeprecatedType[],
  assertions: AssertionType[],
  diagnostics: DiagnosticType[],
): void {
  for (const entry of pending) {
    const subject = entry.quad.subject
    const object = entry.quad.object
    if (subject.termType !== 'NamedNode' || object.termType !== 'Literal') {
      assertions.push(toAssertion(entry.quad, entry.sourceId))
      continue
    }
    const deprecated = booleanLiteral(object)
    if (deprecated === undefined) {
      assertions.push(toAssertion(entry.quad, entry.sourceId))
      diagnostics.push({
        code: 'invalid-deprecation',
        message: `owl:deprecated for ${subject.value} is not a valid boolean literal.`,
        sourceId: entry.sourceId,
        term: subject.value,
      })
      continue
    }
    const target = classes.get(subject.value) ?? properties.get(subject.value)
    if (target) {
      target.deprecated = deprecated
      continue
    }
    assertions.push(toAssertion(entry.quad, entry.sourceId))
    diagnostics.push({
      code: 'unclassified-deprecation',
      message: `Deprecation metadata retained for unclassified ontology term ${subject.value}.`,
      sourceId: entry.sourceId,
      term: subject.value,
    })
  }
}

/** Returns or creates the mutable accumulator for one named ontology class. */
function getClass(values: Map<string, MutableClassType>, iri: string): MutableClassType {
  let value = values.get(iri)
  if (!value) {
    value = {
      iri,
      labels: [],
      comments: [],
      superClasses: new Set(),
      equivalentClasses: new Set(),
      disjointClasses: new Set(),
      deprecated: false,
    }
    values.set(iri, value)
  }
  return value
}

/** Returns or creates the mutable accumulator for one named ontology property. */
function getProperty(values: Map<string, MutablePropertyType>, iri: string): MutablePropertyType {
  let value = values.get(iri)
  if (!value) {
    value = {
      iri,
      kinds: new Set(),
      labels: [],
      comments: [],
      domains: new Set(),
      ranges: new Set(),
      superProperties: new Set(),
      equivalentProperties: new Set(),
      inverseOf: new Set(),
      disjointProperties: new Set(),
      characteristics: new Set(),
      deprecated: false,
    }
    values.set(iri, value)
  }
  return value
}

/** Converts a mutable class accumulator into stable sorted serializable ontology output. */
function freezeClass(value: MutableClassType): ClassType {
  return {
    iri: value.iri,
    labels: sortText(value.labels),
    comments: sortText(value.comments),
    superClasses: [...value.superClasses].sort(),
    equivalentClasses: [...value.equivalentClasses].sort(),
    disjointClasses: [...value.disjointClasses].sort(),
    deprecated: value.deprecated,
  }
}

/** Converts a mutable property accumulator into stable sorted serializable ontology output. */
function freezeProperty(value: MutablePropertyType): PropertyType {
  return {
    iri: value.iri,
    kinds: [...value.kinds].sort(),
    labels: sortText(value.labels),
    comments: sortText(value.comments),
    domains: [...value.domains].sort(),
    ranges: [...value.ranges].sort(),
    superProperties: [...value.superProperties].sort(),
    equivalentProperties: [...value.equivalentProperties].sort(),
    inverseOf: [...value.inverseOf].sort(),
    disjointProperties: [...value.disjointProperties].sort(),
    characteristics: [...value.characteristics].sort(),
    deprecated: value.deprecated,
  }
}

/** Converts the supplied value to text without changing semantic identity. */
function toText(value: Literal): TextType {
  const text: {
    /** Literal lexical form preserved for localized ontology text. */
    value: string
    /** BCP 47 language tag retained for this localized RDF value. */
    language?: string
    /** RDF 1.2 base text direction retained for this localized RDF value. */
    direction?: 'ltr' | 'rtl'
  } = { value: value.value }
  if (value.language) text.language = value.language
  if (value.direction) text.direction = value.direction
  return text
}

/** Reads recognized RDF boolean lexical forms without treating arbitrary strings as booleans. */
function booleanLiteral(value: Literal): boolean | undefined {
  if (value.value === 'true' || value.value === '1') return true
  if (value.value === 'false' || value.value === '0') return false
  return undefined
}

/** Converts the supplied value to assertion without changing semantic identity. */
function toAssertion(value: Quad, sourceId: string): AssertionType {
  return {
    sourceId,
    subject: key(value.subject),
    predicate: value.predicate.value,
    object: key(value.object),
    graph: key(value.graph),
  }
}

/** Converts retained RDF assertions to stable string records without carrying runtime term objects. */
function stripQuads(source: OntologySourceType): SourceType {
  const value: {
    /** Stable source identifier retained for this stripped ontology source record. */
    id: string
    /** IRI retained by this value. */
    iri?: string
    /** Version marker retained by this syntax record. */
    version?: string
    /** N-degree hash selected for this canonicalization candidate. */
    hash?: string
  } = { id: source.id }
  if (source.iri !== undefined) value.iri = source.iri
  if (source.version !== undefined) value.version = source.version
  if (source.hash !== undefined) value.hash = source.hash
  return value
}

/** Sorts localized ontology text deterministically for byte-stable downstream generation. */
function sortText(values: readonly TextType[]): TextType[] {
  return [...values].sort((left, right) =>
    `${left.language ?? ''}\u0000${left.direction ?? ''}\u0000${left.value}`.localeCompare(
      `${right.language ?? ''}\u0000${right.direction ?? ''}\u0000${right.value}`,
    )
  )
}

/** Compare assertion using deterministic semantic ordering. */
function compareAssertion(left: AssertionType, right: AssertionType): number {
  return `${left.sourceId}\u0000${left.subject}\u0000${left.predicate}\u0000${left.object}`
    .localeCompare(
      `${right.sourceId}\u0000${right.subject}\u0000${right.predicate}\u0000${right.object}`,
    )
}

/** Compare diagnostic using deterministic semantic ordering. */
function compareDiagnostic(left: DiagnosticType, right: DiagnosticType): number {
  return `${left.sourceId}\u0000${left.code}\u0000${left.term ?? ''}`.localeCompare(
    `${right.sourceId}\u0000${right.code}\u0000${right.term ?? ''}`,
  )
}

/** Orders named ontology resources by IRI so source file order does not affect the model. */
function byIri<
  T extends {
    /** IRI retained by this byIri. */
    readonly iri: string
  },
>(left: T, right: T): number {
  return left.iri.localeCompare(right.iri)
}
