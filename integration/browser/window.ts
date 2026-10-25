import { run, type ScenarioType } from './consumer.ts'

/** A worker is owned by this one call and always terminated on success or failure. */
async function worker(scenario: ScenarioType): Promise<Awaited<ReturnType<typeof run>>> {
  const instance = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise((resolve, reject) => {
      instance.onmessage = ({ data }) =>
        data.error ? reject(new Error(data.error)) : resolve(data.value)
      instance.onerror = reject
      instance.postMessage(scenario)
    })
  } finally {
    instance.terminate()
  }
}

/** Window fixture is a consumer, not a production global or library initialization effect. */
/** Loads storage only when the explicit cross-repository lane runs. */
async function storage(action: 'write' | 'read' | 'remove', path: string) {
  const source = await import('./storage.ts')
  if (action === 'write') return await source.write(path)
  if (action === 'read') return await source.read(path)
  await source.remove(path)
  return { removed: true }
}

export const browserTest = { run, worker, storage }
Object.assign(window, { browserTest })

/** The visible action gives interactive inspection precisely the same public workflow. */
document.querySelector('#storage')?.addEventListener('click', async () => {
  const result = document.querySelector('#result')!
  const path = `/interactive-rdf-${crypto.randomUUID()}`
  result.textContent = 'Running storage workflow...'
  try {
    const written = await storage('write', path)
    const reopened = await storage('read', path)
    result.textContent = JSON.stringify({ written, reopened }, null, 2)
  } catch (error) {
    result.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  } finally {
    await storage('remove', path)
  }
})
