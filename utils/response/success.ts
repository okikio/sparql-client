import type { ContentlessStatusCode, ContentfulStatusCode, StatusCode } from 'hono/utils/http-status'
import type { ContentlessResult, Pagination, SuccessResult, PaginationResult, DataMetadata, JsonHeadersWithLinks, StandardHeaders, ResponseResult, SuccessResponse, SuccessEnvelope, GenericSuccessResult, PaginationMetadata, LinkMap } from './schemas.ts'

/**
 * 200/201/202/204 OK-style success envelope.
 *
 * @example
 * return c.json(...ok({ id: 'like-1' }))               // 200
 * return c.json(...ok(resource, 201))                   // 201 Created (use `created` if you have a Location)
 * return c.json(...ok(null, 204))                       // 204 No Content
 */
export function ok<T extends undefined | null | ''>(
  data: T,
  statusCode: ContentlessStatusCode,
): ContentlessResult;

export function ok<T = unknown, M extends DataMetadata = DataMetadata>(
  data: T,
  statusCode: ContentfulStatusCode,
  meta?: M
): SuccessResult<T, M>;

export function ok<T = unknown, M extends DataMetadata = DataMetadata>(
  data: T,
  statusCode: StatusCode = 200,
  meta = {} as M
): SuccessResult<T, M> | ContentlessResult {
  switch (statusCode) {
    case 101:
    case 204:
    case 205:
    case 304:
      return [undefined, statusCode as ContentlessStatusCode, { 'Content-Type': 'application/json' }] as const
  }

  return [
    {
      data,
      meta: Object.assign({ timestamp: new Date().toISOString() }, (meta ?? {})),
    },
    statusCode as ContentfulStatusCode,
    { 'Content-Type': 'application/json' },
  ] as const
}

/**
 * 201 Created — includes optional Location header.
 *
 * @example
 * const res = created({ id }, `/api/orders/${id}`)
 * return c.json(...withHeaders(res, { Location: `/api/orders/${id}` }))
 */
export function created<T = unknown, M extends DataMetadata = DataMetadata>(
  data: T,
  location?: string,
  meta?: M
): SuccessResult<T> {
  const result = ok<T>(data, 201, meta)
  return location ? withHeaders(result, { Location: location }) : result
}

/**
 * 202 Accepted — server accepted the request for processing.
 *
 * Provide tracking metadata to help clients poll or subscribe.
 *
 * @example
 * return c.json(...accepted({ taskId }, { tracking: { taskId, status: 'queued' } }))
 */
export function accepted<T = unknown, M extends DataMetadata = DataMetadata>(
  data: T,
  meta?: M
): SuccessResult<T> {
  return ok<T>(data, 202, meta)
}

/**
 * 204 No Content — success with no payload. `data` is always null.
 *
 * @example
 * return c.json(...noContent())
 */
export function noContent(): ContentlessResult {
  return ok<null>(null, 204)
}

/**
 * Paginated success (cursor or offset) with standard + de-facto headers.
 *
 * Headers emitted:
 * - Always:
 *   - Link: rel="next"/"prev" for cursor; rel="first"/"next"/"prev"/"last" for offset
 * - Offset mode (when available):
 *   - X-Total-Count: <total or approxTotal>
 *   - X-Per-Page: <limit>
 *   - X-Page: <1-based page index>
 *   - X-Total-Pages: <ceil(total/limit)>   // only when exact total known
 *   - Range-Unit: items                    // standards-aligned
 *   - Content-Range: start-end/total       // only when exact total known
 *   - Preference-Applied: count=exact|estimated
 *
 * Notes:
 * - We never guess "first/last" for cursor paging (that’s typically unstable). For offset we include both.
 * - When only approxTotal is available, we still emit X-Total-Count (as best-effort) and mark
 *   Preference-Applied: count=estimated, but we avoid Content-Range and X-Total-Pages (those imply exactness).
 *
 * @example
 * return c.json(...paginate(c.req.url, items, { hasMore: true, nextCursor: 'abc', limit: 20 }))
 */
