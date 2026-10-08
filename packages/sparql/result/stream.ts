/** Query-result ownership exists at acquisition, before the first consumer pull. @module */

import { pending } from '@okikio/rdf/stream'

/** One owned operation result. Its engine/client remains borrowed. */
export interface ResultType<Value> extends AsyncIterable<Value>, AsyncDisposable {
  /** Actual cooperative cleanup completion. Cancellation does not pretend this must finish. */
  readonly cleanup: Promise<void>
  /** Stops observation and requests owned cleanup once, including when never iterated. */
  cancel(reason?: unknown): void
  /** Ends consumption. Waiting for cooperative cleanup is an explicit advanced choice. */
  close(options?: { readonly waitForCleanup?: boolean }): Promise<void>
}

/** Controls operation cancellation and an optional adapter-specific release contract. */
export interface ResultOptionsType {
  /** Caller signal owns terminal cancellation before the first result pull. */
  readonly signal?: AbortSignal
  /** Owns upstream release instead of automatically calling iterator.return. */
  readonly release?: (reason: unknown) => void | PromiseLike<void>
}

/** Adapts one acquired source into a single-consumer result with eager cancellation authority. */
export function result<Input, Output = Input>(
  source: Iterable<Input> | AsyncIterable<Input>,
  options: ResultOptionsType = {},
  map: (value: Input) => Output = (value) => value as unknown as Output,
): ResultType<Output> {
  const iterator = Symbol.asyncIterator in Object(source)
    ? (source as AsyncIterable<Input>)[Symbol.asyncIterator]()
    : (source as Iterable<Input>)[Symbol.iterator]()
  const controller = new AbortController()
  let terminal = false
  let claimed = false
  let reading = false
  let released = false
  let failed = false
  let failure: unknown
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const cleanup = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  // This observer never hides the public cleanup rejection or replaces its primary reason.
  void cleanup.catch(() => undefined)
  const detach = (): void => options.signal?.removeEventListener('abort', onAbort)
  const release = (reason: unknown): void => {
    if (released) return
    released = true
    detach()
    Promise.resolve().then(async () => {
      if (options.release) await options.release(reason)
      else await iterator.return?.()
    }).then(resolve, (error: unknown) => {
      reject(
        failed
          ? new AggregateError([failure, error], 'Query result and cleanup failed.', {
            cause: failure,
          })
          : error,
      )
    })
  }
  const cancel = (...reasons: [] | [unknown]): void => {
    const reason = reasons.length
      ? reasons[0]
      : new DOMException('Result consumption stopped.', 'AbortError')
    if (terminal) return
    terminal = true
    failed = true
    failure = reason
    controller.abort(reason)
    release(reason)
  }
  function onAbort(): void {
    cancel(options.signal!.reason)
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.signal?.aborted) onAbort()

  const values: AsyncIterator<Output> = {
    async next() {
      if (failed) throw failure
      if (terminal) return { done: true, value: undefined }
      if (reading) throw new TypeError('Query result permits one pending pull.')
      reading = true
      try {
        const item = await pending(() => iterator.next(), controller.signal)
        if (failed) throw failure
        if (item.done) {
          terminal = true
          release(undefined)
          return { done: true, value: undefined }
        }
        return { done: false, value: map(item.value) }
      } catch (error) {
        cancel(error)
        throw error
      } finally {
        reading = false
      }
    },
    return() {
      cancel()
      return Promise.resolve({ done: true as const, value: undefined })
    },
  }
  return {
    cleanup,
    cancel,
    [Symbol.asyncIterator]() {
      if (claimed) throw new TypeError('Query result is single-consumer.')
      claimed = true
      return values
    },
    async close(options = {}) {
      cancel()
      if (options.waitForCleanup) await cleanup
    },
    async [Symbol.asyncDispose]() {
      cancel()
      await cleanup
    },
  }
}

/** Races acquisition; a resource acquired after abort is retired instead of being leaked or published. */
export async function acquire<Value>(
  open: () => Value | PromiseLike<Value>,
  release: (value: Value, reason: unknown) => void | PromiseLike<void>,
  signal?: AbortSignal,
  onCleanup?: (cleanup: Promise<void>) => void,
): Promise<Value> {
  if (signal?.aborted) throw signal.reason
  const acquiring = Promise.resolve().then(() => {
    if (signal?.aborted) throw signal.reason
    return open()
  })
  try {
    return await pending(() => acquiring, signal)
  } catch (error) {
    const cleanup = acquiring.then(
      (value) => Promise.resolve().then(() => release(value, error)),
      () => undefined,
    )
    void cleanup.catch(() => undefined)
    if (onCleanup) void Promise.resolve().then(() => onCleanup(cleanup)).catch(() => undefined)
    throw error
  }
}
