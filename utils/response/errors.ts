import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ErrorResponse, ErrorResult, ErrorsResult, ProblemDetails, ProblemDetailsWithErrors, ResponseResult, ValidationErrorDetail } from './schemas.ts'
import { HTTPException } from 'hono/http-exception'

export const BASE_ERROR_URL = 'https://backend.okikio.dev/error'
export const BASE_DOCS_URL = 'https://docs.okikio.dev/errors'

/** Canonical problem type URIs. */
export const ERROR_TYPES = {
	BAD_REQUEST: `${BASE_ERROR_URL}/bad-request`,
	UNAUTHORIZED: `${BASE_ERROR_URL}/unauthorized`,
	FORBIDDEN: `${BASE_ERROR_URL}/forbidden`,
	NOT_FOUND: `${BASE_ERROR_URL}/not-found`,
	METHOD_NOT_ALLOWED: `${BASE_ERROR_URL}/method-not-allowed`,
	NOT_ACCEPTABLE: `${BASE_ERROR_URL}/not-acceptable`,
	REQUEST_TIMEOUT: `${BASE_ERROR_URL}/request-timeout`,
	CONFLICT: `${BASE_ERROR_URL}/conflict`,
	GONE: `${BASE_ERROR_URL}/gone`,
	PRECONDITION_FAILED: `${BASE_ERROR_URL}/precondition-failed`,
	PAYLOAD_TOO_LARGE: `${BASE_ERROR_URL}/payload-too-large`,
	URI_TOO_LONG: `${BASE_ERROR_URL}/uri-too-long`,
	UNSUPPORTED_MEDIA_TYPE: `${BASE_ERROR_URL}/unsupported-media-type`,
	RANGE_NOT_SATISFIABLE: `${BASE_ERROR_URL}/range-not-satisfiable`,
	UNPROCESSABLE_ENTITY: `${BASE_ERROR_URL}/unprocessable-entity`,
	PRECONDITION_REQUIRED: `${BASE_ERROR_URL}/precondition-required`,
	REQUEST_HEADER_FIELDS_TOO_LARGE: `${BASE_ERROR_URL}/request-header-fields-too-large`,
	UNAVAILABLE_FOR_LEGAL_REASONS: `${BASE_ERROR_URL}/unavailable-for-legal-reasons`,
	VALIDATION_ERROR: `${BASE_ERROR_URL}/validation-error`,
	RATE_LIMIT_EXCEEDED: `${BASE_ERROR_URL}/rate-limit-exceeded`,
	INTERNAL_SERVER_ERROR: `${BASE_ERROR_URL}/internal-server-error`,
	NOT_IMPLEMENTED: `${BASE_ERROR_URL}/not-implemented`,
	BAD_GATEWAY: `${BASE_ERROR_URL}/bad-gateway`,
	SERVICE_UNAVAILABLE: `${BASE_ERROR_URL}/service-unavailable`,
	GATEWAY_TIMEOUT: `${BASE_ERROR_URL}/gateway-timeout`,
} as const

/** Canonical docs links for each problem type. */
export const ERROR_DOCS = {
	BAD_REQUEST: `${BASE_DOCS_URL}/bad-request`,
	UNAUTHORIZED: `${BASE_DOCS_URL}/unauthorized`,
	FORBIDDEN: `${BASE_DOCS_URL}/forbidden`,
	NOT_FOUND: `${BASE_DOCS_URL}/not-found`,
	METHOD_NOT_ALLOWED: `${BASE_DOCS_URL}/method-not-allowed`,
	NOT_ACCEPTABLE: `${BASE_DOCS_URL}/not-acceptable`,
	REQUEST_TIMEOUT: `${BASE_DOCS_URL}/request-timeout`,
	CONFLICT: `${BASE_DOCS_URL}/conflict`,
	GONE: `${BASE_DOCS_URL}/gone`,
	PRECONDITION_FAILED: `${BASE_DOCS_URL}/precondition-failed`,
	PAYLOAD_TOO_LARGE: `${BASE_DOCS_URL}/payload-too-large`,
	URI_TOO_LONG: `${BASE_DOCS_URL}/uri-too-long`,
	UNSUPPORTED_MEDIA_TYPE: `${BASE_DOCS_URL}/unsupported-media-type`,
	RANGE_NOT_SATISFIABLE: `${BASE_DOCS_URL}/range-not-satisfiable`,
	UNPROCESSABLE_ENTITY: `${BASE_DOCS_URL}/unprocessable-entity`,
	PRECONDITION_REQUIRED: `${BASE_DOCS_URL}/precondition-required`,
	REQUEST_HEADER_FIELDS_TOO_LARGE: `${BASE_DOCS_URL}/request-header-fields-too-large`,
	UNAVAILABLE_FOR_LEGAL_REASONS: `${BASE_DOCS_URL}/unavailable-for-legal-reasons`,
	VALIDATION_ERROR: `${BASE_DOCS_URL}/validation-error`,
	RATE_LIMIT_EXCEEDED: `${BASE_DOCS_URL}/rate-limit-exceeded`,
	INTERNAL_SERVER_ERROR: `${BASE_DOCS_URL}/internal-server-error`,
	NOT_IMPLEMENTED: `${BASE_DOCS_URL}/not-implemented`,
	BAD_GATEWAY: `${BASE_DOCS_URL}/bad-gateway`,
	SERVICE_UNAVAILABLE: `${BASE_DOCS_URL}/service-unavailable`,
	GATEWAY_TIMEOUT: `${BASE_DOCS_URL}/gateway-timeout`,
} as const

