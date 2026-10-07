/** Native Mitata reports are evidence only when every registered run has real samples. */
export function validateMitata(value: unknown): void {
  if (
    typeof value !== 'object' || value === null || !('benchmarks' in value) ||
    !Array.isArray(value.benchmarks) ||
    value.benchmarks.length === 0
  ) {
    throw new Error('Expected a nonempty native Mitata benchmark report.')
  }
  for (const entry of value.benchmarks as unknown[]) {
    const benchmark = record(entry)
    if (
      typeof benchmark !== 'object' || benchmark === null || !Array.isArray(benchmark.runs) ||
      benchmark.runs.length === 0
    ) {
      throw new Error('A Mitata benchmark has no measured runs.')
    }
    for (const entry of benchmark.runs as unknown[]) {
      const run = record(entry), stats = record(run.stats)
      const { min, max, p25, p50, p75, p99, p999, avg } = stats
      if (
        run.error != null || !Array.isArray(stats.samples) || stats.samples.length === 0 ||
        stats.samples.some((sample: unknown) =>
          typeof sample !== 'number' || !Number.isFinite(sample) || sample < 0
        ) ||
        !finite(min) || !finite(max) || !finite(p25) || !finite(p50) || p50 <= 0 ||
        !finite(p75) || !finite(p99) || !finite(p999) || !finite(avg) ||
        min > p25 || p25 > p50 || p50 > p75 || p75 > p99 || p99 > p999 || p999 > max ||
        !meanWithin(avg, min, max, stats.samples.length) ||
        stats.samples.some((sample: number) => sample < min || sample > max)
      ) {
        throw new Error('A Mitata run failed or has invalid/empty timing samples.')
      }
      for (const name of ['heap', 'gc'] as const) {
        if (name in stats) validateResource(stats[name], name, stats.samples.length + 4)
      }
    }
  }
}

/** Heap records nonnegative batch-normalized deltas; GC records post-batch collection nanoseconds. */
function validateResource(value: unknown, kind: 'heap' | 'gc', timingCount: number): void {
  const row = record(value)
  if (kind === 'heap' && row._ === 0) {
    if (row.total === 0 && row.min === null && row.max === null && row.avg === null) return
    throw new Error('Invalid unavailable Mitata heap observation.')
  }
  const { min, max, avg, total } = row
  const count = kind === 'heap' ? row._ : timingCount
  if (
    (kind === 'heap' &&
      (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0)) ||
    !finite(min) || !finite(max) || !finite(avg) || !finite(total) || min > max || total < max ||
    !meanWithin(avg, min, max, typeof count === 'number' ? count : timingCount) ||
    (kind === 'heap' && typeof count === 'number' && !meanWithin(total / count, min, max, count))
  ) throw new Error(`Invalid or incomplete Mitata ${kind} observations.`)
}

/** The pinned mean sums samples; permit only its bounded floating-point summation error at extrema. */
function meanWithin(mean: number, min: number, max: number, count: number): boolean {
  const tolerance = Math.max(Number.MIN_VALUE, max * Number.EPSILON * count)
  return mean + tolerance >= min && mean - tolerance <= max
}

/** Narrows report data without trusting JSON parsing to validate its structure. */
function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Malformed Mitata report object.')
  }
  return value as Readonly<Record<string, unknown>>
}

/** Timing and byte observations cannot use NaN, infinity or negative sentinels. */
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
