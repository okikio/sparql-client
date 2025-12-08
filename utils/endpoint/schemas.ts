// schemas.ts
import type { FormValue, ParsedFormValue } from 'hono/types';
import type { EndpointDefinitionSchemas } from './definitions.ts';
import { z } from 'zod';

/**
 * Zod "string | string[]" union (mirrors Hono's `query` values).
 * Useful for normalizing query params that may be repeated.
 */
export const ZStringOrStringArray = z.union([z.string(), z.array(z.string())]);

/**
 * ### Base JSON Schema
 *
 * - Accepts any JSON-like value.
 * - Tighten per-endpoint with `.refine(...)`, `.transform(...)`, or `.pipe(...)`.
 */
export const BaseJsonSchema = z.any() satisfies NonNullable<EndpointDefinitionSchemas['Json']>;

/**
 * ### Base Form Schema
 *
 * - **Input:** `Record<string, T | T[]>`, where `T` defaults to `ParsedFormValue` (`string | File`).
 * - Uses `z.object({}).catchall(...)` so it remains a **ZodObject** (giving you `.shape` and `.extend(...)`).
 * - Extend per endpoint to restrict keys, change accepted types, or add transforms.
 *
 * @example
 * // Restrict to a specific form key and coerce a file name:
 * const UploadForm = makeBaseFormSchema().extend({
 *   file: z.custom<File>(),
 *   note: z.union([z.string(), z.array(z.string())]).transform(v => Array.isArray(v) ? v[0] ?? '' : v),
 * });
 */
export function makeBaseFormSchema<T extends FormValue = ParsedFormValue>() {
  const value = z.union([z.custom<T>(), z.array(z.custom<T>())]);
  return z.object({}).catchall(value) satisfies NonNullable<EndpointDefinitionSchemas<T>['Form']>;
}

/**
 * @see {@link makeBaseFormSchema}
 */
export const BaseFormSchema = makeBaseFormSchema();

/**
 * ### Base Query Schema
 *
 * - **Input:** `Record<string, string | string[]>`.
 * - Accepts arbitrary keys with `string | string[]` values.
 * - Extend per endpoint with strongly-typed keys and transforms.
 *
 * @example
 * const Query = BaseQuerySchema.extend({
 *   page: z.coerce.number().int().min(1).default(1),
 *   sort: ZStringOrStringArray.transform(v => Array.isArray(v) ? v[0] ?? '' : v),
 * });
 */
export const BaseQuerySchema = z
  .object({})
  .catchall(ZStringOrStringArray) satisfies NonNullable<EndpointDefinitionSchemas['Query']>;

/**
 * ### Base Header Schema (extendable; no transforms)
 *
 * - **Input:** `Record<RequestHeader | CustomHeader, string>`
 * - Kept as a `ZodObject` so you can `.extend(Other.shape)` or spread shapes.
 * - Apply normalization via `makeHeaderSchema(...)` when you’re done composing.
 */
export const BaseHeaderSchema = z
  .object({})
  .catchall(z.string()) satisfies NonNullable<EndpointDefinitionSchemas['Header']>;

/**
 * ### makeHeaderSchema
 *
 * Finalize a header schema by applying the **key-normalization transform** (lowercase keys).
 *
 * - Accepts any **object** schema compatible with the `header` input target
 *   (e.g., `BaseHeaderSchema`, or an extended version of it).
 * - Returns a **piped** schema (`ZodPipe`) whose **output** is `Record<string, string>` with
 *   lowercase keys. This is what you should actually **parse** with at the boundary.
 *
 * @example
 * // 1) Compose while the schema is still a ZodObject
 * const StrictHeader = BaseHeaderSchema.extend({
 *   authorization: z.string().min(1),
 * });
 *
 * // 2) Only at the end, finalize with the transform
 * const Header = makeHeaderSchema(StrictHeader);
 *
 * // Now parse incoming headers
 * const parsed = Header.parse(reqHeaders);
 *
 * @example
 * // If you don't need to customize headers, just:
 * const Header = makeHeaderSchema(); // uses BaseHeaderSchema by default
 */
export function makeHeaderSchema<
  // Infer the Input side from whatever object schema you pass in
  S extends typeof BaseHeaderSchema
>(schema?: S) {
  const base = (schema ?? BaseHeaderSchema) as S;
  // Apply the transform at the very end; result is a ZodPipe (no .shape/.extend)
  return base.transform((rec) => { 
    type K = (keyof typeof rec);
    const out: Record<string, typeof rec[K]> = Object.create(null);
    for (const k in rec) {
      if (typeof k === "string") {
        out[(k as string).toLowerCase()] = rec[k];
      }
    }
    return out;
  });
}

/**
 * ### Base Cookie Schema
 *
 * - **Input:** `Record<string, string>`.
 * - Simple string map; extend per endpoint to constrain or transform specific cookie keys.
 */
export const BaseCookieSchema = z
  .object({})
  .catchall(z.string()) satisfies NonNullable<EndpointDefinitionSchemas['Cookie']>;


/**
 * ### Base Params Schema
 */
export const BaseParamSchema = z
  .object({})
  .catchall(z.string()) satisfies NonNullable<EndpointDefinitionSchemas['Param']>