/** Canonical human-readable titles by status. */
export const STATUS_TITLES: Readonly<Record<number, string>> = {
	200: 'OK',
	201: 'Created',
	202: 'Accepted',
	204: 'No Content',
	400: 'Bad Request',
	401: 'Unauthorized',
	403: 'Forbidden',
	404: 'Not Found',
	405: 'Method Not Allowed',
	406: 'Not Acceptable',
	408: 'Request Timeout',
	409: 'Conflict',
	410: 'Gone',
	412: 'Precondition Failed',
	413: 'Payload Too Large',
	414: 'URI Too Long',
	415: 'Unsupported Media Type',
	416: 'Range Not Satisfiable',
	422: 'Unprocessable Entity',
	428: 'Precondition Required',
	429: 'Too Many Requests',
	431: 'Request Header Fields Too Large',
	451: 'Unavailable For Legal Reasons',
	500: 'Internal Server Error',
	501: 'Not Implemented',
	502: 'Bad Gateway',
	503: 'Service Unavailable',
	504: 'Gateway Timeout',
}

export function titleFor(status: number): string {
	return STATUS_TITLES[status] ?? 'Error'
}

// ============================================================================
// Status → convenience factory name map (symbolic)
// ============================================================================

export const STATUS_TO_FUNCTION_MAP = {
	400: 'badRequest',
	401: 'unauthorized',
	403: 'forbidden',
	404: 'notFound',
	405: 'methodNotAllowed',
	406: 'notAcceptable',
	408: 'requestTimeout',
	409: 'conflict',
	410: 'gone',
	412: 'preconditionFailed',
	413: 'payloadTooLarge',
	414: 'uriTooLong',
	415: 'unsupportedMediaType',
	416: 'rangeNotSatisfiable',
	422: 'unprocessableEntity',
	428: 'preconditionRequired',
	429: 'rateLimitExceeded',
	431: 'requestHeaderFieldsTooLarge',
	451: 'unavailableForLegalReasons',
	500: 'internalServerError',
	501: 'notImplemented',
	502: 'badGateway',
	503: 'serviceUnavailable',
	504: 'gatewayTimeout',
} as const

export type KnownErrorStatus = keyof typeof STATUS_TO_FUNCTION_MAP

// ============================================================================
// Extensions (intent-forward extra fields)
// ============================================================================

export interface MethodNotAllowedExtension { allowed: string[] }
export interface UnsupportedMediaTypeExtension { supported?: string[] }
export interface PayloadTooLargeExtension { limitBytes?: number }
export interface RateLimitExtension { retryAfter: number }
export interface ServiceUnavailableExtension { service: string }

// ============================================================================
// Private base builder for problems (always uses STATUS_TITLES)
// ============================================================================

export function baseProblem(
  status: ContentfulStatusCode,
  type: string,
  instance: string,
  detail: string,
  docs?: string,
  extensions?: Record<string, unknown>
): ErrorResult {
  return [
    Object.assign(
      {
        type,
        title: titleFor(status),
        status,
        detail,
        instance,
        timestamp: new Date(),
      },
      docs ? { docs } : {},
      extensions ? extensions : {},
    ) as ProblemDetails,
    status,
    { 'Content-Type': 'application/problem+json' },
  ] as const
}

// ============================================================================
// Multi-error responses
// ============================================================================

/**
 * Build RFC7807 with an `errors` array for multi-violations.
 *
 * @example
 * const errors = [{ field: 'email', message: 'Invalid email' }]
 * return c.json(...errs(ERROR_TYPES.UNPROCESSABLE_ENTITY, titleFor(422), 422, c.req.path, errors))
 */
