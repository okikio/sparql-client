import * as sparql from '@okikio/sparql'
import * as http from '@okikio/sparql/http'

const query = sparql.select(['?product', '?name'])
  .prefix('schema', 'https://schema.org/')
  .where(sparql.triple('?product', 'schema:name', '?name'))
  .orderBy('?name')
  .limit(25)

console.log(query.build().value)

const client = http.create({ endpoint: 'https://example.com/sparql' })
void client
