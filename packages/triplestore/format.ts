/** Persistent triplestore format records and validation. @module */

/** Current on-disk store format. */
export const FORMAT_VERSION = 3 as const
/** Current immutable segment format. */
export const SEGMENT_VERSION = 2 as const

/** Root format marker written once when a store is created. */
export interface FormatType {
  /** On-disk triplestore format revision used to validate this commit record. */
  readonly version: 2 | typeof FORMAT_VERSION
  /** Fixed package identifier that prevents another file format from being opened as a triplestore. */
  readonly store: '@okikio/triplestore'
  /** Immutable segment encoding revision required to interpret generation payloads. */
  readonly segment: typeof SEGMENT_VERSION
  /** Migration destinations require a matching readiness receipt before ordinary open. */
  readonly migration?: MigrationType
}

/** Persisted migration admission identity; a complete snapshot alone is not readiness. */
export interface MigrationType {
  /** Stable identity shared by migration intent and its readiness receipt. */
  readonly operation: string
  /** Caller-exclusive source root retained unchanged. */
  readonly source: string
  /** Caller-exclusive new root selected by this migration. */
  readonly destination: string
  /** Verified source protocol, namespace and head identity. */
  readonly sourceFingerprint: string
}

/** Immutable readiness proof for the initial migration snapshot, never the latest head. */
export interface ReadyType {
  /** Exact persisted migration admission identity. */
  readonly migration: MigrationType
  /** Initial migration snapshot generation, not the current dataset head. */
  readonly generation: number
  /** SHA-256 of the initial snapshot commit bytes. */
  readonly commit: string
  /** SHA-256 of the initial snapshot segment bytes. */
  readonly segment: string
  /** Validated initial snapshot cardinality. */
  readonly quadCount: number
}

/** One immutable committed generation. */
export interface CommitType {
  /** On-disk triplestore format revision used to validate this commit record. */
  readonly version: 2 | typeof FORMAT_VERSION
  /** Monotonic publication generation, including gaps above occupied damaged history. */
  readonly generation: number
  /** Trusted parent required for delta replay; snapshot parent records provenance only. */
  readonly parent: number
  /** Commit mode that determines whether the segment is a snapshot or delta. */
  readonly mode: 'delta' | 'snapshot'
  /** Homogeneous mutation encoded by a delta segment. Snapshots omit it. */
  readonly operation?: 'add' | 'delete'
  /** Segment filename containing the serialized operations for this commit. */
  readonly segment: string
  /** SHA-256 checksum used to detect torn or corrupted segment contents during recovery. */
  readonly checksum: string
  /** Expected dataset quad count after this commit is applied. */
  readonly quadCount: number
}

/** Stable format record for newly created stores. */
export const FORMAT: FormatType = {
  version: FORMAT_VERSION,
  store: '@okikio/triplestore',
  segment: SEGMENT_VERSION,
}

/** Parses and validates the root format marker. */
export function parseFormat(text: string): FormatType {
  const value = parseRecord(text, 'format')
  if (
    (value.version !== 2 && value.version !== FORMAT_VERSION) ||
    value.store !== '@okikio/triplestore' || value.segment !== SEGMENT_VERSION
  ) {
    throw new TypeError('Unsupported triplestore format.')
  }
  if (value.migration !== undefined) {
    if (value.version !== 3) {
      throw new TypeError('Legacy format cannot contain migration admission.')
    }
    const migration = parseMigration(value.migration)
    return { version: 3, store: '@okikio/triplestore', segment: 2, migration }
  }
  return { version: value.version, store: '@okikio/triplestore', segment: 2 }
}

/** Validates persisted operation identities without accepting an untyped override flag. */
export function parseMigration(value: unknown): MigrationType {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Invalid migration intent.')
  }
  const record = value as Record<string, unknown>
  if (
    typeof record.operation !== 'string' || !record.operation ||
    typeof record.source !== 'string' || typeof record.destination !== 'string' ||
    typeof record.sourceFingerprint !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(record.sourceFingerprint)
  ) throw new TypeError('Invalid migration identity.')
  return {
    operation: record.operation,
    source: record.source,
    destination: record.destination,
    sourceFingerprint: record.sourceFingerprint,
  }
}

/** Reads readiness for exactly the identified initial snapshot, allowing later valid history. */
export function parseReady(text: string): ReadyType {
  const record = parseRecord(text, 'readiness')
  const migration = parseMigration(record.migration)
  if (
    !isInteger(record.generation) || record.generation < 1 || !isInteger(record.quadCount) ||
    record.quadCount < 0 || typeof record.commit !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(record.commit) || typeof record.segment !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(record.segment)
  ) throw new TypeError('Invalid migration readiness.')
  return {
    migration,
    generation: record.generation,
    commit: record.commit,
    segment: record.segment,
    quadCount: record.quadCount,
  }
}

/** Parses and validates one immutable commit record. */
export function parseCommit(text: string): CommitType {
  const value = parseRecord(text, 'commit')
  if (value.version !== 2 && value.version !== FORMAT_VERSION) {
    throw new VersionError(`Unsupported commit version '${String(value.version)}'.`)
  }
  if (!isInteger(value.generation) || value.generation < 1) {
    throw new TypeError('Commit generation must be a positive safe integer.')
  }
  if (
    !isInteger(value.parent) || value.parent < 0 || value.parent >= value.generation ||
    (value.version === 2 && value.parent !== value.generation - 1)
  ) {
    throw new TypeError(
      'Commit parent must precede generation; legacy ancestry must be contiguous.',
    )
  }
  if (value.mode !== 'delta' && value.mode !== 'snapshot') {
    throw new TypeError(`Unknown commit mode '${String(value.mode)}'.`)
  }
  if (
    typeof value.segment !== 'string' ||
    !/^segments\/[0-9]{16}(?:\.delta)?\.nq$/.test(value.segment)
  ) throw new TypeError('Commit segment path is invalid.')
  if (value.mode === 'delta' && value.operation !== 'add' && value.operation !== 'delete') {
    throw new TypeError(`Delta commit operation must be 'add' or 'delete'.`)
  }
  if (value.mode === 'snapshot' && value.operation !== undefined) {
    throw new TypeError('Snapshot commit must not declare an operation.')
  }
  if (typeof value.checksum !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value.checksum)) {
    throw new TypeError('Commit checksum is invalid.')
  }
  if (!isInteger(value.quadCount) || value.quadCount < 0) {
    throw new TypeError('Commit quadCount must be a non-negative safe integer.')
  }
  return {
    version: value.version,
    generation: value.generation,
    parent: value.parent,
    mode: value.mode,
    ...(value.mode === 'delta' ? { operation: value.operation as 'add' | 'delete' } : {}),
    segment: value.segment,
    checksum: value.checksum,
    quadCount: value.quadCount,
  }
}

/** Serializes a record with stable key ordering and trailing newline. */
export function writeRecord(value: FormatType | CommitType | ReadyType): string {
  return `${JSON.stringify(value)}\n`
}

/** Formats a generation as a lexicographically sortable file stem. */
export function generationName(generation: number): string {
  if (!isInteger(generation) || generation < 1) {
    throw new RangeError('generation must be a positive safe integer.')
  }
  return generation.toString().padStart(16, '0')
}

/** Parse record from the current source according to the package grammar contract. */
function parseRecord(text: string, label: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (cause) {
    throw new TypeError(`Invalid triplestore ${label} JSON.`, { cause })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`Triplestore ${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

/** Returns whether the supplied value satisfies the integer contract. */
function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

/** Unsupported complete commit protocols are fatal; they are not torn publication diagnostics. */
export class VersionError extends TypeError {}
