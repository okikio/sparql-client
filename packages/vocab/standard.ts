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
  readonly '~standard': StandardTypedV1Props<Input, Output>
}

/** Inferred input/output pair carried by Standard Typed metadata. */
export interface StandardTypedTypes<Input = unknown, Output = Input> {
  readonly input: Input
  readonly output: Output
}

/** Base metadata and optional inference types carried by a Standard v1 object. */
export interface StandardTypedV1Props<Input = unknown, Output = Input> {
  readonly version: 1
  readonly vendor: string
  readonly types?: StandardTypedTypes<Input, Output> | undefined
}

/** Infers the declared input type from any Standard Typed-compatible object. */
export type StandardInferInput<Schema extends StandardTypedV1> = NonNullable<Schema['~standard']['types']>['input']

/** Infers the declared output type from any Standard Typed-compatible object. */
export type StandardInferOutput<Schema extends StandardTypedV1> = NonNullable<Schema['~standard']['types']>['output']

/** Standard Schema v1 validation contract. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1Props<Input, Output>
}

/** One structured segment in a Standard Schema issue path. */
export interface StandardPathSegment {
  readonly key: PropertyKey
}

/** One Standard Schema validation issue. */
export interface StandardIssue {
  readonly message: string
  readonly path?: ReadonlyArray<PropertyKey | StandardPathSegment> | undefined
}

/** Successful Standard Schema validation result. */
export interface StandardSuccessResult<Output> {
  readonly value: Output
  readonly issues?: undefined
}

/** Failed Standard Schema validation result. */
export interface StandardFailureResult {
  readonly issues: ReadonlyArray<StandardIssue>
}

/** Success or failure returned by a Standard Schema validator. */
export type StandardResult<Output> = StandardSuccessResult<Output> | StandardFailureResult

/** Optional vendor-specific Standard Schema validation options. */
export interface StandardSchemaOptions {
  readonly libraryOptions?: Record<string, unknown> | undefined
}

/** Standard Schema v1 validation properties. */
export interface StandardSchemaV1Props<Input = unknown, Output = Input>
  extends StandardTypedV1Props<Input, Output> {
  readonly validate: (
    value: unknown,
    options?: StandardSchemaOptions | undefined,
  ) => StandardResult<Output> | Promise<StandardResult<Output>>
}

/** Standard JSON Schema v1 conversion contract. */
export interface StandardJSONSchemaV1<Input = unknown, Output = Input> {
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
  readonly target: JsonSchemaTarget
  readonly libraryOptions?: Record<string, unknown> | undefined
}

/** Input/output converter carried by Standard JSON Schema metadata. */
export interface StandardJSONSchemaConverter {
  readonly input: (options: JsonSchemaOptions) => Record<string, unknown>
  readonly output: (options: JsonSchemaOptions) => Record<string, unknown>
}

/** Standard JSON Schema v1 conversion properties. */
export interface StandardJSONSchemaV1Props<Input = unknown, Output = Input>
  extends StandardTypedV1Props<Input, Output> {
  readonly jsonSchema: StandardJSONSchemaConverter
}
