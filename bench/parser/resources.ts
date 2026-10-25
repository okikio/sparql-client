/** Validates physical profiler observations without imposing a host-specific performance threshold. @module */

/** Rejects missing, nonfinite or physically invalid resource/latency observations before reporting success. */
export function validateObservation(value: unknown): void {
  const item = record(value)
  for (const name of ['parseMs', 'quadsPerSecond', 'utf8MiBPerSecond']) {
    if (typeof item[name] !== 'number' || !Number.isFinite(item[name]) || item[name] <= 0) {
      throw new Error(`Invalid positive ${name}.`)
    }
  }
  if (!integer(item.highWaterRssBytes) || item.highWaterRssBytes <= 0 || !integer(item.attempt)) {
    throw new Error('Invalid process RSS/attempt observation.')
  }
  const cpu = record(item.cpuMicros)
  if (!integer(cpu.user) || !integer(cpu.system)) throw new Error('Invalid CPU microseconds.')
  for (const key of ['before', 'after', 'afterReleaseGc']) {
    const memory = record(item[key])
    for (const field of ['rss', 'heapTotal', 'heapUsed', 'external']) {
      if (!integer(memory[field])) throw new Error(`Invalid ${key}.${field} bytes.`)
    }
    if (Number(memory.heapUsed) > Number(memory.heapTotal)) {
      throw new Error('Used heap exceeds its allocated heap total.')
    }
  }
}

/** Byte snapshots and CPU counters are nonnegative safe integers; normalized latency may be fractional. */
function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
/** Missing measurements are errors, rather than zero values substituted by a summary. */
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error('Missing resource observation.')
  return value as Record<string, unknown>
}
