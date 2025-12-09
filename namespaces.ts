/**
 * Semantic Web / RDF namespace constants.
 *
 * This module exposes curated, strongly-typed constants for the most common RDF vocabularies:
 * - {@link XSD}        – XML Schema datatypes used for literals
 * - {@link RDF}        – Core RDF vocabulary
 * - {@link RDFS}       – RDF Schema (classes/properties, labels, comments)
 * - {@link OWL}        – Web Ontology Language (reasoning/ontology concepts)
 * - {@link FOAF}       – Friend of a Friend (people, agents, social graphs)
 * - {@link SCHEMA}     – Schema.org (web, products, content, places, events)
 *
 * Each namespace object:
 * - Has a `_namespace` field with the base IRI (for PREFIX declarations).
 * - Exposes common classes and properties as string constants (full IRIs).
 *
 * These constants are just strings – there is no runtime cost. They exist purely to give
 * you autocomplete and avoid subtle typos in hand-written IRIs.
 *
 * @example Basic usage with a query builder
 * ```ts
 * import { RDF, FOAF, SCHEMA } from './namespaces.ts'
 *
 * const query = select(['?person', '?name', '?email'])
 *   .prefix('foaf', getNamespaceIRI(FOAF))
 *   .prefix('schema', getNamespaceIRI(SCHEMA))
 *   .where(triple('?person', RDF.type, uri(FOAF.Person)))
 *   .where(triple('?person', FOAF.name, '?name'))
 *   .optional(triple('?person', SCHEMA.email, '?email'))
 * ```
 *
 * @example Typed literals with XSD
 * ```ts
 * import { XSD } from './namespaces.ts'
 *
 * // Filter to adults: age > 18 (using xsd:integer semantics)
 * query.filter(v('age').gt(typed('18', XSD.integer)))
 *
 * // Filter by date (using xsd:dateTime semantics)
 * query.filter(v('createdAt').gt(typed('2024-01-01T00:00:00Z', XSD.dateTime)))
 * ```
 */

/**
 * Common shape shared by all namespace objects in this module.
 *
 * You can use this to accept any of the known vocabularies generically.
 */
export interface NamespaceLike {
  /** Base namespace IRI, typically used in PREFIX declarations. */
  readonly _namespace: string;

  /**
   * All other keys are full IRIs for terms in this vocabulary.
   * The concrete namespaces declare their own known properties explicitly;
   * this index signature is mostly here for ergonomic generic helpers.
   */
  readonly [term: string]: string;
}

/**
 * XML Schema Datatypes (XSD) namespace.
 *
 * These IRIs are used to type literals in RDF and SPARQL:
 * `"42"^^xsd:integer`, `"2024-01-01"^^xsd:date`, etc.
 *
 * SPARQL 1.1 has special comparison rules for many of these types
 * (numeric promotion, date/time ordering, boolean logic, etc.).
 *
 * @see https://www.w3.org/TR/xmlschema11-2/
 */
