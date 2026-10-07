/**
 * Generated Schema.org bootstrap vocabulary terms, types, and schemas.
 *
 * This file is generated. Edit the ontology source or generator instead.
 * @module
 */

import { type NamedNode, namedNode } from '@okikio/rdf'
import {
  createSchema,
  type IdReferenceType,
  type NodeType,
  type ValueType,
  type VocabularySchema,
} from '../runtime.ts'

/** Base IRI used by every generated vocabulary term in this module. */
export const namespace = 'https://schema.org/'

/** RDF class terms. */
/**
 * A compact bootstrap class used to validate the generator and direct-import API.
 */
export const Offer: NamedNode = namedNode('https://schema.org/Offer')
/**
 * A compact bootstrap class used to validate the generator and direct-import API.
 */
export const Product: NamedNode = namedNode('https://schema.org/Product')
/**
 * The most generic type of item in this bootstrap vocabulary slice.
 */
export const Thing: NamedNode = namedNode('https://schema.org/Thing')
/**
 * RDF class term for Intangible.
 */
export const Intangible: NamedNode = namedNode('https://schema.org/Intangible')

/** RDF datatype terms. */
/** RDF datatype term for Boolean. */
export const Boolean: NamedNode = namedNode('https://schema.org/Boolean')
/** RDF datatype term for Number. */
export const Number: NamedNode = namedNode('https://schema.org/Number')
/** RDF datatype term for Text. */
export const Text: NamedNode = namedNode('https://schema.org/Text')
/** RDF datatype term for URL. */
export const URL: NamedNode = namedNode('https://schema.org/URL')

/** RDF property terms. */
/**
 * RDF property term for description.
 */
export const description: NamedNode = namedNode('https://schema.org/description')
/**
 * RDF property term for name.
 */
export const name: NamedNode = namedNode('https://schema.org/name')
/**
 * RDF property term for offers.
 */
export const offers: NamedNode = namedNode('https://schema.org/offers')
/**
 * RDF property term for price.
 */
export const price: NamedNode = namedNode('https://schema.org/price')
/**
 * RDF property term for priceCurrency.
 */
export const priceCurrency: NamedNode = namedNode('https://schema.org/priceCurrency')
/**
 * RDF property term for sku.
 */
export const sku: NamedNode = namedNode('https://schema.org/sku')

/** JSON-LD properties directly available to Offer, including inherited interfaces. */
export interface OfferPropertiesType extends IntangiblePropertiesType {
  /**
   * JSON-LD value for price.
   */
  readonly price?: ValueType<number | string>
  /**
   * JSON-LD value for priceCurrency.
   */
  readonly priceCurrency?: ValueType<string>
}

/** JSON-LD properties directly available to Product, including inherited interfaces. */
export interface ProductPropertiesType extends ThingPropertiesType {
  /**
   * JSON-LD value for offers.
   */
  readonly offers?: ValueType<OfferType | IdReferenceType>
  /**
   * JSON-LD value for sku.
   */
  readonly sku?: ValueType<string>
}

/** JSON-LD properties directly available to Thing, including inherited interfaces. */
export interface ThingPropertiesType {
  /**
   * JSON-LD value for description.
   */
  readonly description?: ValueType<string>
  /**
   * JSON-LD value for name.
   */
  readonly name?: ValueType<string>
}

/** JSON-LD properties directly available to Intangible, including inherited interfaces. */
export interface IntangiblePropertiesType extends ThingPropertiesType {
}

/** JSON-LD node typed as Offer. */
export type OfferType = NodeType<'Offer', OfferPropertiesType>
/** Standard Schema validator and JSON Schema converter for Offer. */
export const OfferSchema: VocabularySchema<unknown, OfferType> = createSchema<OfferType>({
  types: ['Offer'],
  parents: () => [IntangibleSchema],
  properties: {
    price: ['number', 'string'],
    priceCurrency: 'string',
  },
})

/** JSON-LD node typed as Product. */
export type ProductType = NodeType<'Product', ProductPropertiesType>
/** Standard Schema validator and JSON Schema converter for Product. */
export const ProductSchema: VocabularySchema<unknown, ProductType> = createSchema<ProductType>({
  types: ['Product'],
  parents: () => [ThingSchema],
  properties: {
    offers: 'node',
    sku: 'string',
  },
})

/** JSON-LD node typed as Thing. */
export type ThingType = NodeType<'Thing', ThingPropertiesType>
/** Standard Schema validator and JSON Schema converter for Thing. */
export const ThingSchema: VocabularySchema<unknown, ThingType> = createSchema<ThingType>({
  types: ['Thing'],
  properties: {
    description: 'string',
    name: 'string',
  },
})

/** JSON-LD node typed as Intangible. */
export type IntangibleType = NodeType<'Intangible', IntangiblePropertiesType>
/** Standard Schema validator and JSON Schema converter for Intangible. */
export const IntangibleSchema: VocabularySchema<unknown, IntangibleType> = createSchema<
  IntangibleType
>({
  types: ['Intangible'],
  parents: () => [ThingSchema],
})

/** Generated datatype value aliases. */
/** JavaScript value type for the Boolean RDF datatype. */
export type BooleanType = boolean
/** JavaScript value type for the Number RDF datatype. */
export type NumberType = number
/** JavaScript value type for the Text RDF datatype. */
export type TextType = string
/** JavaScript value type for the URL RDF datatype. */
export type URLType = string

/** Generated class-name to property-interface map used by multi-typed JSON-LD nodes. */
export interface TypeMapType {
  /** Property interface contributed by Offer nodes. */
  readonly Offer: OfferPropertiesType
  /** Property interface contributed by Product nodes. */
  readonly Product: ProductPropertiesType
  /** Property interface contributed by Thing nodes. */
  readonly Thing: ThingPropertiesType
  /** Property interface contributed by Intangible nodes. */
  readonly Intangible: IntangiblePropertiesType
}

/** Every generated vocabulary class name accepted by multi-type nodes. */
export type ClassNameType = keyof TypeMapType
/** Resolves one generated class name to its property interface. */
export type PropertiesForType<Type extends ClassNameType> = Type extends keyof TypeMapType
  ? TypeMapType[Type]
  : never
/** Converts the selected class-property union into one intersection for multi-typed nodes. */
export type UnionToIntersection<Value> =
  (Value extends unknown ? (value: Value) => void : never) extends
    (value: infer Intersection) => void ? Intersection : never

/** Intersects the properties contributed by every class on a multi-typed JSON-LD node. */
export type MergedPropertiesType<Types extends readonly ClassNameType[]> =
  & UnionToIntersection<PropertiesForType<Types[number]>>
  & object
/** JSON-LD node carrying all properties contributed by the selected generated class names. */
export type MultiTypeType<Types extends readonly ClassNameType[]> = NodeType<
  Types,
  MergedPropertiesType<Types>
>
