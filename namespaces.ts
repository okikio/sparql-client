/**
 * Core RDF / SPARQL namespace constants with intent, datatypes, and usage examples.
 *
 * Design goals:
 * - Give you **strongly-typed, auto-complete friendly IRIs** for the vocabularies
 *   most relevant to SPARQL 1.1 / 1.2 and RDF 1.1 / RDF-star.
 * - Focus on **datatypes** and high-value terms from:
 *   - XSD (XML Schema)
 *   - RDF / RDFS
 *   - OWL
 *   - FOAF
 *   - Schema.org
 *   - SPARQL Service Description (SD)
 *   - SHACL
 *   - SKOS
 *   - PROV, VoID, Dublin Core Terms
 *   - WGS84 (`geo:`) and GeoSPARQL (`geosparql:`, `geof:`)
 *   - SPARQL Results vocabulary
 *
 * All namespaces use the `http://` form of the IRI, which is still the most widely
 * deployed and interoperable in RDF/SPARQL systems.
 *
 * These are **just string constants** – zero runtime overhead. They help you avoid
 * subtle typos and keep your query builder readable.
 */

/**
 * Common structural shape shared by all namespace objects.
 *
 * You rarely need this directly; it’s mainly here so helpers like `getNamespaceIRI`
 * can accept any of the exported namespaces.
 */
export interface NamespaceLike {
  /** Base namespace IRI (typically used for PREFIX declarations). */
  readonly _namespace: string;

  /** Every other property is a full IRI for a class, datatype, or property. */
  readonly [term: string]: string;
}

/* ======================================================================= */
/* XSD – XML Schema Datatypes                                              */
/* ======================================================================= */

/**
 * XML Schema Datatypes (XSD) – the backbone of SPARQL literal typing.
 *
 * **Intent**
 * XSD defines scalar types (numbers, dates, strings, URIs, etc.) used to type RDF
 * literals like `"42"^^xsd:int` or `"2024-01-01"^^xsd:date`. SPARQL has explicit
 * comparison and casting rules for these types.
 *
 * **Typical uses**
 * - Creating typed literals in your DSL (e.g. `typed('18', XSD.int)`).
 * - Writing filters that rely on numeric or date semantics.
 * - Defining SHACL constraints or schema ranges for properties.
 *
 * @example Numeric filter
 * ```ts
 * import { XSD } from './namespaces.ts'
 *
 * // ?age > 18 using xsd:int semantics
 * query.filter(v('age').gt(typed('18', XSD.int)))
 * ```
 *
 * @example Date comparison
 * ```ts
 * query.filter(
 *   v('createdAt').gt(typed('2024-01-01T00:00:00Z', XSD.dateTime))
 * )
 * ```
 */
export const XSD = {
  /** Base namespace for all XML Schema datatypes. */
  _namespace: 'http://www.w3.org/2001/XMLSchema#',

  // Core string & language

  /** Free-form Unicode string (default for plain literals). */
  string: 'http://www.w3.org/2001/XMLSchema#string',

  /** Whitespace-normalized string. */
  normalizedString: 'http://www.w3.org/2001/XMLSchema#normalizedString',

  /** Tokenized string (no leading/trailing/extra internal spaces). */
  token: 'http://www.w3.org/2001/XMLSchema#token',

  /** Language tag (e.g. "en", "en-CA"). */
  language: 'http://www.w3.org/2001/XMLSchema#language',

  // Numeric hierarchy

  /** Arbitrary-precision decimal (great for currency/precise amounts). */
  decimal: 'http://www.w3.org/2001/XMLSchema#decimal',

  /** Arbitrary-precision integer. */
  integer: 'http://www.w3.org/2001/XMLSchema#integer',

  /** Integer ≤ 0. */
  nonPositiveInteger: 'http://www.w3.org/2001/XMLSchema#nonPositiveInteger',

  /** Integer < 0. */
  negativeInteger: 'http://www.w3.org/2001/XMLSchema#negativeInteger',

  /** Integer ≥ 0. */
  nonNegativeInteger: 'http://www.w3.org/2001/XMLSchema#nonNegativeInteger',

  /** Integer > 0. */
  positiveInteger: 'http://www.w3.org/2001/XMLSchema#positiveInteger',

  /** 64-bit signed integer. */
  long: 'http://www.w3.org/2001/XMLSchema#long',

  /** 32-bit signed integer. */
  int: 'http://www.w3.org/2001/XMLSchema#int',

  /** 16-bit signed integer. */
  short: 'http://www.w3.org/2001/XMLSchema#short',

  /** 8-bit signed integer. */
  byte: 'http://www.w3.org/2001/XMLSchema#byte',

  /** Unsigned 64-bit integer. */
  unsignedLong: 'http://www.w3.org/2001/XMLSchema#unsignedLong',

  /** Unsigned 32-bit integer. */
  unsignedInt: 'http://www.w3.org/2001/XMLSchema#unsignedInt',

  /** Unsigned 16-bit integer. */
  unsignedShort: 'http://www.w3.org/2001/XMLSchema#unsignedShort',

  /** Unsigned 8-bit integer. */
  unsignedByte: 'http://www.w3.org/2001/XMLSchema#unsignedByte',

  // Floating-point

  /** 32-bit IEEE 754 floating point. */
  float: 'http://www.w3.org/2001/XMLSchema#float',

  /** 64-bit IEEE 754 floating point. */
  double: 'http://www.w3.org/2001/XMLSchema#double',

  // Boolean

  /** Boolean value: "true"/"false"/"1"/"0". */
  boolean: 'http://www.w3.org/2001/XMLSchema#boolean',

  // Date / time

  /** Calendar date without time (YYYY-MM-DD). */
  date: 'http://www.w3.org/2001/XMLSchema#date',

  /** Time without date (hh:mm:ss[.fraction][timezone]). */
  time: 'http://www.w3.org/2001/XMLSchema#time',

  /** Date and time (YYYY-MM-DDThh:mm:ss[.fraction][timezone]). */
  dateTime: 'http://www.w3.org/2001/XMLSchema#dateTime',

  /**
   * Date and time with required timezone.
   * Useful when you need fully-qualified timestamps.
   */
  dateTimeStamp: 'http://www.w3.org/2001/XMLSchema#dateTimeStamp',

  /** Duration of time (PnYnMnDTnHnMnS). */
  duration: 'http://www.w3.org/2001/XMLSchema#duration',

  /** Year and month duration (PnYnM). */
  yearMonthDuration: 'http://www.w3.org/2001/XMLSchema#yearMonthDuration',

  /** Day and time duration (PnDTnHnMnS). */
  dayTimeDuration: 'http://www.w3.org/2001/XMLSchema#dayTimeDuration',

  // Calendar fragments (useful in some vocabularies)

  /** Gregorian year (YYYY). */
  gYear: 'http://www.w3.org/2001/XMLSchema#gYear',

  /** Gregorian year-month (YYYY-MM). */
  gYearMonth: 'http://www.w3.org/2001/XMLSchema#gYearMonth',

  /** Gregorian month (--MM). */
  gMonth: 'http://www.w3.org/2001/XMLSchema#gMonth',

  /** Gregorian month-day (--MM-DD). */
  gMonthDay: 'http://www.w3.org/2001/XMLSchema#gMonthDay',

  /** Gregorian day of month (---DD). */
  gDay: 'http://www.w3.org/2001/XMLSchema#gDay',

  // Binary & misc

  /** Any type – root of the type hierarchy. */
  anyType: 'http://www.w3.org/2001/XMLSchema#anyType',

  /** URI/IRI represented as a string literal. */
  anyURI: 'http://www.w3.org/2001/XMLSchema#anyURI',

  /** Base64-encoded binary data. */
  base64Binary: 'http://www.w3.org/2001/XMLSchema#base64Binary',

  /** Hex-encoded binary data. */
  hexBinary: 'http://www.w3.org/2001/XMLSchema#hexBinary',

  /** Qualified name (prefix:local form). */
  QName: 'http://www.w3.org/2001/XMLSchema#QName',

  /** NOTATION type (legacy XML feature, rarely used in RDF). */
  NOTATION: 'http://www.w3.org/2001/XMLSchema#NOTATION',
} as const satisfies NamespaceLike;

