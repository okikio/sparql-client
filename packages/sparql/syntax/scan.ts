/** Version-aware semantic events over the data-oriented SPARQL scanner. @module */

import { KindType, Scanner, SyntaxScanError } from './scanner.ts'
import type {
  DiagnosticType,
  DocumentType,
  EventType,
  FeatureEventType,
  FeatureType,
  OptionsType,
  RangeType,
  SourceType,
  TokenType,
  VersionEventType,
  VersionType,
} from './types.ts'

/** Default max tokens used when the caller does not provide an override. */
const DEFAULT_MAX_TOKENS = 10_000_000
/** SPARQL 1.2 functions that imply the triple-term feature when encountered during syntax inspection. */
const TRIPLE_FUNCTIONS = new Set(['TRIPLE', 'ISTRIPLE', 'SUBJECT', 'PREDICATE', 'OBJECT'])
/** SPARQL 1.2 functions that imply directional-language support during syntax inspection. */
const DIRECTION_FUNCTIONS = new Set(['LANGDIR', 'HASLANG', 'HASLANGDIR', 'STRLANGDIR'])
/** Version labels accepted by the current syntax inspection contract. */
const VERSIONS = new Set<VersionType>(['1.1', '1.2-basic', '1.2'])

export { SyntaxScanError } from './scanner.ts'

/** Emits source-ranged lexical tokens, version announcements, features, and diagnostics. */
export async function* events(
  source: SourceType,
  options: OptionsType = {},
): AsyncGenerator<EventType> {
  const scanner = new Scanner(source, options)
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS
  let tokenCount = 0
  let externalVersion = options.version
  let effectiveVersion = externalVersion
  let hasVersionDirective = false
  let pendingVersion: TokenType | undefined

  try {
    while (true) {
      let token: TokenType
      try {
        await scanner.next()
        if (scanner.kind === KindType.Eof) break
        token = scanner.token()
      } catch (error) {
        if (!(error instanceof SyntaxScanError) || !options.tolerant) throw error
        yield {
          kind: 'diagnostic',
          diagnostic: diagnostic(error.code, error.message, 'error', error.range),
        }
        break
      }

      if (scanner.kind === KindType.Unknown) {
        const issue = diagnostic(
          'sparql-token',
          `Unrecognized SPARQL token ${JSON.stringify(token.raw)}.`,
          'error',
          token.range,
        )
        if (!options.tolerant) throw new SyntaxScanError(issue.code, issue.message, issue.range)
        yield { kind: 'diagnostic', diagnostic: issue }
        continue
      }

      if (token.kind !== 'whitespace' && token.kind !== 'comment') {
        tokenCount++
        if (tokenCount > maxTokens) {
          const issue = diagnostic(
            'sparql-token-count',
            `SPARQL source exceeds ${maxTokens} tokens.`,
            'error',
            token.range,
          )
          if (!options.tolerant) throw new SyntaxScanError(issue.code, issue.message, issue.range)
          yield { kind: 'diagnostic', diagnostic: issue }
          return
        }
      }

      yield { kind: 'token', token }

      if (pendingVersion && token.kind !== 'whitespace' && token.kind !== 'comment') {
        hasVersionDirective = true
        externalVersion = undefined
        if (token.kind !== 'string' || isLongString(token.raw)) {
          const issue = diagnostic(
            'sparql-version-value',
            'VERSION must be followed by a short quoted version string.',
            'error',
            merge(pendingVersion.range, token.range),
          )
          yield { kind: 'diagnostic', diagnostic: issue }
          effectiveVersion = undefined
        } else {
          const recognized = VERSIONS.has(token.value as VersionType)
            ? token.value as VersionType
            : undefined
          const versionEvent = version(
            token.value,
            recognized,
            merge(pendingVersion.range, token.range),
          )
          yield versionEvent
          if (!recognized) {
            yield {
              kind: 'diagnostic',
              diagnostic: diagnostic(
                'sparql-version-unknown',
                `Unrecognized SPARQL version label ${JSON.stringify(token.value)}.`,
                'warning',
                token.range,
              ),
            }
            effectiveVersion = undefined
          } else {
            effectiveVersion = recognized
          }
        }
        pendingVersion = undefined
        continue
      }

      if (token.kind === 'keyword' && token.value === 'VERSION') {
        pendingVersion = token
        continue
      }

      const feature = getFeature(token)
      if (!feature) continue
      const featureEvent: FeatureEventType = { kind: 'feature', feature, range: token.range }
      yield featureEvent

      const issue = getCompatibilityDiagnostic(
        feature,
        hasVersionDirective ? effectiveVersion : externalVersion,
        token.range,
      )
      if (issue) yield { kind: 'diagnostic', diagnostic: issue }
    }

    if (pendingVersion) {
      const issue = diagnostic(
        'sparql-version-value',
        'VERSION is missing its quoted version label.',
        'error',
        pendingVersion.range,
      )
      if (!options.tolerant) throw new SyntaxScanError(issue.code, issue.message, issue.range)
      yield { kind: 'diagnostic', diagnostic: issue }
    }
  } finally {
    await scanner.close()
  }
}