export function errs(
	type: string,
	title: string,
	status: ContentfulStatusCode,
	instance: string,
	errors: ValidationErrorDetail[],
	detail?: string,
	docs?: string
): ErrorsResult {
	const errorCount = errors.length
	const defaultDetail = errorCount === 1 ? '1 error occurred' : `${errorCount} errors occurred`
	return [
		Object.assign(
			{
				type,
				title,
				status,
				detail: detail || defaultDetail,
				instance,
				timestamp: new Date(),
				errors,
			},
			docs ? { docs } : {},
		) as ProblemDetailsWithErrors,
		status,
		{ 'Content-Type': 'application/problem+json' },
	] as const
}

/**
 * Canonical 422 validation failure shape with field-level details.
 *
 * @example
 * return c.json(...validationFailed(c.req.path, toErrs(zodError.issues)))
 */
export function validationFailed(
	instance: string,
	errors: ValidationErrorDetail[],
	detail?: string
): ErrorsResult {
	const status = 422 as const
	const errorCount = errors.length
	const defaultDetail =
		errorCount === 1
			? 'Request validation failed on 1 field'
			: `Request validation failed on ${errorCount} fields`

	return errs(
		ERROR_TYPES.VALIDATION_ERROR,
		titleFor(status),
		status,
		instance,
		errors,
		detail || defaultDetail,
		ERROR_DOCS.VALIDATION_ERROR
	)
}


// ============================================================================
// Convenience error factories (titles always from STATUS_TITLES)
// ============================================================================

export function badRequest(
	instance: string,
	detail: string,
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(400, ERROR_TYPES.BAD_REQUEST, instance, detail, ERROR_DOCS.BAD_REQUEST, extensions)
}

export function unauthorized(
	instance: string,
	detail: string = 'Authentication required',
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(401, ERROR_TYPES.UNAUTHORIZED, instance, detail, ERROR_DOCS.UNAUTHORIZED, extensions)
}

export function forbidden(
	instance: string,
	detail: string = 'Insufficient permissions',
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(403, ERROR_TYPES.FORBIDDEN, instance, detail, ERROR_DOCS.FORBIDDEN, extensions)
}

export function notFound(
	instance: string,
	detail: string = 'Resource not found',
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(404, ERROR_TYPES.NOT_FOUND, instance, detail, ERROR_DOCS.NOT_FOUND, extensions)
}

export function methodNotAllowed(
	instance: string,
	allowed: MethodNotAllowedExtension['allowed'],
	detail: string = 'Method not allowed',
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(
		405,
		ERROR_TYPES.METHOD_NOT_ALLOWED,
		instance,
		detail,
		ERROR_DOCS.METHOD_NOT_ALLOWED,
		Object.assign({ allowed }, extensions ? extensions : {}),
	)
}

export function notAcceptable(
	instance: string,
	detail: string = 'Not acceptable',
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(406, ERROR_TYPES.NOT_ACCEPTABLE, instance, detail, ERROR_DOCS.NOT_ACCEPTABLE, extensions)
}

export function requestTimeout(
	instance: string,
	detail: string = 'Request timed out',
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(408, ERROR_TYPES.REQUEST_TIMEOUT, instance, detail, ERROR_DOCS.REQUEST_TIMEOUT, extensions)
}

export function conflict(
	instance: string,
	detail: string = 'Resource already exists',
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(409, ERROR_TYPES.CONFLICT, instance, detail, ERROR_DOCS.CONFLICT, extensions)
}

export function gone(
	instance: string,
	detail: string = 'Resource is gone',
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(410, ERROR_TYPES.GONE, instance, detail, ERROR_DOCS.GONE, extensions)
}

export function preconditionFailed(
	instance: string,
	detail: string = 'Precondition failed',
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(412, ERROR_TYPES.PRECONDITION_FAILED, instance, detail, ERROR_DOCS.PRECONDITION_FAILED, extensions)
}

export function payloadTooLarge(
	instance: string,
	limitBytes?: PayloadTooLargeExtension['limitBytes'],
	detail: string = 'Payload too large',
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(
		413,
		ERROR_TYPES.PAYLOAD_TOO_LARGE,
		instance,
		detail,
		ERROR_DOCS.PAYLOAD_TOO_LARGE,
		Object.assign(limitBytes ? { limitBytes } : {}, extensions ? extensions : {}),
	)
}

export function uriTooLong(
	instance: string,
	detail: string = 'URI too long',
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(414, ERROR_TYPES.URI_TOO_LONG, instance, detail, ERROR_DOCS.URI_TOO_LONG, extensions)
}

