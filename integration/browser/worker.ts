/// <reference lib="webworker" />
import { run, type ScenarioType } from './consumer.ts'

/** The fixture worker owns one response and exposes failures to the parent test. */
declare const self: DedicatedWorkerGlobalScope
self.onmessage = (event: MessageEvent<ScenarioType>) => {
  void run(event.data).then(
    (value) => self.postMessage({ value }),
    (error: unknown) =>
      self.postMessage({
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      }),
  )
}
