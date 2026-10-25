/** Direct source export-map comparison for matching npm and JSR package surfaces. @module */

/** Normalizes the supported direct string-map surface; nested condition maps remain unsupported. */
export function exportMap(value: unknown): Record<string, string> {
  if (typeof value === 'string') return { '.': value }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('exports must be a string map.')
  }
  const result: Record<string, string> = Object.create(null)
  for (const [key, target] of Object.entries(value)) {
    if (typeof target !== 'string') {
      throw new TypeError(`Export '${key}' must point directly to one source file.`)
    }
    result[key] = target
  }
  return result
}

/** Map insertion order is incidental; the set of public names and each direct target must match. */
export function sameExports(left: unknown, right: unknown): boolean {
  const first = exportMap(left), second = exportMap(right)
  const keys = Object.keys(first)
  return keys.length === Object.keys(second).length &&
    keys.every((key) => Object.hasOwn(second, key) && first[key] === second[key])
}