export function unsupportedMediaType(
	instance: string,
	supported?: UnsupportedMediaTypeExtension['supported'],
	detail: string = 'Unsupported media type',
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(
		415,
		ERROR_TYPES.UNSUPPORTED_MEDIA_TYPE,
		instance,
		detail,
		ERROR_DOCS.UNSUPPORTED_MEDIA_TYPE,
		Object.assign(supported ? { supported } : {}, extensions ? extensions : {}),
	)
}

export function rangeNotSatisfiable(
	instance: string,
	detail: string = 'Range not satisfiable',
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(416, ERROR_TYPES.RANGE_NOT_SATISFIABLE, instance, detail, ERROR_DOCS.RANGE_NOT_SATISFIABLE, extensions)
}

export function unprocessableEntity(
	instance: string,
	detail: string = 'Request contains semantic errors',
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(422, ERROR_TYPES.UNPROCESSABLE_ENTITY, instance, detail, ERROR_DOCS.UNPROCESSABLE_ENTITY, extensions)
}

export function preconditionRequired(
	instance: string,
	detail: string = 'Precondition required',
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(428, ERROR_TYPES.PRECONDITION_REQUIRED, instance, detail, ERROR_DOCS.PRECONDITION_REQUIRED, extensions)
}

export function rateLimitExceeded(
	instance: string,
	retryAfter: RateLimitExtension['retryAfter'],
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(
		429,
		ERROR_TYPES.RATE_LIMIT_EXCEEDED,
		instance,
		`Rate limit exceeded. Retry after ${retryAfter} seconds.`,
		ERROR_DOCS.RATE_LIMIT_EXCEEDED,
		Object.assign({ retryAfter }, extensions ? extensions : {}),
	)
}

export function requestHeaderFieldsTooLarge(
	instance: string,
	detail: string = 'Request header fields too large',
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(
		431,
		ERROR_TYPES.REQUEST_HEADER_FIELDS_TOO_LARGE,
		instance,
		detail,
		ERROR_DOCS.REQUEST_HEADER_FIELDS_TOO_LARGE,
		extensions
	)
}

export function unavailableForLegalReasons(
	instance: string,
	detail: string = 'Unavailable for legal reasons',
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(
		451,
		ERROR_TYPES.UNAVAILABLE_FOR_LEGAL_REASONS,
		instance,
		detail,
		ERROR_DOCS.UNAVAILABLE_FOR_LEGAL_REASONS,
		extensions
	)
}

export function internalServerError(
	instance: string,
	detail: string = 'Internal server error',
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(500, ERROR_TYPES.INTERNAL_SERVER_ERROR, instance, detail, ERROR_DOCS.INTERNAL_SERVER_ERROR, extensions)
}

export function notImplemented(
	instance: string,
	detail: string = 'Not implemented',
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(501, ERROR_TYPES.NOT_IMPLEMENTED, instance, detail, ERROR_DOCS.NOT_IMPLEMENTED, extensions)
}

export function badGateway(
	instance: string,
	detail: string = 'Bad gateway',
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(502, ERROR_TYPES.BAD_GATEWAY, instance, detail, ERROR_DOCS.BAD_GATEWAY, extensions)
}

export function serviceUnavailable(
	instance: string,
	service: ServiceUnavailableExtension['service'],
	detail?: string,
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(
		503,
		ERROR_TYPES.SERVICE_UNAVAILABLE,
		instance,
		detail || `Upstream service '${service}' unavailable`,
		ERROR_DOCS.SERVICE_UNAVAILABLE,
		Object.assign({ service }, extensions ? extensions : {}),
	)
}

export function gatewayTimeout(
	instance: string,
	detail: string = 'Gateway timeout',
	extensions?: Record<string, unknown>
): ErrorResult {
	return baseProblem(504, ERROR_TYPES.GATEWAY_TIMEOUT, instance, detail, ERROR_DOCS.GATEWAY_TIMEOUT, extensions)
}

// ============================================================================
// err(): status-agnostic entrypoint with smart delegation (no `any` casting)
// ============================================================================

/**
 * Build a Problem Details error for any status.
 * - Delegates to the matching convenience factory (with required extras).
 * - Falls back to a generic RFC7807 if status is not mapped.
 */