/* ======================================================================= */
/* RDF – Core RDF vocabulary                                               */
/* ======================================================================= */

/**
 * RDF – Core RDF vocabulary.
 *
 * **Intent**
 * RDF defines the basic building blocks of RDF graphs: statements, lists,
 * containers, and special literal datatypes.
 *
 * **Typical uses**
 * - Using `RDF.type` to declare class membership.
 * - Working with RDF lists via `RDF.first`, `RDF.rest`, `RDF.nil`.
 * - Handling RDF-specific literal types like `RDF.HTML` or `RDF.JSON`.
 *
 * @example Declaring types
 * ```ts
 * import { RDF, RDFS } from './namespaces.ts'
 *
 * where(triple('?c', RDF.type, RDFS.Class))
 * ```
 *
 * @example RDF list traversal
 * ```ts
 * select(['?item'])
 *   .where(triple('?list', RDF.first, '?item'))
 *   .where(triple('?list', RDF.rest, RDF.nil))
 * ```
 */
export const RDF = {
  _namespace: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',

  /** Assigns a class to a resource: `?s rdf:type ?class`. */
  type: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',

  /** Class of RDF properties. */
  Property: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Property',

  /** Reified statement (rarely used in modern data). */
  Statement: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Statement',

  /** Subject of a reified statement. */
  subject: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#subject',

  /** Predicate of a reified statement. */
  predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#predicate',

  /** Object of a reified statement. */
  object: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#object',

  /** Generic value property (used in some vocabularies). */
  value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#value',

  // Collections & containers

  /** Class of RDF lists. */
  List: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#List',

  /** Ordered container. */
  Seq: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Seq',

  /** Unordered bag (multiset). */
  Bag: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Bag',

  /** Container of alternatives. */
  Alt: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Alt',

  /** First element in an RDF list. */
  first: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first',

  /** Rest of an RDF list (another list or rdf:nil). */
  rest: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest',

  /** Marker for the empty RDF list. */
  nil: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil',

  // Literal datatypes

  /** XML literal datatype. */
  XMLLiteral: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#XMLLiteral',

  /** HTML literal datatype. */
  HTML: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#HTML',

  /** JSON literal datatype (RDF 1.1+ extension). */
  JSON: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#JSON',

  /** Language-tagged string datatype. */
  langString: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString',

  /** Directional language-tagged string datatype. */
  dirLangString: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString',
} as const satisfies NamespaceLike;

/* ======================================================================= */
/* RDFS – RDF Schema                                                       */
/* ======================================================================= */

/**
 * RDFS – RDF Schema.
 *
 * **Intent**
 * RDFS gives you minimal schema language for RDF:
 * - Class hierarchies (`rdfs:subClassOf`)
 * - Property hierarchies (`rdfs:subPropertyOf`)
 * - Domain and range constraints
 * - Human-readable labels and comments
 *
 * **Typical uses**
 * - Attaching human-friendly labels to resources.
 * - Expressing lightweight type hierarchies.
 * - Building small ontologies without full OWL.
 *
 * @example Labels for display
 * ```ts
 * import { RDF, RDFS } from './namespaces.ts'
 *
 * select(['?resource', '?label'])
 *   .where(triple('?resource', RDF.type, RDFS.Class))
 *   .where(triple('?resource', RDFS.label, '?label'))
 * ```
 *
 * @example Discovering subclasses
 * ```ts
 * select(['?sub'])
 *   .where(triple('?sub', RDFS.subClassOf, 'narrative:Product'))
 * ```
 */