export const XSD = {
  /** Base namespace for all XSD types. */
  _namespace: 'http://www.w3.org/2001/XMLSchema#',

  // Core scalar types (very common in SPARQL)

  /** Free-form Unicode string (default for plain literals). */
  string: 'http://www.w3.org/2001/XMLSchema#string',

  /** Boolean value: `"true"` / `"false"` / `"1"` / `"0"`. */
  boolean: 'http://www.w3.org/2001/XMLSchema#boolean',

  /** Arbitrary-precision integer. */
  integer: 'http://www.w3.org/2001/XMLSchema#integer',

  /** Arbitrary-precision decimal (often used for currency). */
  decimal: 'http://www.w3.org/2001/XMLSchema#decimal',

  /** 32-bit IEEE 754 floating point. */
  float: 'http://www.w3.org/2001/XMLSchema#float',

  /** 64-bit IEEE 754 floating point. */
  double: 'http://www.w3.org/2001/XMLSchema#double',

  // Date / time types

  /** Calendar date without time (YYYY-MM-DD). */
  date: 'http://www.w3.org/2001/XMLSchema#date',

  /** Time without date (hh:mm:ss[.sss][timezone]). */
  time: 'http://www.w3.org/2001/XMLSchema#time',

  /** Date and time (YYYY-MM-DDThh:mm:ss[.sss][timezone]). */
  dateTime: 'http://www.w3.org/2001/XMLSchema#dateTime',

  /**
   * Date and time with required timezone.
   * Used in some RDF vocabularies for more precise timestamps.
   */
  dateTimeStamp: 'http://www.w3.org/2001/XMLSchema#dateTimeStamp',

  /** Duration of time (PnYnMnDTnHnMnS). */
  duration: 'http://www.w3.org/2001/XMLSchema#duration',

  /** Year and month duration (PnYnM). */
  yearMonthDuration: 'http://www.w3.org/2001/XMLSchema#yearMonthDuration',

  /** Day and time duration (PnDTnHnMnS). */
  dayTimeDuration: 'http://www.w3.org/2001/XMLSchema#dayTimeDuration',

  // Integer subtypes (numeric constraints)

  /** 32-bit signed integer (-2^31 to 2^31-1). */
  int: 'http://www.w3.org/2001/XMLSchema#int',

  /** 64-bit signed integer. */
  long: 'http://www.w3.org/2001/XMLSchema#long',

  /** 16-bit signed integer. */
  short: 'http://www.w3.org/2001/XMLSchema#short',

  /** 8-bit signed integer. */
  byte: 'http://www.w3.org/2001/XMLSchema#byte',

  /** Integer ≤ 0. */
  nonPositiveInteger: 'http://www.w3.org/2001/XMLSchema#nonPositiveInteger',

  /** Integer < 0. */
  negativeInteger: 'http://www.w3.org/2001/XMLSchema#negativeInteger',

  /** Integer ≥ 0. */
  nonNegativeInteger: 'http://www.w3.org/2001/XMLSchema#nonNegativeInteger',

  /** Integer > 0. */
  positiveInteger: 'http://www.w3.org/2001/XMLSchema#positiveInteger',

  /** Unsigned 64-bit integer. */
  unsignedLong: 'http://www.w3.org/2001/XMLSchema#unsignedLong',

  /** Unsigned 32-bit integer. */
  unsignedInt: 'http://www.w3.org/2001/XMLSchema#unsignedInt',

  /** Unsigned 16-bit integer. */
  unsignedShort: 'http://www.w3.org/2001/XMLSchema#unsignedShort',

  /** Unsigned 8-bit integer. */
  unsignedByte: 'http://www.w3.org/2001/XMLSchema#unsignedByte',

  // Other commonly used types in RDF land

  /** URI/IRI represented as a string literal. */
  anyURI: 'http://www.w3.org/2001/XMLSchema#anyURI',

  /** RFC 3066 / BCP 47 language tags ("en", "en-GB", ...). */
  language: 'http://www.w3.org/2001/XMLSchema#language',

  /** Whitespace-normalized string. */
  normalizedString: 'http://www.w3.org/2001/XMLSchema#normalizedString',

  /** Tokenized string (no leading/trailing/extra internal spaces). */
  token: 'http://www.w3.org/2001/XMLSchema#token',

  /** Hexadecimal binary data. */
  hexBinary: 'http://www.w3.org/2001/XMLSchema#hexBinary',

  /** Base64-encoded binary data. */
  base64Binary: 'http://www.w3.org/2001/XMLSchema#base64Binary',
} as const satisfies NamespaceLike;

/**
 * RDF namespace – core building blocks of RDF graphs.
 *
 * RDF gives you the minimal vocabulary for describing triples, statements,
 * lists, and some special literal types. SPARQL and most RDF tools assume
 * these IRIs.
 *
 * @see https://www.w3.org/TR/rdf11-concepts/
 */
