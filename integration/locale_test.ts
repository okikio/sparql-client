import { it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { expect } from '@std/expect'

it('compiles identical vocabulary artifacts in independently localized processes', async () => {
  const outputs: { locale: string; result: unknown }[] = []
  for (const locale of ['en_US.UTF-8', 'sv_SE.UTF-8']) {
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        'run',
        '--no-check',
        '--cached-only',
        '--no-lock',
        fileURLToPath(new URL('./locale.ts', import.meta.url)),
      ],
      env: { LANG: locale, LC_ALL: locale },
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    expect(result.code).toBe(0)
    outputs.push(JSON.parse(new TextDecoder().decode(result.stdout)))
  }
  // The environment must actually change collation for this to be independent proof.
  expect(outputs[0]?.locale).not.toBe(outputs[1]?.locale)
  expect(outputs[0]?.result).toEqual(outputs[1]?.result)
})