export const RDFS = {
  _namespace: 'http://www.w3.org/2000/01/rdf-schema#',

  /** Human-readable label. */
  label: 'http://www.w3.org/2000/01/rdf-schema#label',

  /** Human-readable description / documentation. */
  comment: 'http://www.w3.org/2000/01/rdf-schema#comment',

  /** Link to related resources. */
  seeAlso: 'http://www.w3.org/2000/01/rdf-schema#seeAlso',

  /** Link to the defining resource of a term. */
  isDefinedBy: 'http://www.w3.org/2000/01/rdf-schema#isDefinedBy',

  /** Class of all RDFS classes. */
  Class: 'http://www.w3.org/2000/01/rdf-schema#Class',

  /** Class of all resources that can be named. */
  Resource: 'http://www.w3.org/2000/01/rdf-schema#Resource',

  /** Class of literal values. */
  Literal: 'http://www.w3.org/2000/01/rdf-schema#Literal',

  /** Class of datatypes. */
  Datatype: 'http://www.w3.org/2000/01/rdf-schema#Datatype',

  /** Class of containers (rdf:Bag, rdf:Seq, rdf:Alt). */
  Container: 'http://www.w3.org/2000/01/rdf-schema#Container',

  /** Class of container membership properties (rdf:_1, rdf:_2, …). */
  ContainerMembershipProperty:
    'http://www.w3.org/2000/01/rdf-schema#ContainerMembershipProperty',

  /** Relates a class to its superclass. */
  subClassOf: 'http://www.w3.org/2000/01/rdf-schema#subClassOf',

  /** Relates a property to its super-property. */
  subPropertyOf: 'http://www.w3.org/2000/01/rdf-schema#subPropertyOf',

  /** Domain constraint for a property. */
  domain: 'http://www.w3.org/2000/01/rdf-schema#domain',

  /** Range constraint for a property. */
  range: 'http://www.w3.org/2000/01/rdf-schema#range',

  /** Membership relation between containers and members. */
  member: 'http://www.w3.org/2000/01/rdf-schema#member',
} as const satisfies NamespaceLike;

/* ======================================================================= */
/* OWL – Web Ontology Language                                             */
/* ======================================================================= */

/**
 * OWL – Web Ontology Language (OWL 2 core).
 *
 * **Intent**
 * OWL lets you define more expressive ontologies than RDFS:
 * - Equivalence and disjointness between classes and properties.
 * - Property characteristics (functional, inverse functional, symmetric, etc.).
 * - Complex class expressions (restrictions, intersections, unions).
 *
 * **Typical uses**
 * - Reasoner-backed knowledge graphs.
 * - Entity resolution (owl:sameAs).
 * - Complex domain models and validation.
 *
 * @example sameAs for entity resolution
 * ```ts
 * import { OWL } from './namespaces.ts'
 *
 * where(triple('?comic', OWL.sameAs, '?externalComic'))
 * ```
 */
export const OWL = {
  _namespace: 'http://www.w3.org/2002/07/owl#',

  // Core classes

  /** An ontology (document-level resource). */
  Ontology: 'http://www.w3.org/2002/07/owl#Ontology',

  /** Class of OWL classes. */
  Class: 'http://www.w3.org/2002/07/owl#Class',

  /** Top of the class hierarchy (everything is an owl:Thing). */
  Thing: 'http://www.w3.org/2002/07/owl#Thing',

  /** Bottom of the class hierarchy (no instances). */
  Nothing: 'http://www.w3.org/2002/07/owl#Nothing',

  // Properties

  /** Object property (links individuals to individuals). */
  ObjectProperty: 'http://www.w3.org/2002/07/owl#ObjectProperty',

  /** Datatype property (links individuals to literals). */
  DatatypeProperty: 'http://www.w3.org/2002/07/owl#DatatypeProperty',

  /** Annotation property (labels, comments, etc.). */
  AnnotationProperty: 'http://www.w3.org/2002/07/owl#AnnotationProperty',

  /** Functional property (at most one value). */
  FunctionalProperty: 'http://www.w3.org/2002/07/owl#FunctionalProperty',

  /** Inverse functional property (inverse has at most one value). */
  InverseFunctionalProperty:
    'http://www.w3.org/2002/07/owl#InverseFunctionalProperty',

  /** Symmetric property (A R B ⇒ B R A). */
  SymmetricProperty: 'http://www.w3.org/2002/07/owl#SymmetricProperty',

  /** Transitive property (A R B ∧ B R C ⇒ A R C). */
  TransitiveProperty: 'http://www.w3.org/2002/07/owl#TransitiveProperty',

  /** Asymmetric property. */
  AsymmetricProperty: 'http://www.w3.org/2002/07/owl#AsymmetricProperty',

  /** Reflexive property (every individual relates to itself). */
  ReflexiveProperty: 'http://www.w3.org/2002/07/owl#ReflexiveProperty',

  /** Irreflexive property (no individual relates to itself). */
  IrreflexiveProperty: 'http://www.w3.org/2002/07/owl#IrreflexiveProperty',

  /** Declares two properties as inverses. */
  inverseOf: 'http://www.w3.org/2002/07/owl#inverseOf',

  // Equivalence & disjointness

  /** Two resources refer to the same real-world entity. */
  sameAs: 'http://www.w3.org/2002/07/owl#sameAs',

  /** Two individuals are explicitly different. */
  differentFrom: 'http://www.w3.org/2002/07/owl#differentFrom',

  /** Classes with identical instances. */
  equivalentClass: 'http://www.w3.org/2002/07/owl#equivalentClass',

  /** Properties with identical extension. */
  equivalentProperty:
    'http://www.w3.org/2002/07/owl#equivalentProperty',

  /** Disjoint classes (no shared instances). */
  disjointWith: 'http://www.w3.org/2002/07/owl#disjointWith',

  // Class constructors

  /** Class of restrictions. */
  Restriction: 'http://www.w3.org/2002/07/owl#Restriction',

  /** Property being restricted. */
  onProperty: 'http://www.w3.org/2002/07/owl#onProperty',

  /** All values must be from this class. */
  allValuesFrom: 'http://www.w3.org/2002/07/owl#allValuesFrom',

  /** At least one value must be from this class. */
  someValuesFrom: 'http://www.w3.org/2002/07/owl#someValuesFrom',

  /** Property must have the given value. */
  hasValue: 'http://www.w3.org/2002/07/owl#hasValue',

  /** Exact cardinality restriction. */
  cardinality: 'http://www.w3.org/2002/07/owl#cardinality',

  /** Minimum cardinality restriction. */
  minCardinality: 'http://www.w3.org/2002/07/owl#minCardinality',

  /** Maximum cardinality restriction. */
  maxCardinality: 'http://www.w3.org/2002/07/owl#maxCardinality',

  /** Intersection of multiple classes. */
  intersectionOf: 'http://www.w3.org/2002/07/owl#intersectionOf',

  /** Union of multiple classes. */
  unionOf: 'http://www.w3.org/2002/07/owl#unionOf',

  /** Complement of a class. */
  complementOf: 'http://www.w3.org/2002/07/owl#complementOf',

  /** Enumeration of individuals forming a class. */
  oneOf: 'http://www.w3.org/2002/07/owl#oneOf',

  // Individuals

  /** Named individual (explicitly named resource). */
  NamedIndividual:
    'http://www.w3.org/2002/07/owl#NamedIndividual',
} as const satisfies NamespaceLike;