export const RDF = {
  /** Base namespace. */
  _namespace: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',

  // Core structural terms

  /** The relationship that assigns a class to a resource (A rdf:type B). */
  type: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',

  /** Class of RDF properties. */
  Property: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Property',

  /** Reified statement class (rarely used in modern data, but part of RDF). */
  Statement: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Statement',

  /** Subject of a reified statement. */
  subject: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#subject',

  /** Predicate of a reified statement. */
  predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#predicate',

  /** Object of a reified statement. */
  object: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#object',

  // Containers & lists

  /** First element of an RDF list. */
  first: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first',

  /** Rest of an RDF list (points to another list or rdf:nil). */
  rest: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest',

  /** Marker for the empty RDF list. */
  nil: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil',

  /** Class of RDF lists. */
  List: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#List',

  /** Container type: ordered collection (1, 2, 3, …). */
  Seq: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Seq',

  /** Container type: unordered bag (multi-set). */
  Bag: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Bag',

  /** Container type: alternatives (one of several options). */
  Alt: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Alt',

  // Literal-related datatypes

  /** Special datatype for XML literal content. */
  XMLLiteral: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#XMLLiteral',

  /** Special datatype for language-tagged strings. */
  langString: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString',

  /** Special datatype for HTML literal content. */
  HTML: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#HTML',
} as const satisfies NamespaceLike;

/**
 * RDF Schema (RDFS) – basic schema vocabulary.
 *
 * Use this for:
 * - Human-readable labels and descriptions.
 * - Class hierarchies (`rdfs:subClassOf`).
 * - Property hierarchies (`rdfs:subPropertyOf`).
 * - Domain/range constraints.
 *
 * @see https://www.w3.org/TR/rdf-schema/
 */
export const RDFS = {
  /** Base namespace. */
  _namespace: 'http://www.w3.org/2000/01/rdf-schema#',

  // Annotations

  /** Human-readable name for a resource. */
  label: 'http://www.w3.org/2000/01/rdf-schema#label',

  /** Human-readable description or documentation. */
  comment: 'http://www.w3.org/2000/01/rdf-schema#comment',

  /** See also: link to related resources. */
  seeAlso: 'http://www.w3.org/2000/01/rdf-schema#seeAlso',

  /** Link to the defining resource for this term. */
  isDefinedBy: 'http://www.w3.org/2000/01/rdf-schema#isDefinedBy',

  // Core schema terms

  /** Class of all RDFS classes. */
  Class: 'http://www.w3.org/2000/01/rdf-schema#Class',

  /** Class of all RDF resources that can be named by an IRI. */
  Resource: 'http://www.w3.org/2000/01/rdf-schema#Resource',

  /** Class of literal values (strings, numbers, dates, etc.). */
  Literal: 'http://www.w3.org/2000/01/rdf-schema#Literal',

  /** Class of data types (e.g., xsd:integer, xsd:string). */
  Datatype: 'http://www.w3.org/2000/01/rdf-schema#Datatype',

  /** Class of container membership properties (rdf:_1, rdf:_2, …). */
  ContainerMembershipProperty: 'http://www.w3.org/2000/01/rdf-schema#ContainerMembershipProperty',

  /** Class of containers (rdf:Bag, rdf:Seq, rdf:Alt). */
  Container: 'http://www.w3.org/2000/01/rdf-schema#Container',

  // Hierarchies & constraints

  /** Relates a class to its superclass. */
  subClassOf: 'http://www.w3.org/2000/01/rdf-schema#subClassOf',

  /** Relates a property to a more general super-property. */
  subPropertyOf: 'http://www.w3.org/2000/01/rdf-schema#subPropertyOf',

  /** Domain constraint: types of subjects that can use this property. */
  domain: 'http://www.w3.org/2000/01/rdf-schema#domain',

  /** Range constraint: types of objects this property can have. */
  range: 'http://www.w3.org/2000/01/rdf-schema#range',

  /** Membership relation between containers and their members. */
  member: 'http://www.w3.org/2000/01/rdf-schema#member',
} as const satisfies NamespaceLike;