/** Emits only lexical tokens while preserving the same scanner and cancellation behavior. */
export async function* tokens(
  source: SourceType,
  options: OptionsType = {},
): AsyncGenerator<TokenType> {
  for await (const event of events(source, options)) {
    if (event.kind === 'token') yield event.token
  }
}

/** Materializes the event stream without claiming to produce a full SPARQL AST. */
export async function inspect(
  source: SourceType,
  options: OptionsType = {},
): Promise<DocumentType> {
  const foundTokens: TokenType[] = []
  const diagnostics: DiagnosticType[] = []
  const versions: VersionEventType[] = []
  const features: FeatureEventType[] = []

  for await (const event of events(source, options)) {
    switch (event.kind) {
      case 'token':
        foundTokens.push(event.token)
        break
      case 'diagnostic':
        diagnostics.push(event.diagnostic)
        break
      case 'version':
        versions.push(event)
        break
      case 'feature':
        features.push(event)
        break
    }
  }

  const version = versions.length > 0 ? versions.at(-1)?.version : options.version
  return version === undefined
    ? { tokens: foundTokens, diagnostics, versions, features }
    : { tokens: foundTokens, diagnostics, versions, features, version }
}

/** Maps one token to the compatibility feature it directly introduces. */
function getFeature(token: TokenType): FeatureType | undefined {
  if (token.kind === 'langDir' && token.value.includes('--')) return 'directional-literal'
  if (token.kind === 'marker') {
    if (token.raw === '<<(') return 'triple-term'
    if (token.raw === '<<') return 'reified-triple'
    if (token.raw === '{|') return 'annotation'
    if (token.raw === '~') return 'reifier'
  }
  if (token.kind === 'keyword' && TRIPLE_FUNCTIONS.has(token.value)) return 'triple-function'
  if (token.kind === 'keyword' && DIRECTION_FUNCTIONS.has(token.value)) return 'direction-function'
  return undefined
}

/** Returns a version compatibility diagnostic only when an effective version is known. */
function getCompatibilityDiagnostic(
  feature: FeatureType,
  version: VersionType | undefined,
  range: RangeType,
): DiagnosticType | undefined {
  if (!version || version === '1.2') return undefined

  if (version === '1.2-basic') {
    if (
      feature !== 'triple-term' && feature !== 'reified-triple' && feature !== 'triple-function'
    ) return undefined
    return diagnostic(
      'sparql-version-feature',
      `SPARQL ${version} does not permit the observed ${feature} syntax.`,
      'error',
      range,
    )
  }

  return diagnostic(
    'sparql-version-feature',
    `SPARQL 1.1 does not permit the observed ${feature} syntax.`,
    'error',
    range,
  )
}

/** Maps a VERSION token to the supported syntax profile used by feature diagnostics. */
function version(
  label: string,
  value: VersionType | undefined,
  range: RangeType,
): VersionEventType {
  return value === undefined
    ? { kind: 'version', label, range }
    : { kind: 'version', label, version: value, range }
}

/** Creates one source-ranged syntax diagnostic without throwing from tolerant inspection. */
function diagnostic(
  code: string,
  message: string,
  severity: DiagnosticType['severity'],
  range: RangeType,
): DiagnosticType {
  return { code, message, severity, range }
}

/** Merges adjacent token ranges when one syntax event spans multiple lexical tokens. */
function merge(start: RangeType, end: RangeType): RangeType {
  return {
    start: start.start,
    end: end.end,
    line: start.line,
    column: start.column,
    endLine: end.endLine,
    endColumn: end.endColumn,
  }
}

/** Returns whether the supplied value satisfies the long string contract. */
function isLongString(raw: string): boolean {
  return raw.startsWith("'''") || raw.startsWith('"""')
}