/* ======================================================================= */
/* FOAF – Friend of a Friend                                               */
/* ======================================================================= */

/**
 * FOAF – Friend of a Friend.
 *
 * **Intent**
 * FOAF is a classic vocabulary for modeling:
 * - People (names, accounts, profiles)
 * - Organizations and groups
 * - Social relationships (`foaf:knows`)
 *
 * **Typical uses**
 * - Person profiles and social graphs.
 * - Linking users to pages, images, and accounts.
 *
 * @example Basic person query
 * ```ts
 * import { RDF, FOAF } from './namespaces.ts'
 *
 * select(['?name', '?email'])
 *   .where(triple('?person', RDF.type, FOAF.Person))
 *   .where(triple('?person', FOAF.name, '?name'))
 *   .optional(triple('?person', FOAF.mbox, '?email'))
 * ```
 */
export const FOAF = {
  _namespace: 'http://xmlns.com/foaf/0.1/',

  // Core classes

  /** Generic agent (person, organization, software, etc.). */
  Agent: 'http://xmlns.com/foaf/0.1/Agent',

  /** A person. */
  Person: 'http://xmlns.com/foaf/0.1/Person',

  /** An organization. */
  Organization: 'http://xmlns.com/foaf/0.1/Organization',

  /** A group of agents. */
  Group: 'http://xmlns.com/foaf/0.1/Group',

  /** A document (web page, file, etc.). */
  Document: 'http://xmlns.com/foaf/0.1/Document',

  /** An image (photo, avatar, etc.). */
  Image: 'http://xmlns.com/foaf/0.1/Image',

  /** A project. */
  Project: 'http://xmlns.com/foaf/0.1/Project',

  /** An online account. */
  OnlineAccount: 'http://xmlns.com/foaf/0.1/OnlineAccount',

  // Descriptive properties

  /** Name of a person or thing (often full name). */
  name: 'http://xmlns.com/foaf/0.1/name',

  /** Given / first name. */
  givenName: 'http://xmlns.com/foaf/0.1/givenName',

  /** Family / last name. */
  familyName: 'http://xmlns.com/foaf/0.1/familyName',

  /** Nickname or handle. */
  nick: 'http://xmlns.com/foaf/0.1/nick',

  /** Title (Mr, Ms, Dr, etc.). */
  title: 'http://xmlns.com/foaf/0.1/title',

  /** Gender string (not standardized, but commonly used). */
  gender: 'http://xmlns.com/foaf/0.1/gender',

  /** Age in years. */
  age: 'http://xmlns.com/foaf/0.1/age',

  /** Birthday (often xsd:date). */
  birthday: 'http://xmlns.com/foaf/0.1/birthday',

  // Contact & web presence

  /** Email address (usually as mailto: IRI). */
  mbox: 'http://xmlns.com/foaf/0.1/mbox',

  /** SHA1 hash of email (privacy-friendly ID). */
  mbox_sha1sum: 'http://xmlns.com/foaf/0.1/mbox_sha1sum',

  /** Phone number. */
  phone: 'http://xmlns.com/foaf/0.1/phone',

  /** Homepage of a person or thing. */
  homepage: 'http://xmlns.com/foaf/0.1/homepage',

  /** Weblog/blog. */
  weblog: 'http://xmlns.com/foaf/0.1/weblog',

  /** Generic page about the thing. */
  page: 'http://xmlns.com/foaf/0.1/page',

  // Social graph

  /** Person knows another person. */
  knows: 'http://xmlns.com/foaf/0.1/knows',

  /** Membership of a group. */
  member: 'http://xmlns.com/foaf/0.1/member',

  // Images / depictions

  /** An image representing the thing. */
  img: 'http://xmlns.com/foaf/0.1/img',

  /** An image that depicts the resource. */
  depiction: 'http://xmlns.com/foaf/0.1/depiction',

  /** Resource depicted in an image. */
  depicts: 'http://xmlns.com/foaf/0.1/depicts',

  // Accounts

  /** Online account belonging to the agent. */
  account: 'http://xmlns.com/foaf/0.1/account',

  /** Username of an online account. */
  accountName: 'http://xmlns.com/foaf/0.1/accountName',

  /** Service homepage of an online account (e.g., https://twitter.com). */
  accountServiceHomepage:
    'http://xmlns.com/foaf/0.1/accountServiceHomepage',
} as const satisfies NamespaceLike;

/* ======================================================================= */
/* Schema.org – curated subset                                            */
/* ======================================================================= */

/**
 * Schema.org – structured data for the web.
 *
 * **Intent**
 * Schema.org is a large vocabulary used for SEO, rich snippets, and web-structured
 * data (products, places, events, articles, organizations, etc.).
 *
 * **Typical uses**
 * - Product catalogs, prices, availability.
 * - Organizations and locations.
 * - Articles, events, and creative works.
 *
 * This is a **curated subset**, not the full Schema.org universe.
 *
 * @example Product query
 * ```ts
 * import { RDF, SCHEMA } from './namespaces.ts'
 *
 * select(['?name', '?price'])
 *   .where(triple('?p', RDF.type, SCHEMA.Product))
 *   .where(triple('?p', SCHEMA.name, '?name'))
 *   .where(triple('?p', SCHEMA.price, '?price'))
 * ```
 */
