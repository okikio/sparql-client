/** Enumerates isolated benchmark processes so large fixtures do not accumulate across groups. @module */

/** One process owns only the fixtures named by this workload. */
export interface WorkType {
  readonly file: string
  readonly name: string
  readonly env: Readonly<Record<string, string>>
}
/** Expands the parser matrix into processes while keeping every syntax, size, oracle and sample. */
export function plan(files: readonly string[], large: boolean): readonly WorkType[] {
  const formats = ['N-Triples', 'N-Quads', 'Turtle', 'TriG']
  const counts = large ? [100, 10_000, 100_000, 1_000_000] : [100, 10_000, 100_000]
  const format = Deno.env.get('BENCH_PARSE_FORMAT')
  const count = Deno.env.get('BENCH_PARSE_COUNT')
  if (format !== undefined && !formats.includes(format)) {
    throw new Error('Unknown BENCH_PARSE_FORMAT.')
  }
  if (count !== undefined && !counts.includes(Number(count))) {
    throw new Error('Unknown BENCH_PARSE_COUNT.')
  }
  const selected = Deno.env.get('BENCH_ONLY')?.split(',').map((value) => value.trim())
  if (selected?.some((value) => !files.includes(value))) {
    throw new Error('BENCH_ONLY must contain complete paths to known package benchmark files.')
  }
  // Check the other programs before the expensive syntax matrix; ordering stays deterministic.
  return files.filter((file) => selected === undefined || selected.includes(file)).toSorted(
    (left, right) =>
      Number(left === 'packages/rdf/parse_compare_bench.ts') -
      Number(right === 'packages/rdf/parse_compare_bench.ts'),
  ).flatMap(
    (file) => {
      const name = file.replace(/^packages\//u, '').replaceAll('/', '__').replace(
        /_bench\.ts$/u,
        '',
      )
      if (file !== 'packages/rdf/parse_compare_bench.ts') return [{ file, name, env: {} }]
      return formats.filter((value) => format === undefined || value === format).flatMap((format) =>
        counts.filter((value) => count === undefined || value === Number(count)).map((count) => ({
          file,
          name: `${name}__${format}__${count}`,
          env: { BENCH_PARSE_FORMAT: format, BENCH_PARSE_COUNT: String(count) },
        }))
      )
    },
  )
}
