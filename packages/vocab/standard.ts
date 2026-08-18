/**
 * Dependency-free Standard Schema contracts used by generated vocabularies.
 *
 * The Standard Schema project explicitly permits implementers to copy these
 * structural interfaces. Keeping the contract here avoids adding a runtime
 * dependency only to satisfy TypeScript shape compatibility.
 *
 * This module tracks the v1 Standard Typed, Standard Schema, and Standard JSON
 * Schema contracts. Generated vocabulary schemas implement validation and JSON
 * Schema conversion on the same `~standard` object.
 *
 * @module
 */

/** Base Standard Typed v1 contract shared by the other Standard Schema traits. */
export interface StandardTypedV1<Input = unknown, Output = Input> {
  /** Standard Schema V1 metadata property consumed by compatible schema tooling. */
  readonly '~standard': StandardTypedV1Props<Input, Output>
}

/** Inferred input/output pair carried by Standard Typed metadata. */
export interface StandardTypedTypes<Input = unknown, Output = Input> {
  /** Standard Schema input type metadata or runtime value supplied to conversion. */
  readonly input: Input
  /** Standard Schema output type metadata or conversion result. */
  readonly output: Output
}

/** Base metadata and optional inference types carried by a Standard v1 object. */
export interface StandardTypedV1Props<Input = unknown, Output = Input> {
  /** Standard Typed contract revision implemented by this metadata object. */
  readonly version: 1
  /** Stable vendor identifier required by Standard Typed v1 metadata. */
  readonly vendor: string
  /** Named RDF types or generated type names attached to this record. */
  readonly types?: StandardTypedTypes<Input, Output> | undefined
}

/** Infers the declared input type from any Standard Typed-compatible object. */
export type StandardInferInput<Schema extends StandardTypedV1> = NonNullable<
  Schema['~standard']['types']
>['input']

/** Infers the declared output type from any Standard Typed-compatible object. */
export type StandardInferOutput<Schema extends StandardTypedV1> = NonNullable<
  Schema['~standard']['types']
>['output']

/** Standard Schema v1 validation contract. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  /** Standard Schema V1 metadata property consumed by compatible schema tooling. */
  readonly '~standard': StandardSchemaV1Props<Input, Output>
}

/** One structured segment in a Standard Schema issue path. */
export interface StandardPathSegment {
  /** Property key that identifies one segment in a validation issue path. */
  readonly key: PropertyKey
}

/** One Standard Schema validation issue. */
export interface StandardIssue {
  /** Human-readable explanation of the diagnostic or failure. */
  readonly message: string
  /** Nested input location associated with this issue, from outermost to innermost segment. */
  readonly path?: ReadonlyArray<PropertyKey | StandardPathSegment> | undefined
}

/** Successful Standard Schema validation result. */
export interface StandardSuccessResult<Output> {
  /** Validated output returned by the Standard Schema implementation. */
  readonly value: Output
  /** Validation issues returned by a Standard Schema-compatible validator. */
  readonly issues?: undefined
}

/** Failed Standard Schema validation result. */
export interface StandardFailureResult {
  /** Validation issues returned by a Standard Schema-compatible validator. */
  readonly issues: ReadonlyArray<StandardIssue>
}

/** Success or failure returned by a Standard Schema validator. */
export type StandardResult<Output> = StandardSuccessResult<Output> | StandardFailureResult

/** Optional vendor-specific Standard Schema validation options. */
export interface StandardSchemaOptions {
  /** Standard JSON Schema library options forwarded to a compatible converter. */
  readonly libraryOptions?: Record<string, unknown> | undefined
}

/** Standard Schema v1 validation properties. */
export interface StandardSchemaV1Props<Input = unknown, Output = Input>
  extends StandardTypedV1Props<Input, Output> {
  /** Validates one unknown input and returns the Standard Schema success or failure shape. */
  readonly validate: (
    value: unknown,
    options?: StandardSchemaOptions | undefined,
  ) => StandardResult<Output> | Promise<StandardResult<Output>>
}

/** Standard JSON Schema v1 conversion contract. */
export interface StandardJSONSchemaV1<Input = unknown, Output = Input> {
  /** Standard Schema V1 metadata property consumed by compatible schema tooling. */
  readonly '~standard': StandardJSONSchemaV1Props<Input, Output>
}

/** JSON Schema dialect or integration target requested by a consumer. */
export type JsonSchemaTarget =
  | 'draft-2020-12'
  | 'draft-07'
  | 'openapi-3.0'
  | ({} & string)

/** Options passed by a Standard JSON Schema consumer. */
export interface JsonSchemaOptions {
  /** JSON Schema dialect or integration target requested by the consumer. */
  readonly target: JsonSchemaTarget
  /** Standard JSON Schema library options forwarded to a compatible converter. */
  readonly libraryOptions?: Record<string, unknown> | undefined
}

/** Input/output converter carried by Standard JSON Schema metadata. */
export interface StandardJSONSchemaConverter {
  /** Standard Schema input type metadata or runtime value supplied to conversion. */
  readonly input: (options: JsonSchemaOptions) => Record<string, unknown>
  /** Standard Schema output type metadata or conversion result. */
  readonly output: (options: JsonSchemaOptions) => Record<string, unknown>
}

/** Standard JSON Schema v1 conversion properties. */
export interface StandardJSONSchemaV1Props<Input = unknown, Output = Input>
  extends StandardTypedV1Props<Input, Output> {
  /** Input/output JSON Schema converter required by Standard JSON Schema v1. */
  readonly jsonSchema: StandardJSONSchemaConverter
}
