import { bench, do_not_optimize } from 'mitata'
import { expectTokens } from '../../../bench/oracle.ts'
import { report } from '../../../bench/report.ts'
import { inspect, tokens } from './mod.ts'

const rows = Array.from(
  { length: 10_000 },
  (_, index) => `?s${index} <https://example/p> "value-${index}" .`,
).join('\n')
const query = `VERSION "1.2"\nSELECT * WHERE {\n${rows}\n}`

/** Both API shapes must preserve every token and its exact source range before timing. */
const streamed = []
for await (const token of tokens(query)) streamed.push(token)
const document = await inspect(query)
if (
  streamed.length !== 40_007 || document.version !== '1.2' ||
  document.diagnostics.length !== 0 ||
  streamed.some((token) => query.slice(token.range.start, token.range.end) !== token.raw)
) {
  throw new Error('SPARQL syntax benchmark token/range oracle failed.')
}
expectTokens(streamed, document.tokens, 'SPARQL streamed/document tokens')
for (let index = 0; index < 10_000; index++) {
  const start = 6 + index * 4
  if (
    streamed[start]?.kind !== 'variable' || streamed[start + 1]?.kind !== 'iri' ||
    streamed[start + 2]?.kind !== 'string' || streamed[start + 3]?.kind !== 'punctuation' ||
    streamed[start]?.raw !== `?s${index}` ||
    streamed[start + 1]?.raw !== '<https://example/p>' ||
    streamed[start + 2]?.raw !== `"value-${index}"` || streamed[start + 3]?.raw !== '.'
  ) throw new Error(`SPARQL syntax benchmark triple ${index} differs.`)
}

bench('sparql syntax tokens: 10k triple patterns', async () => {
  let count = 0
  for await (const _token of tokens(query)) count++
  do_not_optimize(count)
})

bench('sparql syntax inspect: 10k triple patterns', async () => {
  do_not_optimize((await inspect(query)).tokens.length)
})

await report()
