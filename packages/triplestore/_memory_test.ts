import type { DirectoryEntryType, FileStatType, FileSystemType, SignalOptionsType } from './storage.ts'

/** Injected write fault used by durability tests to simulate a crash during publication. */
export type WriteFaultType = (path: string, text: string, fs: MemoryFileSystem) => void | Promise<void>

/** Minimal in-memory filesystem for package-local durability tests. */
export class MemoryFileSystem implements FileSystemType {
  readonly files = new Map<string, string>()
  readonly directories = new Set<string>(['/'])
  writeFault: WriteFaultType | undefined

  async exists(path: string, options: SignalOptionsType = {}): Promise<boolean> {
    abort(options.signal)
    const normalized = normalize(path)
    return this.files.has(normalized) || this.directories.has(normalized)
  }

  async ensureDir(path: string, options: SignalOptionsType = {}): Promise<void> {
    abort(options.signal)
    const parts = normalize(path).split('/').filter(Boolean)
    let current = ''
    for (const part of parts) {
      current += `/${part}`
      this.directories.add(current)
    }
  }

  async *readDir(path: string, options: SignalOptionsType = {}): AsyncGenerator<DirectoryEntryType> {
    abort(options.signal)
    const root = normalize(path)
    const prefix = root === '/' ? '/' : `${root}/`
    const names = new Map<string, 'file' | 'directory'>()

    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue
      const rest = file.slice(prefix.length)
      if (rest && !rest.includes('/')) names.set(rest, 'file')
    }
    for (const directory of this.directories) {
      if (!directory.startsWith(prefix) || directory === root) continue
      const rest = directory.slice(prefix.length)
      if (rest && !rest.includes('/') && !names.has(rest)) names.set(rest, 'directory')
    }

    for (const [name, kind] of [...names].sort(([a], [b]) => a.localeCompare(b))) {
      abort(options.signal)
      yield { name, kind }
    }
  }

  async readText(path: string, options: SignalOptionsType = {}): Promise<string> {
    abort(options.signal)
    const value = this.files.get(normalize(path))
    if (value === undefined) throw new Error(`ENOENT ${path}`)
    return value
  }

  async stat(path: string, options: SignalOptionsType = {}): Promise<FileStatType | { readonly kind: 'directory' }> {
    abort(options.signal)
    const normalized = normalize(path)
    const file = this.files.get(normalized)
    if (file !== undefined) return { kind: 'file', size: new TextEncoder().encode(file).byteLength }
    if (this.directories.has(normalized)) return { kind: 'directory' }
    throw new Error(`ENOENT ${path}`)
  }

  async writeFile(
    path: string,
    data: string | Uint8Array,
    options: SignalOptionsType & { readonly parents?: boolean } = {},
  ): Promise<void> {
    abort(options.signal)
    const normalized = normalize(path)
    if (options.parents) await this.ensureDir(dirname(normalized), options)
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
    if (this.writeFault) await this.writeFault(normalized, text, this)
    this.files.set(normalized, text)
  }
}

/** Normalizes the intentionally small absolute virtual path model used by this fixture. */
function normalize(path: string): string {
  if (!path.startsWith('/')) throw new TypeError('path must be absolute')
  return path.length > 1 ? path.replace(/\/+$/g, '') : path
}

/** Returns the parent path for the fixture's absolute path representation. */
function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}

/** Applies cooperative cancellation consistently across fixture operations. */
function abort(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}
