/**
 * Generated Schema.org bootstrap vocabulary terms, types, and schemas.
 *
 * This file is generated. Edit the ontology source or generator instead.
 * @module
 */

import { namedNode } from '@okikio/rdf'
import { createSchema, type IdReferenceType, type NodeType, type ValueType } from '../runtime.ts'

/** Base IRI used by every generated vocabulary term in this module. */
export const namespace = 'https://schema.org/'

/** RDF class terms. */
/**
 * A compact bootstrap class used to validate the generator and direct-import API.
 */
export const Offer = namedNode('https://schema.org/Offer')
/**
 * A compact bootstrap class used to validate the generator and direct-import API.
 */
export const Product = namedNode('https://schema.org/Product')
/**
 * The most generic type of item in this bootstrap vocabulary slice.
 */
export const Thing = namedNode('https://schema.org/Thing')
/**
 * RDF class term for Intangible.
 */
export const Intangible = namedNode('https://schema.org/Intangible')

/** RDF datatype terms. */
/** RDF datatype term for Boolean. */
export const Boolean = namedNode('https://schema.org/Boolean')
/** RDF datatype term for Number. */
export const Number = namedNode('https://schema.org/Number')
/** RDF datatype term for Text. */
export const Text = namedNode('https://schema.org/Text')
/** RDF datatype term for URL. */
export const URL = namedNode('https://schema.org/URL')

/** RDF property terms. */
/**
 * RDF property term for description.
 */
export const description = namedNode('https://schema.org/description')
/**
 * RDF property term for name.
 */
export const name = namedNode('https://schema.org/name')
/**
 * RDF property term for offers.
 */
export const offers = namedNode('https://schema.org/offers')
/**
 * RDF property term for price.
 */
export const price = namedNode('https://schema.org/price')
/**
 * RDF property term for priceCurrency.
 */
export const priceCurrency = namedNode('https://schema.org/priceCurrency')
/**
 * RDF property term for sku.
 */
export const sku = namedNode('https://schema.org/sku')

/** JSON-LD properties directly available to Offer, including inherited interfaces. */
export interface OfferPropertiesType extends IntangiblePropertiesType {
  readonly price?: ValueType<number | string>
  readonly priceCurrency?: ValueType<string>
}

/** JSON-LD properties directly available to Product, including inherited interfaces. */
export interface ProductPropertiesType extends ThingPropertiesType {
  readonly offers?: ValueType<OfferType | IdReferenceType>
  readonly sku?: ValueType<string>
}

/** JSON-LD properties directly available to Thing, including inherited interfaces. */
export interface ThingPropertiesType {
  readonly description?: ValueType<string>
  readonly name?: ValueType<string>
}

/** JSON-LD properties directly available to Intangible, including inherited interfaces. */
export interface IntangiblePropertiesType extends ThingPropertiesType {
}

/** JSON-LD node typed as Offer. */
export type OfferType = NodeType<'Offer', OfferPropertiesType>
/** Standard Schema validator and JSON Schema converter for Offer. */
export const OfferSchema = createSchema<OfferType>({
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
export const ProductSchema = createSchema<ProductType>({
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
export const ThingSchema = createSchema<ThingType>({
  types: ['Thing'],
  properties: {
    description: 'string',
    name: 'string',
  },
})

/** JSON-LD node typed as Intangible. */
export type IntangibleType = NodeType<'Intangible', IntangiblePropertiesType>
/** Standard Schema validator and JSON Schema converter for Intangible. */
export const IntangibleSchema = createSchema<IntangibleType>({
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
  readonly Offer: OfferPropertiesType
  readonly Product: ProductPropertiesType
  readonly Thing: ThingPropertiesType
  readonly Intangible: IntangiblePropertiesType
}

/** Every generated vocabulary class name accepted by multi-type nodes. */
export type ClassNameType = keyof TypeMapType
/** Resolves one generated class name to its property interface. */
type PropertiesForType<Type extends ClassNameType> = Type extends keyof TypeMapType ? TypeMapType[Type] : never
/** Converts the selected class-property union into one intersection for multi-typed nodes. */
type UnionToIntersection<Value> = (Value extends unknown ? (value: Value) => void : never) extends (value: infer Intersection) => void ? Intersection : never

/** Intersects the properties contributed by every class on a multi-typed JSON-LD node. */
type MergedPropertiesType<Types extends readonly ClassNameType[]> = UnionToIntersection<PropertiesForType<Types[number]>> & object
/** JSON-LD node carrying all properties contributed by the selected generated class names. */
export type MultiTypeType<Types extends readonly ClassNameType[]> = NodeType<Types, MergedPropertiesType<Types>>