export function paginate<T = unknown>(
  url = "/",
  data: T,
  pagination: Pagination
): PaginationResult<T> {
  // --- headers & links -------------------------------------------------------
  const headers: StandardHeaders = {}
	const linkMap: LinkMap = { self: url }; 
  const linkHeaderParts: string[] = []

  // Self link (current page)
  if (pagination.offset !== undefined && pagination.limit) {
    // Canonical offset-based URL for this page
    const selfUrl = buildOffsetUrl(url, pagination.offset, pagination.limit);
    linkHeaderParts.push(`<${selfUrl}>; rel="self"`)
    linkMap.self = selfUrl
  } else {
    // Fallback: treat `path` as already representing the current URL (path + query)
    linkHeaderParts.push(`<${url}>; rel="self"`)
    linkMap.self = url
  }

  // Cursor links
  if (pagination.nextCursor) {
    const nextUrl = buildCursorUrl(url, pagination.nextCursor, pagination.limit)
    linkHeaderParts.push(`<${nextUrl}>; rel="next"`)
    linkMap.next = nextUrl
  }
  if (pagination.prevCursor) {
    const prevUrl = buildCursorUrl(url, pagination.prevCursor, pagination.limit)
    linkHeaderParts.push(`<${prevUrl}>; rel="prev"`)
    linkMap.next = prevUrl
  }

  // Offset links + extra headers
  if (pagination.offset !== undefined && pagination.limit) {
    const firstOffset = 0
    const nextOffset = pagination.offset + pagination.limit
    const prevOffset = Math.max(pagination.offset - pagination.limit, 0)

		const firstUrl = buildOffsetUrl(url, firstOffset, pagination.limit);
		const nextUrl = buildOffsetUrl(url, nextOffset, pagination.limit);
		const prevUrl = buildOffsetUrl(url, prevOffset, pagination.limit);

		linkMap.first = firstUrl;
		linkMap.next ??= nextUrl;
		linkMap.prev ??= prevUrl;

		linkHeaderParts.push(`<${firstUrl}>; rel="first"`);
		linkHeaderParts.push(`<${nextUrl}>; rel="next"`);
		linkHeaderParts.push(`<${prevUrl}>; rel="prev"`);

    const total = pagination.total
    const approx = pagination.approxTotal

    // De-facto admin-friendly counters
    // Prefer exact `total`; fall back to `approxTotal` if present.
    if (typeof total === "number" || typeof approx === "number") {
      const totalCount = typeof total === "number" ? total : (approx as number)
      headers["X-Total-Count"] = String(totalCount)
      headers["X-Per-Page"] = String(pagination.limit)
      headers["X-Page"] = String(Math.floor((pagination.offset ?? 0) / pagination.limit) + 1)
      // Only compute total pages when exact total is known
      if (typeof total === "number" && pagination.limit > 0) {
        headers["X-Total-Pages"] = String(Math.max(Math.ceil(total / pagination.limit), 1))
      }
      // Signal whether the server used exact or estimated counts
      headers["Preference-Applied"] = typeof total === "number" ? "count=exact" : "count=estimated"
    }

    // Standards-aligned range headers (only when exact total is known)
    //  - Range-Unit: items
    //  - Content-Range: start-end/total (end is inclusive)
    if (typeof total === "number") {
      const start = Math.max(pagination.offset, 0)
      const end = Math.max(Math.min(start + pagination.limit - 1, Math.max(total - 1, 0)), 0)
      headers["Range-Unit"] = "items"
      headers["Content-Range"] = `${start}-${end}/${total}`
    }

    // Last link only when exact total is known (so it's meaningful)
    if (typeof total === "number" && total >= 0) {
      const lastOffset = Math.max(total - pagination.limit, 0)
			const lastUrl = buildOffsetUrl(url, lastOffset, pagination.limit);
			linkHeaderParts.push(`<${lastUrl}>; rel="last"`);
			linkMap.last = lastUrl;
    }
  }

  if (linkHeaderParts.length > 0) {
    headers["Link"] = Array.from(new Set(linkHeaderParts)).join(", ").trim()
  }

  // --- meta envelope ---------------------------------------------------------
  const paginationMeta = Object.assign(
    {
      hasMore: pagination.hasMore,
      limit: pagination.limit,
      count: pagination.count,
    },
    pagination.nextCursor !== undefined ? { nextCursor: pagination.nextCursor } : {},
    pagination.prevCursor !== undefined ? { prevCursor: pagination.prevCursor } : {},
    pagination.offset !== undefined ? { offset: pagination.offset } : {},
    pagination.total !== undefined ? { total: pagination.total } : {},
    (pagination.approxTotal !== undefined || pagination.total !== undefined)
      ? { approxTotal: pagination.total ?? pagination.approxTotal }
      : {},
    pagination.expiresAt !== undefined ? { expiresAt: pagination.expiresAt } : {},
  ) as Pagination;


	const meta: PaginationMetadata = { pagination: paginationMeta, links: linkMap };

  // Return typed pagination tuple with headers
  return withHeaders(ok(data, 200, meta), headers as JsonHeadersWithLinks) satisfies PaginationResult<T>
}

