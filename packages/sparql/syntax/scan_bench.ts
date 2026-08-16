import { bench, run } from 'mitata'
import { inspect, tokens } from './mod.ts'

const rows = Array.from(
  { length: 10_000 },
  (_, index) => `?s${index} <https://example/p> "value-${index}" .`,
).join('\n')
const query = `VERSION "1.2"\nSELECT * WHERE {\n${rows}\n}`

bench('sparql syntax tokens: 10k triple patterns', async () => {
  let count = 0
  for await (const _token of tokens(query)) count++
  return count
})

bench('sparql syntax inspect: 10k triple patterns', async () => {
  return (await inspect(query)).tokens.length
})

await run()
