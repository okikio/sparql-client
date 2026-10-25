/** Required pinned TypeScript compiler diagnostic contract. @module */

/** Counters are integers, memory is bytes, and compiler phases are milliseconds. */
export interface DiagnosticsType {
  readonly files: number
  readonly linesOfLibrary: number
  readonly linesOfTypeScript: number
  readonly identifiers: number
  readonly symbols: number
  readonly types: number
  readonly instantiations: number
  readonly memoryBytes: number
  readonly parseMs: number
  readonly bindMs: number
  readonly checkMs: number
  readonly totalMs: number
}

/** Required extended diagnostics from the pinned compiler have explicit units and finite values. */
export function parseDiagnostics(text: string): DiagnosticsType {
  const values = new Map<string, { number: number; unit: string | undefined }>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^([^:]+):\s+([-+]?[\d.]+|NaN|Infinity)\s*(K|M|s|ms)?$/.exec(line.trim())
    if (!match) continue
    const name = match[1]!.trim()
    if (values.has(name)) throw new Error(`Repeated TypeScript diagnostic: ${name}`)
    values.set(name, { number: Number(match[2]), unit: match[3] })
  }
  const read = (name: string, kind: 'count' | 'memory' | 'time'): number => {
    const value = values.get(name)
    if (!value) throw new Error(`Missing TypeScript diagnostic: ${name}`)
    if (!Number.isFinite(value.number) || value.number < 0) {
      throw new Error(`Invalid TypeScript diagnostic: ${name}`)
    }
    if (kind === 'count') {
      if (value.unit !== undefined || !Number.isSafeInteger(value.number)) {
        throw new Error(`Invalid TypeScript counter: ${name}`)
      }
      return value.number
    }
    if (kind === 'memory') {
      if (value.unit !== 'K') throw new Error(`Invalid TypeScript memory unit: ${name}`)
      const bytes = value.number * 1000
      if (!Number.isSafeInteger(value.number) || !Number.isSafeInteger(bytes)) {
        throw new Error(`Invalid TypeScript memory value: ${name}`)
      }
      return bytes
    }
    if (value.unit !== 's' && value.unit !== 'ms') {
      throw new Error(`Invalid TypeScript time unit: ${name}`)
    }
    const milliseconds = value.number * (value.unit === 's' ? 1000 : 1)
    if (!Number.isFinite(milliseconds)) throw new Error(`Invalid TypeScript time value: ${name}`)
    return milliseconds
  }
  return {
    files: read('Files', 'count'),
    linesOfLibrary: read('Lines of Library', 'count'),
    linesOfTypeScript: read('Lines of TypeScript', 'count'),
    identifiers: read('Identifiers', 'count'),
    symbols: read('Symbols', 'count'),
    types: read('Types', 'count'),
    instantiations: read('Instantiations', 'count'),
    memoryBytes: read('Memory used', 'memory'),
    parseMs: read('Parse time', 'time'),
    bindMs: read('Bind time', 'time'),
    checkMs: read('Check time', 'time'),
    totalMs: read('Total time', 'time'),
  }
}
