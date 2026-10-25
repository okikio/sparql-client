/** Verifies that a cached upstream fixture checkout still matches its pinned revision. @module */

/**
 * Refuses changed caches rather than overwriting possibly useful fixture edits. The revision marker
 * is owned by the sync task and is the only untracked path excluded. Git HEAD, reported extra
 * paths, and every tracked blob are checked each time. Index flags and cached modification times
 * cannot hide changed fixture bytes. Pinned checkouts must preserve raw Git blob bytes; checkout
 * filters or line-ending conversion require a fresh unfiltered checkout rather than normalization.
 */
export async function checkCache(directory: string, revision: string): Promise<void> {
  const head = (await git(directory, ['rev-parse', 'HEAD'])).trim()
  if (head !== revision) {
    throw new Error(
      `Conformance cache ${directory} has HEAD ${head}, expected ${revision}. Preserve needed edits and remove the cache directory before resyncing.`,
    )
  }
  const status = (await git(directory, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--ignored=matching',
  ]))
    .split('\n').filter((line) => line !== '' && line !== '?? .revision')
  if (status.length) {
    throw new Error(
      `Conformance cache ${directory} has modified or extra fixture files (${status.length} paths). Preserve needed edits and remove the cache directory before resyncing.`,
    )
  }
  const tree = (await git(directory, ['ls-tree', '-r', '-z', 'HEAD'])).split('\0').filter(Boolean)
  // Four files bound concurrent reads and digest allocations, even for large upstream suites.
  for (let index = 0; index < tree.length; index += 4) {
    const results = await Promise.allSettled(
      tree.slice(index, index + 4).map(async (entry) => {
        const tab = entry.indexOf('\t')
        const [mode, kind, object] = entry.slice(0, tab).split(' ')
        const path = entry.slice(tab + 1)
        if (
          tab < 0 || kind !== 'blob' || !object ||
          !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(object) ||
          !['100644', '100755', '120000'].includes(mode ?? '')
        ) throw new Error(`Conformance cache ${directory} has an unsupported tracked tree entry.`)
        const filename = `${directory}/${path}`
        const info = await Deno.lstat(filename)
        const symlink = mode === '120000'
        if (symlink ? !info.isSymlink : !info.isFile || info.isSymlink) {
          throw new Error(`Conformance cache ${directory} changes tracked file kind: ${path}.`)
        }
        const bytes = symlink
          ? new TextEncoder().encode(await Deno.readLink(filename))
          : await Deno.readFile(filename)
        const prefix = new TextEncoder().encode(`blob ${bytes.length}\0`)
        const payload = new Uint8Array(prefix.length + bytes.length)
        payload.set(prefix)
        payload.set(bytes, prefix.length)
        const digest = [
          ...new Uint8Array(
            await crypto.subtle.digest(object.length === 40 ? 'SHA-1' : 'SHA-256', payload),
          ),
        ].map((byte) => byte.toString(16).padStart(2, '0')).join('')
        if (digest !== object) {
          throw new Error(
            `Conformance cache ${directory} has changed raw fixture bytes: ${path}. Preserve needed edits and remove the cache directory before an unfiltered resync.`,
          )
        }
      }),
    )
    const failures = results.filter((result) => result.status === 'rejected').map((result) =>
      result.reason
    )
    if (failures.length) {
      throw new AggregateError(failures, `Conformance cache ${directory} differs from pinned tree.`)
    }
  }
}

async function git(directory: string, args: readonly string[]): Promise<string> {
  const result = await new Deno.Command('git', {
    args: ['-c', 'core.fsmonitor=false', '-C', directory, ...args],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!result.success) {
    throw new Error(
      `Cannot inspect conformance cache ${directory}: ${
        new TextDecoder().decode(result.stderr).trim()
      }`,
    )
  }
  return new TextDecoder().decode(result.stdout)
}