export const SCHEMA = {
  // Note: schema.org now often uses https:// in docs, but http:// IRIs are widely used.
  _namespace: 'http://schema.org/',

  // Generic properties

  /** Name of the thing. */
  name: 'http://schema.org/name',

  /** An alias for the item. */
  alternateName: 'http://schema.org/alternateName',

  /** Description of the thing. */
  description: 'http://schema.org/description',

  /** URL of the thing. */
  url: 'http://schema.org/url',

  /** Representative image. */
  image: 'http://schema.org/image',

  /** Identifier (could be SKU, ISBN, etc.). */
  identifier: 'http://schema.org/identifier',

  /** Link to an unambiguous reference (e.g. Wikidata). */
  sameAs: 'http://schema.org/sameAs',

  // Types

  /** A person. */
  Person: 'http://schema.org/Person',

  /** An organization. */
  Organization: 'http://schema.org/Organization',

  /** A product. */
  Product: 'http://schema.org/Product',

  /** A place. */
  Place: 'http://schema.org/Place',

  /** An event. */
  Event: 'http://schema.org/Event',

  /** A creative work. */
  CreativeWork: 'http://schema.org/CreativeWork',

  /** An article (blog post, news, etc.). */
  Article: 'http://schema.org/Article',

  /** An offer to sell or lease something. */
  Offer: 'http://schema.org/Offer',

  /** Aggregate offer (min/max prices, etc.). */
  AggregateOffer: 'http://schema.org/AggregateOffer',

  // Product / commerce

  /** Price of an offer or product. */
  price: 'http://schema.org/price',

  /** Price currency (ISO 4217). */
  priceCurrency: 'http://schema.org/priceCurrency',

  /** Availability status (InStock, OutOfStock, etc.). */
  availability: 'http://schema.org/availability',

  /** Stock keeping unit. */
  sku: 'http://schema.org/sku',

  /** Brand associated with the product. */
  brand: 'http://schema.org/brand',

  /** Item condition (e.g., NewCondition). */
  itemCondition: 'http://schema.org/itemCondition',

  /** Offers associated with a product. */
  offers: 'http://schema.org/offers',

  // Ratings & reviews

  /** Aggregate rating node. */
  AggregateRating: 'http://schema.org/AggregateRating',

  /** Property linking a thing to its aggregate rating. */
  aggregateRating: 'http://schema.org/aggregateRating',

  /** Rating value (numeric). */
  ratingValue: 'http://schema.org/ratingValue',

  /** Count of reviews. */
  reviewCount: 'http://schema.org/reviewCount',

  /** Review type. */
  Review: 'http://schema.org/Review',

  /** Property linking a thing to its reviews. */
  review: 'http://schema.org/review',

  // Person / contact

  /** Email address. */
  email: 'http://schema.org/email',

  /** Telephone number. */
  telephone: 'http://schema.org/telephone',

  /** Job title. */
  jobTitle: 'http://schema.org/jobTitle',

  /** Organization a person works for. */
  worksFor: 'http://schema.org/worksFor',

  /** Postal address. */
  address: 'http://schema.org/address',

  // Postal address fields

  /** Postal address type. */
  PostalAddress: 'http://schema.org/PostalAddress',

  /** Street address. */
  streetAddress: 'http://schema.org/streetAddress',

  /** City or locality. */
  addressLocality: 'http://schema.org/addressLocality',

  /** Region or state. */
  addressRegion: 'http://schema.org/addressRegion',

  /** Postal code. */
  postalCode: 'http://schema.org/postalCode',

  /** Country. */
  addressCountry: 'http://schema.org/addressCountry',

  // Authorship / publication

  /** Author of content. */
  author: 'http://schema.org/author',

  /** Creator (alias/related to author). */
  creator: 'http://schema.org/creator',

  /** Publisher of a creative work. */
  publisher: 'http://schema.org/publisher',

  /** Publication date. */
  datePublished: 'http://schema.org/datePublished',

  /** Last modification date. */
  dateModified: 'http://schema.org/dateModified',

  // Events / temporal

  /** Start date/time of an event. */
  startDate: 'http://schema.org/startDate',

  /** End date/time of an event. */
  endDate: 'http://schema.org/endDate',

  /** Location of an event or organization. */
  location: 'http://schema.org/location',
} as const satisfies NamespaceLike;

/* ======================================================================= */
/* SD – SPARQL Service Description                                         */
/* ======================================================================= */

/**
 * SD – SPARQL Service Description vocabulary.
 *
 * **Intent**
 * This vocabulary describes SPARQL endpoints and their capabilities, usually
 * exposed at the service URL as RDF. It tells you:
 * - What datasets and graphs exist.
 * - Which features, result formats, and languages are supported.
 *
 * **Typical uses**
 * - Inspecting an endpoint’s capabilities before deciding which features to use.
 */
export const SD = {
  _namespace: 'http://www.w3.org/ns/sparql-service-description#',

  Service: 'http://www.w3.org/ns/sparql-service-description#Service',
  Dataset: 'http://www.w3.org/ns/sparql-service-description#Dataset',
  Graph: 'http://www.w3.org/ns/sparql-service-description#Graph',

  endpoint: 'http://www.w3.org/ns/sparql-service-description#endpoint',
  url: 'http://www.w3.org/ns/sparql-service-description#url',

  defaultDataset:
    'http://www.w3.org/ns/sparql-service-description#defaultDataset',
  namedGraph:
    'http://www.w3.org/ns/sparql-service-description#namedGraph',
  name: 'http://www.w3.org/ns/sparql-service-description#name',
  graph: 'http://www.w3.org/ns/sparql-service-description#graph',

  feature: 'http://www.w3.org/ns/sparql-service-description#feature',
  supportedLanguage:
    'http://www.w3.org/ns/sparql-service-description#supportedLanguage',
  languageExtension:
    'http://www.w3.org/ns/sparql-service-description#languageExtension',

  defaultEntailmentRegime:
    'http://www.w3.org/ns/sparql-service-description#defaultEntailmentRegime',
  entailmentRegime:
    'http://www.w3.org/ns/sparql-service-description#entailmentRegime',

  extensionFunction:
    'http://www.w3.org/ns/sparql-service-description#extensionFunction',
  extensionAggregate:
    'http://www.w3.org/ns/sparql-service-description#extensionAggregate',

  resultFormat:
    'http://www.w3.org/ns/sparql-service-description#resultFormat',
} as const satisfies NamespaceLike;

