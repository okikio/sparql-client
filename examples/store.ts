import * as rdf from '@okikio/rdf'
import { type FileSystemType, open } from '@okikio/triplestore'

export async function saveExample(fileSystem: FileSystemType): Promise<void> {
  await using store = await open(fileSystem, { path: '/knowledge' })
  await store.add(rdf.quad(
    rdf.namedNode('https://example.com/products/1'),
    rdf.namedNode('https://schema.org/name'),
    rdf.literal('Widget'),
  ))
}
