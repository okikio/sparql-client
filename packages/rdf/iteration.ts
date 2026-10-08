/** Internal incremental iteration with abort races and deterministic iterator cleanup. @module */

/**
 * Consumes one borrowed source iterator without claiming its owning resource.
 * Pending reads race the signal. Early return, failure, and abort call return once;
 * abort does not wait for uncooperative cleanup. onCleanup observes cleanup
 * separately and also makes early return prompt. Without that observer, normal
 * return awaits cooperative cleanup. Synchronous work cannot be preempted. A
 * secondary cleanup failure retains the original failure as cause.
 */
export async function* consume<Value>(
  source: Iterable<Value> | AsyncIterable<Value>,
  signal?: AbortSignal,
  onCleanup?: (cleanup: Promise<void>) => void,
): AsyncGenerator<Value> {
  if (signal?.aborted) throw signal.reason
  const iterator = Symbol.asyncIterator in Object(source)
    ? (source as AsyncIterable<Value>)[Symbol.asyncIterator]()
    : (source as Iterable<Value>)[Symbol.iterator]()
  let done = false
  let failed = false
  let failure: unknown
  try {
    while (true) {
      const next = await pending(() => iterator.next(), signal)
      if (signal?.aborted) throw signal.reason
      if (next.done) {
        done = true
        return
      }
      yield next.value
    }
  } catch (error) {
    failed = true
    failure = error
    throw error
  } finally {
    if (!done) {
      const cleanup = close(iterator, failed, failure)
      if (onCleanup) {
        // Attach a rejection observer before handing borrowed cleanup to its caller.
        void cleanup.catch(() => undefined)
        onCleanup(cleanup)
      } else if (signal?.aborted) {
        void cleanup.catch(() => undefined)
      } else await pending(() => cleanup, signal)
    }
  }
}

/** Releases this consumption's iterator while retaining both failures when cleanup also fails. */
async function close<Value>(
  iterator: Iterator<Value> | AsyncIterator<Value>,
  failed: boolean,
  failure: unknown,
): Promise<void> {
  try {
    await iterator.return?.()
  } catch (cleanup) {
    if (failed) {
      throw new AggregateError([failure, cleanup], 'RDF source and iterator cleanup failed.', {
        cause: failure,
      })
    }
    throw cleanup
  }
}

/**
 * Runs one operation without acquiring ownership of its resource. Cancellation
 * rejects promptly and observes late resolution/rejection; it cannot stop an
 * uncooperative producer. One listener belongs to this wait and is always removed.
 */
export function pending<Value>(
  operation: () => Value | PromiseLike<Value>,
  signal?: AbortSignal,
): Promise<Value> {
  if (!signal) return Promise.resolve().then(operation)
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      reject(signal.reason)
    }
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => {
      if (signal.aborted) throw signal.reason
      return operation()
    }).then(
      (next) => {
        signal.removeEventListener('abort', abort)
        resolve(next)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}