/* ======================================================================= */
/* SHACL – Shapes Constraint Language                                      */
/* ======================================================================= */

/**
 * SHACL – Shapes Constraint Language.
 *
 * **Intent**
 * SHACL lets you define validation rules ("shapes") for RDF graphs:
 * - Cardinality constraints (`sh:minCount`, `sh:maxCount`)
 * - Datatype and class constraints
 * - Complex logical combinations of constraints
 *
 * **Typical uses**
 * - Validating datasets before loading them into a KG.
 * - Encoding business rules and invariants in RDF form.
 */
export const SHACL = {
  _namespace: 'http://www.w3.org/ns/shacl#',

  // Core classes
  Shape: 'http://www.w3.org/ns/shacl#Shape',
  NodeShape: 'http://www.w3.org/ns/shacl#NodeShape',
  PropertyShape: 'http://www.w3.org/ns/shacl#PropertyShape',

  // Targeting
  targetClass: 'http://www.w3.org/ns/shacl#targetClass',
  targetNode: 'http://www.w3.org/ns/shacl#targetNode',
  targetSubjectsOf: 'http://www.w3.org/ns/shacl#targetSubjectsOf',
  targetObjectsOf: 'http://www.w3.org/ns/shacl#targetObjectsOf',

  // Structure
  path: 'http://www.w3.org/ns/shacl#path',
  property: 'http://www.w3.org/ns/shacl#property',
  node: 'http://www.w3.org/ns/shacl#node',
  class: 'http://www.w3.org/ns/shacl#class',
  datatype: 'http://www.w3.org/ns/shacl#datatype',
  nodeKind: 'http://www.w3.org/ns/shacl#nodeKind',

  // Cardinality
  minCount: 'http://www.w3.org/ns/shacl#minCount',
  maxCount: 'http://www.w3.org/ns/shacl#maxCount',

  // Value ranges
  minInclusive: 'http://www.w3.org/ns/shacl#minInclusive',
  maxInclusive: 'http://www.w3.org/ns/shacl#maxInclusive',
  minExclusive: 'http://www.w3.org/ns/shacl#minExclusive',
  maxExclusive: 'http://www.w3.org/ns/shacl#maxExclusive',

  // Patterns and enumeration
  pattern: 'http://www.w3.org/ns/shacl#pattern',
  flags: 'http://www.w3.org/ns/shacl#flags',
  in: 'http://www.w3.org/ns/shacl#in',
  hasValue: 'http://www.w3.org/ns/shacl#hasValue',

  // Logical combinations
  and: 'http://www.w3.org/ns/shacl#and',
  or: 'http://www.w3.org/ns/shacl#or',
  not: 'http://www.w3.org/ns/shacl#not',
  xone: 'http://www.w3.org/ns/shacl#xone',

  // Qualified value shapes
  qualifiedValueShape:
    'http://www.w3.org/ns/shacl#qualifiedValueShape',
  qualifiedMinCount:
    'http://www.w3.org/ns/shacl#qualifiedMinCount',
  qualifiedMaxCount:
    'http://www.w3.org/ns/shacl#qualifiedMaxCount',

  // Closed shapes
  closed: 'http://www.w3.org/ns/shacl#closed',
  ignoredProperties:
    'http://www.w3.org/ns/shacl#ignoredProperties',

  // Validation results
  ValidationReport:
    'http://www.w3.org/ns/shacl#ValidationReport',
  ValidationResult:
    'http://www.w3.org/ns/shacl#ValidationResult',
  conforms: 'http://www.w3.org/ns/shacl#conforms',
  result: 'http://www.w3.org/ns/shacl#result',
  focusNode: 'http://www.w3.org/ns/shacl#focusNode',
  resultPath: 'http://www.w3.org/ns/shacl#resultPath',
  value: 'http://www.w3.org/ns/shacl#value',
  resultMessage:
    'http://www.w3.org/ns/shacl#resultMessage',
  resultSeverity:
    'http://www.w3.org/ns/shacl#resultSeverity',
} as const satisfies NamespaceLike;

/* ======================================================================= */
/* SKOS – Simple Knowledge Organization System                             */
/* ======================================================================= */

/**
 * SKOS – Simple Knowledge Organization System.
 *
 * **Intent**
 * SKOS is used for thesauri, taxonomies, classification schemes, and controlled
 * vocabularies (concepts, labels, broader/narrower relations).
 *
 * **Typical uses**
 * - Modeling genres, subject headings, tag vocabularies.
 * - Multi-level classification systems for products, story arcs, etc.
 */
export const SKOS = {
  _namespace: 'http://www.w3.org/2004/02/skos/core#',

  // Core classes
  Concept: 'http://www.w3.org/2004/02/skos/core#Concept',
  ConceptScheme:
    'http://www.w3.org/2004/02/skos/core#ConceptScheme',
  Collection: 'http://www.w3.org/2004/02/skos/core#Collection',
  OrderedCollection:
    'http://www.w3.org/2004/02/skos/core#OrderedCollection',

  // Labelling
  prefLabel: 'http://www.w3.org/2004/02/skos/core#prefLabel',
  altLabel: 'http://www.w3.org/2004/02/skos/core#altLabel',
  hiddenLabel:
    'http://www.w3.org/2004/02/skos/core#hiddenLabel',
  notation: 'http://www.w3.org/2004/02/skos/core#notation',

  // Documentation
  note: 'http://www.w3.org/2004/02/skos/core#note',
  definition:
    'http://www.w3.org/2004/02/skos/core#definition',
  scopeNote: 'http://www.w3.org/2004/02/skos/core#scopeNote',
  example: 'http://www.w3.org/2004/02/skos/core#example',

  // Hierarchies
  broader: 'http://www.w3.org/2004/02/skos/core#broader',
  narrower: 'http://www.w3.org/2004/02/skos/core#narrower',
  broaderTransitive:
    'http://www.w3.org/2004/02/skos/core#broaderTransitive',
  narrowerTransitive:
    'http://www.w3.org/2004/02/skos/core#narrowerTransitive',
  related: 'http://www.w3.org/2004/02/skos/core#related',

  // Schemes
  inScheme: 'http://www.w3.org/2004/02/skos/core#inScheme',
  hasTopConcept:
    'http://www.w3.org/2004/02/skos/core#hasTopConcept',
  topConceptOf:
    'http://www.w3.org/2004/02/skos/core#topConceptOf',

  // Collections
  member: 'http://www.w3.org/2004/02/skos/core#member',
  memberList:
    'http://www.w3.org/2004/02/skos/core#memberList',

  // Mappings
  semanticRelation:
    'http://www.w3.org/2004/02/skos/core#semanticRelation',
  mappingRelation:
    'http://www.w3.org/2004/02/skos/core#mappingRelation',
  exactMatch: 'http://www.w3.org/2004/02/skos/core#exactMatch',
  closeMatch: 'http://www.w3.org/2004/02/skos/core#closeMatch',
  broadMatch: 'http://www.w3.org/2004/02/skos/core#broadMatch',
  narrowMatch:
    'http://www.w3.org/2004/02/skos/core#narrowMatch',
  relatedMatch:
    'http://www.w3.org/2004/02/skos/core#relatedMatch',
} as const satisfies NamespaceLike;

