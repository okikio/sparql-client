/**
 * Admits one already canonical, absolute parent as Git's discovery ceiling.
 *
 * Git for Windows separates ceiling entries with semicolons; a drive-letter colon
 * is part of a single path. Unix Git uses colons. This function neither resolves
 * paths nor selects a repository or grants an ownership exception.
 */
export function ceiling(parent: string, windows: boolean): string {
  const separator = windows ? ';' : ':'
  if (!parent || parent.includes(separator)) {
    throw new RangeError('Checkout parent cannot be represented as one Git discovery ceiling.')
  }
  return parent
}
