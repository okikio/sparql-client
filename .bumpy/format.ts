/** Keeps authored release explanations readable instead of flattening them into commit bullets. @module */
import type { ChangelogContext, ChangelogFormatter } from 'npm:@varlock/bumpy@1.18.1'

/** Renders the shared authored story once for each affected package release. */
export default function create(): ChangelogFormatter {
  return format
}

/** Renders one authored package release without flattening its examples. */
function format(context: ChangelogContext): string {
  const { release, bumpFiles, date } = context
  const stories = bumpFiles.filter((file) =>
    release.bumpFiles.includes(file.id) && !file.noChangelog &&
    !file.releases.find((entry) => entry.name === release.name)?.noChangelog
  )
    .map((file) => file.summary.trim()).filter(Boolean)
  const dependencies = release.bumpSources.map((source) =>
    `\`${source.name}@${source.newVersion}\``
  )
  const propagation = dependencies.length
    ? `This release uses ${
      dependencies.join(', ')
    }. Upgrade the related packages together to use the same public contracts.`
    : ''
  return [
    `## ${release.newVersion}`,
    '',
    date,
    '',
    ...stories.flatMap((story) => [story, '']),
    propagation,
    '',
  ].join('\n')
}
