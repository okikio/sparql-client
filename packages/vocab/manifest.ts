/** Generated vocabulary manifest creation. @module */

import type { ManifestType, VocabularyModelType } from './model.ts'
import type { NamePlanType } from './name.ts'

/** Creates the reproducible manifest stored beside generated vocabulary output. */
export function createManifest(
  vocabulary: string,
  model: VocabularyModelType,
  names: NamePlanType,
  generator = '@okikio/vocab/0.1.0',
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
