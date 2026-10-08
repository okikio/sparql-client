/** Bounded native host workloads; conformance and speed observations remain separate. @module */
import { bench, do_not_optimize } from 'mitata'
import { report } from '../../../bench/report.ts'
import { parseHtml } from './html.ts'
import { parseXml } from './xml.ts'
import { textContent } from './model.ts'

const count = 1000, options = { maxNodes: 100_000, maxDepth: 512 }
const html = `<div>${'<p>&eacute; &NotEqualTilde; &#x80;</p>'.repeat(count)}</div>`
const xml = `<a>${'<b>A\r\nB&#x9;C</b>'.repeat(count)}</a>`
for (
  const [label, source, parse, expected] of [
    ['HTML references / 1,000 elements', html, parseHtml, 'é ≂̸ €'.repeat(count)],
    ['XML normalization / 1,000 elements', xml, parseXml, 'A\nB\tC'.repeat(count)],
  ] as const
) {
  const document = parse(source, options),
    root = document.children.find((node) => node.kind === 'element')!
  if (root.kind !== 'element' || textContent(root) !== expected) {
    throw new Error(`Host semantic oracle differs: ${label}`)
  }
  bench(`rdf host: ${label}`, () => do_not_optimize(parse(source, options)))
}
await report()