/**
 * OWL namespace – Web Ontology Language.
 *
 * OWL extends RDFS with richer modeling constructs and is widely used for:
 * - Expressive ontologies.
 * - Reasoning (inference, classification).
 * - Equivalence, disjointness, complex class expressions.
 *
 * @see https://www.w3.org/TR/owl2-overview/
 */
export const OWL = {
  /** Base namespace. */
  _namespace: 'http://www.w3.org/2002/07/owl#',

  // Core classes

  /** Class of OWL ontologies. */
  Ontology: 'http://www.w3.org/2002/07/owl#Ontology',

  /** Root of all individuals (top of the class hierarchy). */
  Thing: 'http://www.w3.org/2002/07/owl#Thing',

  /** Empty class (no individuals). */
  Nothing: 'http://www.w3.org/2002/07/owl#Nothing',

  /** Class of OWL classes. */
  Class: 'http://www.w3.org/2002/07/owl#Class',

  /** Class of object properties (link individuals to individuals). */
  ObjectProperty: 'http://www.w3.org/2002/07/owl#ObjectProperty',

  /** Class of datatype properties (link individuals to literals). */
  DatatypeProperty: 'http://www.w3.org/2002/07/owl#DatatypeProperty',

  /** Class of annotation properties (labels, comments, etc. in OWL). */
  AnnotationProperty: 'http://www.w3.org/2002/07/owl#AnnotationProperty',

  /** Class of ontology properties (describe ontologies themselves). */
  OntologyProperty: 'http://www.w3.org/2002/07/owl#OntologyProperty',

  // Property characteristics

  /** Functional property (at most one value per subject). */
  FunctionalProperty: 'http://www.w3.org/2002/07/owl#FunctionalProperty',

  /** Inverse functional property (inverse is functional). */
  InverseFunctionalProperty: 'http://www.w3.org/2002/07/owl#InverseFunctionalProperty',

  /** Symmetric property (if A relates to B, then B relates to A). */
  SymmetricProperty: 'http://www.w3.org/2002/07/owl#SymmetricProperty',

  /** Asymmetric property (never holds in both directions). */
  AsymmetricProperty: 'http://www.w3.org/2002/07/owl#AsymmetricProperty',

  /** Transitive property (A→B and B→C implies A→C). */
  TransitiveProperty: 'http://www.w3.org/2002/07/owl#TransitiveProperty',

  /** Reflexive property (every individual relates to itself). */
  ReflexiveProperty: 'http://www.w3.org/2002/07/owl#ReflexiveProperty',

  /** Irreflexive property (no individual relates to itself). */
  IrreflexiveProperty: 'http://www.w3.org/2002/07/owl#IrreflexiveProperty',

  // Equivalence & difference

  /** Two resources refer to the same real-world entity. */
  sameAs: 'http://www.w3.org/2002/07/owl#sameAs',

  /** Two classes have exactly the same instances. */
  equivalentClass: 'http://www.w3.org/2002/07/owl#equivalentClass',

  /** Two properties have the same extension. */
  equivalentProperty: 'http://www.w3.org/2002/07/owl#equivalentProperty',

  /** Two individuals are distinct. */
  differentFrom: 'http://www.w3.org/2002/07/owl#differentFrom',

  /** Declares a class disjoint with another (no shared instances). */
  disjointWith: 'http://www.w3.org/2002/07/owl#disjointWith',

  /** Declares a disjoint union of classes. */
  disjointUnionOf: 'http://www.w3.org/2002/07/owl#disjointUnionOf',

  // Class constructors

  /** Union of multiple classes. */
  unionOf: 'http://www.w3.org/2002/07/owl#unionOf',

  /** Intersection of multiple classes. */
  intersectionOf: 'http://www.w3.org/2002/07/owl#intersectionOf',

  /** Complement of a class. */
  complementOf: 'http://www.w3.org/2002/07/owl#complementOf',

  /** Enumerated class (explicit list of individuals). */
  oneOf: 'http://www.w3.org/2002/07/owl#oneOf',

  // Restrictions

  /** Class of property restrictions. */
  Restriction: 'http://www.w3.org/2002/07/owl#Restriction',

  /** Property being restricted. */
  onProperty: 'http://www.w3.org/2002/07/owl#onProperty',

  /** Restricted to values from a given class. */
  allValuesFrom: 'http://www.w3.org/2002/07/owl#allValuesFrom',

  /** Restricted to some values from a given class. */
  someValuesFrom: 'http://www.w3.org/2002/07/owl#someValuesFrom',

  /** Property must have the given value. */
  hasValue: 'http://www.w3.org/2002/07/owl#hasValue',

  /** Exact cardinality restriction. */
  cardinality: 'http://www.w3.org/2002/07/owl#cardinality',

  /** Minimum cardinality restriction. */
  minCardinality: 'http://www.w3.org/2002/07/owl#minCardinality',

  /** Maximum cardinality restriction. */
  maxCardinality: 'http://www.w3.org/2002/07/owl#maxCardinality',
} as const satisfies NamespaceLike;

