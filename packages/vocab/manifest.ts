/** Generated vocabulary manifest creation. @module */

import type { ManifestType, VocabularyModelType } from './model.ts'
import type { NamePlanType } from './name.ts'
import metadata from './package.json' with { type: 'json' }

/**
 * Creates the reproducible manifest stored beside generated vocabulary output.
 *
 * New output identifies this producer and its declared version. JSR's npm
 * compatibility archive replaces the transport package name with an `@jsr`
 * name, so only the version comes from package metadata. An explicit generator
 * preserves caller-selected provenance when reconstructing historical output;
 * existing saved manifests retain the version that originally produced them.
 */
export function createManifest(
  vocabulary: string,
  model: VocabularyModelType,
  names: NamePlanType,
  generator = `@okikio/vocab/${metadata.version}`,
): ManifestType {
  return {
    version: 1,
    generator,
    vocabulary,
    sources: model.sources,
    symbols: names.symbols,
    diagnostics: model.diagnostics,
  }
}
