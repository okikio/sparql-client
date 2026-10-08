/** Integration fixture ownership without importing a runner or production package. @module */

/** Releases dependent resources in reverse acquisition order, retaining primary and cleanup failures. */
export async function finish<Value>(
  body: (release: Array<() => void | PromiseLike<void>>) => Value | PromiseLike<Value>,
): Promise<Value> {
  const releases: Array<() => void | PromiseLike<void>> = []
  const errors: unknown[] = []
  let value!: Value
  try {
    value = await body(releases)
  } catch (error) {
    errors.push(error)
  } finally {
    for (const release of releases.reverse()) {
      try {
        await release()
      } catch (error) {
        errors.push(error)
      }
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, 'Fixture and cleanup failed.')
  return value
}
