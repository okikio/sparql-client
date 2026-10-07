/** Internal incremental iteration with abort races and deterministic iterator cleanup. @module */

/**
 * Consumes one borrowed source iterator without claiming its owning resource.
 * Pending reads race the signal. Early return, failure, and abort call return once;
 * an uncooperative iterator can still delay its own cleanup. Synchronous work cannot
 * be preempted. A secondary cleanup failure retains the original failure as cause.
 */
export async function* consume<Value>(
  source: Iterable<Value> | AsyncIterable<Value>,
  signal?: AbortSignal,
): AsyncGenerator<Value> {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
  const iterator = Symbol.asyncIterator in Object(source)
    ? (source as AsyncIterable<Value>)[Symbol.asyncIterator]()
    : (source as Iterable<Value>)[Symbol.iterator]()
  let done = false
  let failed = false
  let failure: unknown
  try {
    while (true) {
      const next = await read(iterator, signal)
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
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
    if (!done) await close(iterator, failed, failure)
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

/** One abort listener belongs to one pending source read and is removed on every settlement path. */
function read<Value>(
  iterator: Iterator<Value> | AsyncIterator<Value>,
  signal?: AbortSignal,
): Promise<IteratorResult<Value>> {
  if (!signal) return Promise.resolve(iterator.next())
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => {
      if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
      return iterator.next()
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