export function err(
	status: ContentfulStatusCode,
	instance: string,
	detail: string,
	extensions?: Record<string, unknown>
): ErrorResult {
	switch (status as number) {
		case 400: return badRequest(instance, detail, extensions)
		case 401: return unauthorized(instance, detail, extensions)
		case 403: return forbidden(instance, detail, extensions)
		case 404: return notFound(instance, detail, extensions)
		case 405: {
			// If caller has `allowed`, they should call methodNotAllowed directly.
			return methodNotAllowed(instance, [], detail, extensions)
		}
		case 406: return notAcceptable(instance, detail, extensions)
		case 408: return requestTimeout(instance, detail, extensions)
		case 409: return conflict(instance, detail, extensions)
		case 410: return gone(instance, detail, extensions)
		case 412: return preconditionFailed(instance, detail, extensions)
		case 413: return payloadTooLarge(instance, undefined, detail, extensions)
		case 414: return uriTooLong(instance, detail, extensions)
		case 415: return unsupportedMediaType(instance, undefined, detail, extensions)
		case 416: return rangeNotSatisfiable(instance, detail, extensions)
		case 422: return unprocessableEntity(instance, detail, extensions)
		case 428: return preconditionRequired(instance, detail, extensions)
		case 429: {
			const retryAfter =
				extensions && typeof (extensions as { retryAfter?: unknown }).retryAfter === 'number'
					? (extensions as { retryAfter: number }).retryAfter
					: 60
			return rateLimitExceeded(instance, retryAfter, extensions)
		}
		case 431: return requestHeaderFieldsTooLarge(instance, detail, extensions)
		case 451: return unavailableForLegalReasons(instance, detail, extensions)
		case 500: return internalServerError(instance, detail, extensions)
		case 501: return notImplemented(instance, detail, extensions)
		case 502: return badGateway(instance, detail, extensions)
		case 503: {
			const service =
				extensions && typeof (extensions as { service?: unknown }).service === 'string'
					? (extensions as { service: string }).service
					: 'unknown'
			return serviceUnavailable(instance, service, detail, extensions)
		}
		case 504: return gatewayTimeout(instance, detail, extensions)
		default:
			// Generic fallback uses canonical title & inferred type.
			return baseProblem(
				status,
				`${BASE_ERROR_URL}/${String(status)}`,
				instance,
				detail,
				undefined,
				extensions
			)
	}
}

// ============================================================================
// Header helpers (typed)
// ============================================================================

/**
 * Compute extra HTTP headers that should accompany a Problem response.
 * - 429/503: set `Retry-After` from `extensions.retryAfter` (seconds) when present.
 */
export function extraProblemHeaders(
	status: ContentfulStatusCode,
	extensions?: Record<string, unknown>
): Record<string, string> {
	const out: Record<string, string> = {}
	const retryAfter =
		extensions && typeof (extensions as { retryAfter?: unknown }).retryAfter === 'number'
			? (extensions as { retryAfter: number }).retryAfter
			: undefined

	if ((status === 429 || status === 503) && typeof retryAfter === 'number') {
		out['Retry-After'] = String(retryAfter)
	}
	return out
}

/**
 * Throws an RFC 7807–compliant HTTP problem response.
 *
 * This utility wraps an `ErrorResult` tuple into a Hono `HTTPException`,
 * ensuring that validation errors or other structured error payloads
 * are returned in a standardized JSON format.
 *
 * The response body follows the [RFC 7807 Problem Details for HTTP APIs](https://datatracker.ietf.org/doc/html/rfc7807)
 * specification, allowing clients to consume consistent error information.
 *
 * @param err - A tuple containing:
 *   - `error`: The problem details object (e.g. validation errors).
 *   - `status`: The HTTP status code to return.
 *   - `headers`: Optional headers to include in the response.
 *
 * @throws {HTTPException} Always throws a Hono `HTTPException` with the given
 * problem details, status code, and headers.
 *
 * @example
 * ```ts
 * // Example usage inside a Hono route:
 * if (!isValid(input)) {
 *   exception([{ title: "Invalid input", detail: "Field X is required" }, 400, { "Content-Type": "application/problem+json" }]);
 * }
 * ```
 */
export function exception(err: ErrorResponse) {
  const [error, status, headers] = err;

  // Return RFC 7807 validation error array
  return new HTTPException(status, {
		res: new Response(JSON.stringify(error), { status, headers: headers }),
  });
}

/**
 * Check if response is an error by inspecting Content-Type
 * Don't destructure before checking - this maintains type narrowing
 * 
 * @example
 * const result = await someApiCall()
 * if (isErrorResponse(result)) {
 *   const [error, status, headers] = result  // ✅ result is now ErrorResponse
 *   return c.json(error, status, headers)
 * }
 * // ✅ result is now SuccessResponse<T>
 * const [data, status, headers] = result
 */
export function isErrorResponse(response: ResponseResult): response is ErrorResponse {
	return response[2]['Content-Type'] === 'application/problem+json'
}