/**
 * FOAF – Friend of a Friend vocabulary.
 *
 * FOAF is a classic vocabulary for modeling:
 * - People (names, accounts, profiles).
 * - Organizations and groups.
 * - Social relationships (knows, member, etc.).
 *
 * @see http://xmlns.com/foaf/spec/
 */
export const FOAF = {
  /** Base namespace. */
  _namespace: 'http://xmlns.com/foaf/0.1/',

  // Core classes

  /** Generic agent – person, organization, software, etc. */
  Agent: 'http://xmlns.com/foaf/0.1/Agent',

  /** A person. */
  Person: 'http://xmlns.com/foaf/0.1/Person',

  /** An organization. */
  Organization: 'http://xmlns.com/foaf/0.1/Organization',

  /** A group of Agents. */
  Group: 'http://xmlns.com/foaf/0.1/Group',

  /** A document (web page, file, etc.). */
  Document: 'http://xmlns.com/foaf/0.1/Document',

  /** An image (photo, avatar, etc.). */
  Image: 'http://xmlns.com/foaf/0.1/Image',

  /** A project (endeavor, product, etc.). */
  Project: 'http://xmlns.com/foaf/0.1/Project',

  /** An online account. */
  OnlineAccount: 'http://xmlns.com/foaf/0.1/OnlineAccount',

  // Person / agent properties

  /** Name of a thing (often full name). */
  name: 'http://xmlns.com/foaf/0.1/name',

  /** First/given name. */
  givenName: 'http://xmlns.com/foaf/0.1/givenName',

  /** Last/family name. */
  familyName: 'http://xmlns.com/foaf/0.1/familyName',

  /** Personal title (Mr, Ms, Dr, etc.). */
  title: 'http://xmlns.com/foaf/0.1/title',

  /** Nickname or handle. */
  nick: 'http://xmlns.com/foaf/0.1/nick',

  /** Gender (often string values like "male", "female", ...). */
  gender: 'http://xmlns.com/foaf/0.1/gender',

  /** Age in years. */
  age: 'http://xmlns.com/foaf/0.1/age',

  /** Birthday (often interpreted as xsd:date). */
  birthday: 'http://xmlns.com/foaf/0.1/birthday',

  /** Home page of a person or thing. */
  homepage: 'http://xmlns.com/foaf/0.1/homepage',

  /** Weblog / blog of a person or thing. */
  weblog: 'http://xmlns.com/foaf/0.1/weblog',

  /** A generic page about something. */
  page: 'http://xmlns.com/foaf/0.1/page',

  /** Depiction (an image that shows this resource). */
  depiction: 'http://xmlns.com/foaf/0.1/depiction',

  /** Resource that is depicted in an image. */
  depicts: 'http://xmlns.com/foaf/0.1/depicts',

  /** Thumbnail image. */
  thumbnail: 'http://xmlns.com/foaf/0.1/thumbnail',

  /** Image (simpler alias often used instead of depiction). */
  img: 'http://xmlns.com/foaf/0.1/img',

  /** Interest of a person. */
  interest: 'http://xmlns.com/foaf/0.1/interest',

  /** Topic a person is interested in. */
  topic_interest: 'http://xmlns.com/foaf/0.1/topic_interest',

  /** Topic of some document or thing. */
  topic: 'http://xmlns.com/foaf/0.1/topic',

  /** Person's workplace homepage. */
  workplaceHomepage: 'http://xmlns.com/foaf/0.1/workplaceHomepage',

  /** Person's school/university homepage. */
  schoolHomepage: 'http://xmlns.com/foaf/0.1/schoolHomepage',

  /** Address/location relation (broad). */
  based_near: 'http://xmlns.com/foaf/0.1/based_near',

  // Social graph

  /** Social relationship - person knows another person. */
  knows: 'http://xmlns.com/foaf/0.1/knows',

  /** Membership relation: agent is a member of a group. */
  member: 'http://xmlns.com/foaf/0.1/member',

  /** Class of membership relations. */
  membershipClass: 'http://xmlns.com/foaf/0.1/membershipClass',

  // Accounts & identifiers

  /** Email address (usually `mailto:` IRI). */
  mbox: 'http://xmlns.com/foaf/0.1/mbox',

  /** SHA1 hash of an email address (privacy-preserving identifier). */
  mbox_sha1sum: 'http://xmlns.com/foaf/0.1/mbox_sha1sum',

  /** An online account belonging to the agent. */
  account: 'http://xmlns.com/foaf/0.1/account',

  /** Name (username) of an online account. */
  accountName: 'http://xmlns.com/foaf/0.1/accountName',

  /** Service homepage of an online account (e.g., twitter.com). */
  accountServiceHomepage: 'http://xmlns.com/foaf/0.1/accountServiceHomepage',
} as const satisfies NamespaceLike;

