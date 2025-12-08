// utils/response/status-codes.ts
/**
 * HTTP status-code schemas and types.
 *
 * Architecture & Conventions  🗺️
 * ────────────────────────────
 * – Every status-code *category* is expressed first as a **Zod schema**  
 *   (literal-union of numeric codes).  
 * – The **TypeScript type** is inferred via `z.infer<…>` immediately
 *   after the schema.  
 * – Section headers mirror the layout used in **schemas.ts** to keep the
 *   codebase consistent and easy to scan. :contentReference[oaicite:0]{index=0}
 */

import { z } from 'zod'

/* ============================================================================
 * 1×× INFORMATIONAL STATUS CODES
 * ============================================================================
 */

/**
 * Informational (1××) status codes.
 */
export const InfoStatusCodeSchema = z.union([
  z.literal(100),
  z.literal(101),
  z.literal(102),
  z.literal(103),
])
export type InfoStatusCode = z.infer<typeof InfoStatusCodeSchema>

/* ============================================================================
 * 2×× SUCCESS STATUS CODES
 * ============================================================================
 */

/**
 * Successful (2××) status codes.
 */
export const SuccessStatusCodeSchema = z.union([
  z.literal(200),
  z.literal(201),
  z.literal(202),
  z.literal(203),
  z.literal(204),
  z.literal(205),
  z.literal(206),
  z.literal(207),
  z.literal(208),
  z.literal(226),
])
export type SuccessStatusCode = z.infer<typeof SuccessStatusCodeSchema>

/* ============================================================================
 * 3×× REDIRECTION STATUS CODES
 * (includes the historical 305 / 306 for completeness)
 * ============================================================================
 */

/**
 * Deprecated redirection status codes (305 & 306).
 */
export const DeprecatedStatusCodeSchema = z.union([
  z.literal(305),
  z.literal(306),
])
export type DeprecatedStatusCode = z.infer<typeof DeprecatedStatusCodeSchema>

/**
 * Redirection (3××) status codes.
 */
export const RedirectStatusCodeSchema = z.union([
  z.literal(300),
  z.literal(301),
  z.literal(302),
  z.literal(303),
  z.literal(304),
  ...DeprecatedStatusCodeSchema.options,
  z.literal(307),
  z.literal(308),
])
export type RedirectStatusCode = z.infer<typeof RedirectStatusCodeSchema>

/* ============================================================================
 * 4×× CLIENT-ERROR STATUS CODES
 * ============================================================================
 */

/**
 * Client-error (4××) status codes.
 */
export const ClientErrorStatusCodeSchema = z.union([
  z.literal(400),
  z.literal(401),
  z.literal(402),
  z.literal(403),
  z.literal(404),
  z.literal(405),
  z.literal(406),
  z.literal(407),
  z.literal(408),
  z.literal(409),
  z.literal(410),
  z.literal(411),
  z.literal(412),
  z.literal(413),
  z.literal(414),
  z.literal(415),
  z.literal(416),
  z.literal(417),
  z.literal(418),
  z.literal(421),
  z.literal(422),
  z.literal(423),
  z.literal(424),
  z.literal(425),
  z.literal(426),
  z.literal(428),
  z.literal(429),
  z.literal(431),
  z.literal(451),
])
export type ClientErrorStatusCode = z.infer<typeof ClientErrorStatusCodeSchema>

/* ============================================================================
 * 5×× SERVER-ERROR STATUS CODES
 * ============================================================================
 */

/**
 * Server-error (5××) status codes.
 */
export const ServerErrorStatusCodeSchema = z.union([
  z.literal(500),
  z.literal(501),
  z.literal(502),
  z.literal(503),
  z.literal(504),
  z.literal(505),
  z.literal(506),
  z.literal(507),
  z.literal(508),
  z.literal(510),
  z.literal(511),
])
export type ServerErrorStatusCode = z.infer<typeof ServerErrorStatusCodeSchema>

/* ============================================================================
 * SPECIAL / UNOFFICIAL CODES
 * ============================================================================
 */

/**
 * Unofficial / “unknown” status code (-1).
 *
 * @example
 * ```ts
 * return c.text("Unknown Error", -1 as UnofficialStatusCode)
 * ```
 */
export const UnofficialStatusCodeSchema = z.literal(-1)
export type UnofficialStatusCode = z.infer<typeof UnofficialStatusCodeSchema>

/**
 * @deprecated — Use `UnofficialStatusCode` instead.
 */
export type UnOfficalStatusCode = UnofficialStatusCode

/* ============================================================================
 * AGGREGATE STATUS-CODE SCHEMAS
 * ============================================================================
 */

/**
 * Any legal HTTP status code (including unofficial).
 */
export const StatusCodeSchema = z.union([
  InfoStatusCodeSchema,
  SuccessStatusCodeSchema,
  RedirectStatusCodeSchema,
  ClientErrorStatusCodeSchema,
  ServerErrorStatusCodeSchema,
  UnofficialStatusCodeSchema,
])
export type StatusCode = z.infer<typeof StatusCodeSchema>

/**
 * Status codes that MUST NOT include a body in the response.
 * (101 Switching Protocols · 204 No Content · 205 Reset Content · 304 Not Modified)
 */
export const ContentlessStatusCodeSchema = z.union([
  z.literal(101),
  z.literal(204),
  z.literal(205),
  z.literal(304),
])
export type ContentlessStatusCode = z.infer<typeof ContentlessStatusCodeSchema>

/**
 * Status codes that MAY include a body in the response.
 * Defined as *all* legal codes minus the four content-less ones.
 */
export const ContentfulStatusCodeSchema = StatusCodeSchema.refine(
    (code): code is Exclude<StatusCode, ContentlessStatusCode> =>
      !ContentlessStatusCodeSchema.safeParse(code).success,
    { error: 'Contentful status code expected' },
  )
export type ContentfulStatusCode = z.infer<typeof ContentfulStatusCodeSchema>