/**
 * Allowed values for query parameters.
 * `null` and `undefined` are treated as "do not include".
 */
type QueryValue = string | number | boolean | null | undefined;

/**
 * Safely add or replace query params on a path or full URL.
 *
 * - Preserves existing query params
 * - Works with relative paths ("/search?q=x") and full URLs ("https://example.com/search?q=x")
 * - Preserves `#hash` fragments
 *
 * @example
 * buildUrlWithParams("/search?q=superman", { cursor: "abc", limit: 20 });
 * // "/search?q=superman&cursor=abc&limit=20"
 *
 * @example
 * buildUrlWithParams("https://example.com/list?offset=10", { offset: 30 });
 * // "https://example.com/list?offset=30"
 */
export function buildUrlWithParams(
  path: string,
  paramsToSet: Record<string, QueryValue>,
): string {
  // Split off hash fragment (if any) so we can re-attach it later
  const [beforeHash, hash = ""] = path.split("#", 2);
  // Split path and existing query string (if any)
  const [base, existingQuery = ""] = beforeHash.split("?", 2);

  const searchParams = new URLSearchParams(existingQuery);

  // Apply new/updated params
  for (const [key, value] of Object.entries(paramsToSet)) {
    if (value === null || value === undefined) {
      // Skip nullish values (could also choose to delete instead)
      continue;
    }

    let stringValue: string;

    if (typeof value === "boolean") {
      stringValue = value ? "true" : "false";
    } else {
      stringValue = String(value);
    }

    searchParams.set(key, stringValue);
  }

  const queryString = searchParams.toString();
  const hashPart = hash ? `#${hash}` : "";

  if (queryString.length === 0) {
    return `${base}${hashPart}`;
  }

  return `${base}?${queryString}${hashPart}`;
}

/**
 * Helper to build cursor-based pagination URLs.
 *
 * - Safely adds/replaces `cursor` and `limit`
 * - Preserves any existing query params
 *
 * @example
 * buildCursorUrl("/search?q=superman", "abc123", 20);
 * // "/search?q=superman&cursor=abc123&limit=20"
 */
export function buildCursorUrl(
  path = "/",
  cursor: string,
  limit: number,
): string {
  return buildUrlWithParams(path, {
    cursor,
    limit,
  });
}

/**
 * Helper to build offset-based pagination URLs.
 *
 * - Safely adds/replaces `offset` and `limit`
 * - Preserves any existing query params
 *
 * @example
 * buildOffsetUrl("/list?sort=desc", 40, 20);
 * // "/list?sort=desc&offset=40&limit=20"
 */
export function buildOffsetUrl(
  path: string,
  offset: number,
  limit: number,
): string {
  return buildUrlWithParams(path, {
    offset,
    limit,
  });
}

/**
 * Merge extra headers into any 3-tuple response.
 * 
 * Preserves exact body and status types, merges headers via intersection.
 * Return type remains structurally compatible with ResponseResult members.
 */
export function withHeaders<
  const T extends readonly [any, StatusCode, StandardHeaders],
  const E extends StandardHeaders
>(
  result: T,
  extra: E
): readonly [T[0], T[1], T[2] & E] {
  const [body, status, headers] = result
  return [
    body,
    status,
    { ...headers, ...extra } as T[2] & E,
  ] as const
}

/**
 * Merge extra metadata into the response envelope’s `meta` field.
 *
 * - Preserves `data` and status as-is
 * - Deep-merges `meta` at the top level (shallow per key)
 * - Keeps the `timestamp` from `ok()` intact
 *
 * @example
 * const res = paginate(url, items, pagination)
 * const enriched = withMeta(res, {
 *   query: {
 *     durationMs,
 *     filters,
 *     sorts,
 *     fields,
 *     source: { backend: 'supabase', adapter: 'query' },
 *   },
 * })
 * return c.json(...enriched)
 */
export function withMeta<
  const T extends GenericSuccessResult,
  const M extends DataMetadata
>(
  result: T,
  extra: M
): readonly [
  SuccessEnvelope<T[0]['data'], T[0]['meta'] & M>,
  T[1],
  T[2]
] {
  const [body, status, headers] = result

  const mergedMeta = Object.assign(
    {},
    body.meta ?? {},
    extra ?? {},
  )

  return [
    Object.assign(body, {
      data: body.data,
      meta: mergedMeta as T[0]['meta'] & M,
    }),
    status,
    headers,
  ] as const
}

/**
 * Check if response is success
 */
export function isSuccessResponse<T>(response: ResponseResult<T>): response is SuccessResponse<T> {
  return response[2]['Content-Type'] !== 'application/problem+json'
}