/**
 * Schema.org vocabulary – structured data for the web.
 *
 * **Important note:** this module uses `http://schema.org/` IRIs, which are the
 * most widely used and historically canonical forms. If your data uses
 * `https://schema.org/` instead, you should either:
 * - Normalize IRIs when ingesting, or
 * - Provide a schema namespace variant that uses `https://`.
 *
 * This is only a curated subset of Schema.org – enough for many common
 * scenarios (products, organizations, places, events, content).
 *
 * @see http://schema.org/
 */
export const SCHEMA = {
  /** Base namespace (http, not https). */
  _namespace: 'http://schema.org/',

  // Very common generic properties

  /** Name of the thing. */
  name: 'http://schema.org/name',

  /** Description of the thing. */
  description: 'http://schema.org/description',

  /** URL of the thing. */
  url: 'http://schema.org/url',

  /** Link to a representative image. */
  image: 'http://schema.org/image',

  /** Identifier for the thing (could be URI, SKU, etc.). */
  identifier: 'http://schema.org/identifier',

  /** Link to a page that unambiguously indicates the item's identity. */
  sameAs: 'http://schema.org/sameAs',

  // Core types

  /** A person. */
  Person: 'http://schema.org/Person',

  /** An organization. */
  Organization: 'http://schema.org/Organization',

  /** A place (address, geo, etc.). */
  Place: 'http://schema.org/Place',

  /** A postal address. */
  PostalAddress: 'http://schema.org/PostalAddress',

  /** A creative work (article, book, movie, etc.). */
  CreativeWork: 'http://schema.org/CreativeWork',

  /** An article (news, blog post, etc.). */
  Article: 'http://schema.org/Article',

  /** A web page. */
  WebPage: 'http://schema.org/WebPage',

  /** A web site. */
  WebSite: 'http://schema.org/WebSite',

  /** A product. */
  Product: 'http://schema.org/Product',

  /** An offer to sell or lease something. */
  Offer: 'http://schema.org/Offer',

  /** An event (concert, meetup, etc.). */
  Event: 'http://schema.org/Event',

  /** Rating (1–5 stars, etc.). */
  Rating: 'http://schema.org/Rating',

  /** Aggregate rating (average + count). */
  AggregateRating: 'http://schema.org/AggregateRating',

  // Product / offer properties

  /** Price (numeric; often with a currency). */
  price: 'http://schema.org/price',

  /** Price currency (ISO 4217, e.g., "USD"). */
  priceCurrency: 'http://schema.org/priceCurrency',

  /** Availability status (InStock, OutOfStock, etc.). */
  availability: 'http://schema.org/availability',

  /** Brand associated with the product. */
  brand: 'http://schema.org/brand',

  /** Stock keeping unit (SKU). */
  sku: 'http://schema.org/sku',

  /** Global Trade Item Number (13-digit). */
  gtin13: 'http://schema.org/gtin13',

  /** Global Trade Item Number (various lengths). */
  gtin: 'http://schema.org/gtin',

  /** Link to the offer associated with a product. */
  offers: 'http://schema.org/offers',

  // Person / contact properties

  /** Email address. */
  email: 'http://schema.org/email',

  /** Telephone number. */
  telephone: 'http://schema.org/telephone',

  /** Job title. */
  jobTitle: 'http://schema.org/jobTitle',

  /** Organization a person works for. */
  worksFor: 'http://schema.org/worksFor',

  /** Address of a person or organization. */
  address: 'http://schema.org/address',

  // Address properties

  /** Street address. */
  streetAddress: 'http://schema.org/streetAddress',

  /** City or locality. */
  addressLocality: 'http://schema.org/addressLocality',

  /** Region or state. */
  addressRegion: 'http://schema.org/addressRegion',

  /** Postal code. */
  postalCode: 'http://schema.org/postalCode',

  /** Country (text or ISO code). */
  addressCountry: 'http://schema.org/addressCountry',

  // Organization relationships

  /** Publisher of a creative work. */
  publisher: 'http://schema.org/publisher',

  /** Author of a creative work. */
  author: 'http://schema.org/author',

  /** Parent organization. */
  parentOrganization: 'http://schema.org/parentOrganization',

  /** Sub-organization. */
  subOrganization: 'http://schema.org/subOrganization',

  // Temporal properties

  /** Start date of an event or temporal thing. */
  startDate: 'http://schema.org/startDate',

  /** End date of an event or temporal thing. */
  endDate: 'http://schema.org/endDate',

  /** Publication date. */
  datePublished: 'http://schema.org/datePublished',

  /** Modification date. */
  dateModified: 'http://schema.org/dateModified',
} as const satisfies NamespaceLike;

/**
 * Helper to obtain the base namespace IRI for a vocabulary.
 *
 * This is handy when building PREFIX declarations programmatically.
 *
 * @param ns - Any namespace object exported from this module.
 * @returns The `_namespace` IRI.
 *
 * @example Building PREFIX declarations
 * ```ts
 * import { RDF, RDFS, FOAF, SCHEMA, getNamespaceIRI } from './namespaces.ts'
 *
 * const prefixes = [
 *   ['rdf', getNamespaceIRI(RDF)],
 *   ['rdfs', getNamespaceIRI(RDFS)],
 *   ['foaf', getNamespaceIRI(FOAF)],
 *   ['schema', getNamespaceIRI(SCHEMA)],
 * ]
 *
 * const query = buildQuery()
 *   .prefixes(prefixes)
 *   .where(triple('?person', RDF.type, uri(FOAF.Person)))
 * ```
 */
export function getNamespaceIRI<T extends NamespaceLike>(ns: T): string {
  return ns._namespace;
}