/* ======================================================================= */
/* PROV-O – Provenance ontology                                            */
/* ======================================================================= */

/**
 * PROV – W3C Provenance Ontology.
 *
 * **Intent**
 * PROV describes how data was produced:
 * - Which activities generated which entities.
 * - Which agents were responsible.
 * - When those activities happened.
 *
 * **Typical uses**
 * - Tracking data lineage.
 * - Recording who asserted which statements and when.
 */
export const PROV = {
  _namespace: 'http://www.w3.org/ns/prov#',

  // Core classes
  Entity: 'http://www.w3.org/ns/prov#Entity',
  Activity: 'http://www.w3.org/ns/prov#Activity',
  Agent: 'http://www.w3.org/ns/prov#Agent',

  // Core relations
  wasGeneratedBy:
    'http://www.w3.org/ns/prov#wasGeneratedBy',
  used: 'http://www.w3.org/ns/prov#used',
  wasDerivedFrom:
    'http://www.w3.org/ns/prov#wasDerivedFrom',
  wasAttributedTo:
    'http://www.w3.org/ns/prov#wasAttributedTo',
  wasAssociatedWith:
    'http://www.w3.org/ns/prov#wasAssociatedWith',
  actedOnBehalfOf:
    'http://www.w3.org/ns/prov#actedOnBehalfOf',
  wasInformedBy:
    'http://www.w3.org/ns/prov#wasInformedBy',
  wasInfluencedBy:
    'http://www.w3.org/ns/prov#wasInfluencedBy',

  // Qualifiers
  startedAtTime:
    'http://www.w3.org/ns/prov#startedAtTime',
  endedAtTime: 'http://www.w3.org/ns/prov#endedAtTime',
  atLocation: 'http://www.w3.org/ns/prov#atLocation',
  hadPrimarySource:
    'http://www.w3.org/ns/prov#hadPrimarySource',
  specializationOf:
    'http://www.w3.org/ns/prov#specializationOf',
  alternateOf: 'http://www.w3.org/ns/prov#alternateOf',
} as const satisfies NamespaceLike;

/* ======================================================================= */
/* VoID – Vocabulary of Interlinked Datasets                               */
/* ======================================================================= */

/**
 * VoID – Vocabulary of Interlinked Datasets.
 *
 * **Intent**
 * VoID is used to describe dataset-level metadata:
 * - Size, links, partitions, example resources.
 * - SPARQL endpoints and data dumps.
 */
export const VOID = {
  _namespace: 'http://rdfs.org/ns/void#',

  Dataset: 'http://rdfs.org/ns/void#Dataset',
  Linkset: 'http://rdfs.org/ns/void#Linkset',

  subset: 'http://rdfs.org/ns/void#subset',
  target: 'http://rdfs.org/ns/void#target',
  linkPredicate: 'http://rdfs.org/ns/void#linkPredicate',

  triples: 'http://rdfs.org/ns/void#triples',
  distinctSubjects:
    'http://rdfs.org/ns/void#distinctSubjects',
  distinctObjects:
    'http://rdfs.org/ns/void#distinctObjects',

  classPartition:
    'http://rdfs.org/ns/void#classPartition',
  propertyPartition:
    'http://rdfs.org/ns/void#propertyPartition',

  vocabulary: 'http://rdfs.org/ns/void#vocabulary',
  dataDump: 'http://rdfs.org/ns/void#dataDump',
  sparqlEndpoint:
    'http://rdfs.org/ns/void#sparqlEndpoint',
  uriSpace: 'http://rdfs.org/ns/void#uriSpace',
  exampleResource:
    'http://rdfs.org/ns/void#exampleResource',
} as const satisfies NamespaceLike;

/* ======================================================================= */
/* DCTERMS – Dublin Core Terms                                             */
/* ======================================================================= */

/**
 * DCTERMS – Dublin Core Metadata Terms.
 *
 * **Intent**
 * Dublin Core is a generic metadata vocabulary used all over the web
 * and in many RDF datasets for titles, creators, dates, rights, etc.
 */
export const DCTERMS = {
  _namespace: 'http://purl.org/dc/terms/',

  // Core DC elements (terms flavor)
  title: 'http://purl.org/dc/terms/title',
  creator: 'http://purl.org/dc/terms/creator',
  subject: 'http://purl.org/dc/terms/subject',
  description: 'http://purl.org/dc/terms/description',
  publisher: 'http://purl.org/dc/terms/publisher',
  contributor: 'http://purl.org/dc/terms/contributor',
  date: 'http://purl.org/dc/terms/date',
  type: 'http://purl.org/dc/terms/type',
  format: 'http://purl.org/dc/terms/format',
  identifier: 'http://purl.org/dc/terms/identifier',
  source: 'http://purl.org/dc/terms/source',
  language: 'http://purl.org/dc/terms/language',
  relation: 'http://purl.org/dc/terms/relation',
  coverage: 'http://purl.org/dc/terms/coverage',
  rights: 'http://purl.org/dc/terms/rights',

  // Common refinements
  created: 'http://purl.org/dc/terms/created',
  modified: 'http://purl.org/dc/terms/modified',
  issued: 'http://purl.org/dc/terms/issued',
  license: 'http://purl.org/dc/terms/license',
  rightsHolder:
    'http://purl.org/dc/terms/rightsHolder',
  spatial: 'http://purl.org/dc/terms/spatial',
  temporal: 'http://purl.org/dc/terms/temporal',
} as const satisfies NamespaceLike;

