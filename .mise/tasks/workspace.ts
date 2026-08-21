/** Resolves concrete package directories from the root Deno workspace declaration. @module */

/** Returns sorted workspace package directories, expanding a trailing `/*` member glob. */
export async function get(): Promise<string[]> {
  const root = JSON.parse(await Deno.readTextFile('deno.json')) as { workspace?: unknown }
  if (!Array.isArray(root.workspace)) throw new TypeError('deno.json workspace must be an array.')
  const members: string[] = []
  for (const value of root.workspace) {
    const member = String(value).replace(/^\.\//u, '')
    if (!member.endsWith('/*')) { members.push(member); continue }
    const parent = member.slice(0, -2)
    for await (const entry of Deno.readDir(parent)) {
      if (entry.isDirectory) members.push(`${parent}/${entry.name}`)
    }
  }
  return members.sort()
}
