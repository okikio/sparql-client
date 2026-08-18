/** Minimal durable file contract required by the triplestore. @module */

/** File metadata required for bounded recovery reads. */
export interface FileStatType {
  /** Identifies metadata for a file rather than a directory. */
  readonly kind: 'file'
  /** File size in bytes reported by the injected filesystem. */
  readonly size: number
}

/** Directory entry required while discovering immutable commit records. */
export interface DirectoryEntryType {
  /** Direct child name returned by directory iteration. */
  readonly name: string
  /** Identifies whether the direct child is a file or directory. */
  readonly kind: 'file' | 'directory'
}

/** Options shared by storage operations that can be cancelled. */
export interface SignalOptionsType {
  /** Caller-owned abort signal checked before expensive work and between long-running steps. */
  readonly signal?: AbortSignal
}

/**
 * Structural filesystem contract consumed by `@okikio/triplestore`.
 *
 * `@okikio/opfs` `FileSystemType` satisfies this contract. Keeping the public
 * dependency structural lets the store borrow compatible filesystems without
 * importing or initializing a concrete runtime adapter.
 */
export interface FileSystemType {
  /** Returns whether the requested file or directory currently exists. */
  exists(path: string, options?: SignalOptionsType): Promise<boolean>
  /** Ensures the requested directory and its parents exist before a durable write. */
  ensureDir(path: string, options?: SignalOptionsType): Promise<void>
  /** Iterates direct directory entries without requiring the store to materialize the complete tree. */
  readDir(path: string, options?: SignalOptionsType): AsyncIterable<DirectoryEntryType>
  /** Reads one durable store record as UTF-8 text. Segment size checks happen before this call. */
  readText(path: string, options?: SignalOptionsType): Promise<string>
  /** Returns file metadata used for recovery checks and segment validation. */
  stat(path: string, options?: SignalOptionsType): Promise<
    FileStatType | {
      /** Selects the `directory` variant of FileSystemType. */
      readonly kind: 'directory'
    }
  >
  /** Writes one complete durable file while preserving the caller-owned filesystem lifecycle. */
  writeFile(
    path: string,
    data: string | Uint8Array,
    options?: SignalOptionsType & {
      /** Whether missing parent directories are created before the write. */
      readonly parents?: boolean
    },
  ): Promise<void>
}
