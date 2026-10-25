/** Distinguishes absent task outputs from failures to inspect or remove them. @module */

/**
 * Returns undefined only when the requested filesystem operation reports NotFound.
 * A permission, I/O, or other error still stops a clean build or consumer setup.
 */
export async function optional<T>(operation: () => Promise<T>): Promise<T | undefined> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined
    throw error
  }
}
