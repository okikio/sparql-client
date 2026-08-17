/** Minimal durable file contract required by the triplestore. @module */

/** File metadata required for bounded recovery reads. */
export interface FileStatType {
  readonly kind: 'file'
  readonly size: number
}

/** Directory entry required while discovering immutable commit records. */
export interface DirectoryEntryType {
  readonly name: string
  readonly kind: 'file' | 'directory'
}

/** Options shared by storage operations that can be cancelled. */
export interface SignalOptionsType {
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
  exists(path: string, options?: SignalOptionsType): Promise<boolean>
  ensureDir(path: string, options?: SignalOptionsType): Promise<void>
  readDir(path: string, options?: SignalOptionsType): AsyncIterable<DirectoryEntryType>
  readText(path: string, options?: SignalOptionsType): Promise<string>
  stat(path: string, options?: SignalOptionsType): Promise<FileStatType | { readonly kind: 'directory' }>
  writeFile(
    path: string,
    data: string | Uint8Array,
    options?: SignalOptionsType & { readonly parents?: boolean },
  ): Promise<void>
}