/* ======================================================================= */
/* GEO – WGS84 Geo Position                                                */
/* ======================================================================= */

/**
 * GEO – WGS84 basic geo vocabulary.
 *
 * **Intent**
 * Simple latitude/longitude/altitude vocabulary for expressing points
 * on Earth (WGS84).
 */
export const GEO = {
  _namespace: 'http://www.w3.org/2003/01/geo/wgs84_pos#',

  SpatialThing:
    'http://www.w3.org/2003/01/geo/wgs84_pos#SpatialThing',
  Point: 'http://www.w3.org/2003/01/geo/wgs84_pos#Point',

  lat: 'http://www.w3.org/2003/01/geo/wgs84_pos#lat',
  long: 'http://www.w3.org/2003/01/geo/wgs84_pos#long',
  alt: 'http://www.w3.org/2003/01/geo/wgs84_pos#alt',
} as const satisfies NamespaceLike;

/* ======================================================================= */
/* GeoSPARQL – ontology and functions                                      */
/* ======================================================================= */

/**
 * GEOSPARQL – ontology for geospatial data.
 *
 * **Intent**
 * GeoSPARQL defines:
 * - Feature / geometry classes
 * - Datatypes for geometries (WKT, GML)
 * - Topological relations (within, contains, etc.)
 */
export const GEOSPARQL = {
  _namespace: 'http://www.opengis.net/ont/geosparql#',

  // Core classes
  Feature: 'http://www.opengis.net/ont/geosparql#Feature',
  Geometry:
    'http://www.opengis.net/ont/geosparql#Geometry',

  // Feature-geometry relations
  hasGeometry:
    'http://www.opengis.net/ont/geosparql#hasGeometry',
  hasDefaultGeometry:
    'http://www.opengis.net/ont/geosparql#hasDefaultGeometry',

  // Geometry literal datatypes
  wktLiteral:
    'http://www.opengis.net/ont/geosparql#wktLiteral',
  gmlLiteral:
    'http://www.opengis.net/ont/geosparql#gmlLiteral',

  // Common topological relations
  sfWithin:
    'http://www.opengis.net/ont/geosparql#sfWithin',
  sfContains:
    'http://www.opengis.net/ont/geosparql#sfContains',
  sfOverlaps:
    'http://www.opengis.net/ont/geosparql#sfOverlaps',
  sfIntersects:
    'http://www.opengis.net/ont/geosparql#sfIntersects',
} as const satisfies NamespaceLike;

/**
 * GEOF – GeoSPARQL functions namespace.
 *
 * **Intent**
 * Defines IRI identifiers for spatial functions like distance, buffer, etc.,
 * used in SPARQL `FILTER` expressions.
 */
export const GEOF = {
  _namespace: 'http://www.opengis.net/def/function/geosparql/',

  distance:
    'http://www.opengis.net/def/function/geosparql/distance',
  buffer:
    'http://www.opengis.net/def/function/geosparql/buffer',
  envelope:
    'http://www.opengis.net/def/function/geosparql/envelope',
  intersection:
    'http://www.opengis.net/def/function/geosparql/intersection',
  union:
    'http://www.opengis.net/def/function/geosparql/union',
} as const satisfies NamespaceLike;

/* ======================================================================= */
/* SPARQL Results vocabulary                                               */
/* ======================================================================= */

/**
 * SPARQL_RESULTS – SPARQL Results vocabulary.
 *
 * **Intent**
 * Used mostly in RDF encodings of SPARQL result sets (e.g., XML/JSON
 * structured into RDF). You’ll see these IRIs if you round-trip results
 * via RDF form.
 */
export const SPARQL_RESULTS = {
  _namespace: 'http://www.w3.org/2005/sparql-results#',

  ResultSet:
    'http://www.w3.org/2005/sparql-results#ResultSet',
  resultVariable:
    'http://www.w3.org/2005/sparql-results#resultVariable',
  solution:
    'http://www.w3.org/2005/sparql-results#solution',
  binding: 'http://www.w3.org/2005/sparql-results#binding',
  variable:
    'http://www.w3.org/2005/sparql-results#variable',
  value: 'http://www.w3.org/2005/sparql-results#value',
  boolean:
    'http://www.w3.org/2005/sparql-results#boolean',
} as const satisfies NamespaceLike;

/* ======================================================================= */
/* Helper: getNamespaceIRI                                                 */
/* ======================================================================= */

/**
 * Union of all known namespace objects, for convenience.
 */
export type KnownNamespace =
  | typeof XSD
  | typeof RDF
  | typeof RDFS
  | typeof OWL
  | typeof FOAF
  | typeof SCHEMA
  | typeof SD
  | typeof SHACL
  | typeof SKOS
  | typeof PROV
  | typeof VOID
  | typeof DCTERMS
  | typeof GEO
  | typeof GEOSPARQL
  | typeof GEOF
  | typeof SPARQL_RESULTS;

/**
 * Get the base namespace IRI for a given vocabulary object.
 *
 * **Intent**
 * Avoid hardcoding namespace IRIs when building `PREFIX` declarations or
 * when you need to expose vocabulary metadata in your APIs.
 *
 * @example Generate PREFIX declarations
 * ```ts
 * import { RDF, RDFS, SCHEMA, getNamespaceIRI } from './namespaces.ts'
 *
 * const prefixes = [
 *   ['rdf', getNamespaceIRI(RDF)],
 *   ['rdfs', getNamespaceIRI(RDFS)],
 *   ['schema', getNamespaceIRI(SCHEMA)],
 * ]
 *
 * const query = select(['?s'])
 *   .prefixes(prefixes)
 *   .where(triple('?s', RDF.type, SCHEMA.Product))
 * ```
 */
export function getNamespaceIRI(ns: KnownNamespace): string {
  return ns._namespace;
}
