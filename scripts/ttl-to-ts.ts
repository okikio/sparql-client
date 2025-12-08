/**
 * TTL to TypeScript Type Generator
 * 
 * Starter implementation that parses TTL ontologies and generates TypeScript types.
 * 
 * Usage:
 * ```bash
 * deno run --allow-read --allow-write scripts/ttl-to-ts.ts \
 *  --input infra/blazegraph/data/narrative.ttl \
 *  --output types/narrative
 * ```
 */

// @deno-types=npm:@types/n3@^1.26.0
import { Parser, Store, DataFactory, Quad } from 'npm:n3@^1.26.0'
const { namedNode } = DataFactory

// ============================================================================
// Type Definitions
// ============================================================================

interface ClassInfo {
  uri: string
  label: string
  comment?: string
  properties: PropertyInfo[]
  superClasses: string[]
}

interface PropertyInfo {
  uri: string
  label: string
  comment?: string
  domain: string[]
  range: string[]
  minCardinality?: number
  maxCardinality?: number
  functional: boolean  // OWL functional property
}

interface OntologyInfo {
  classes: ClassInfo[]
  properties: PropertyInfo[]
  prefixes: Map<string, string>
}

// ============================================================================
// TTL Parser
// ============================================================================

async function parseTTL(ttlContent: string): Promise<OntologyInfo> {
  const parser = new Parser()
  const store = new Store()

  // Parse TTL into RDF quads
  const quads = parser.parse(ttlContent)
  quads.forEach(quad => store.addQuad(quad))

  // Extract prefixes
  const prefixes = extractPrefixes(ttlContent)

  // Extract classes
  const classUris = extractClassURIs(store)
  const classes = classUris.map(uri => extractClassInfo(store, uri))

  // Extract properties
  const propertyUris = extractPropertyURIs(store)
  const properties = propertyUris.map(uri => extractPropertyInfo(store, uri))

  // Attach properties to classes
  for (const cls of classes) {
    cls.properties = properties.filter(prop =>
      prop.domain.includes(cls.uri)
    )
  }

  return { classes, properties, prefixes }
}

function extractPrefixes(ttlContent: string): Map<string, string> {
  const prefixes = new Map<string, string>()
  const lines = ttlContent.split('\n')

  for (const line of lines) {
    const match = line.match(/@prefix\s+(\w+):\s+<([^>]+)>/)
    if (match) {
      prefixes.set(match[1], match[2])
    }
  }

  return prefixes
}

function extractClassURIs(store: Store): string[] {
  const classes = new Set<string>()

  // RDFS classes
  store.getQuads(null, namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), namedNode('http://www.w3.org/2000/01/rdf-schema#Class'), null)
    .forEach(quad => classes.add(quad.subject.value))

  // OWL classes
  store.getQuads(null, namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), namedNode('http://www.w3.org/2002/07/owl#Class'), null)
    .forEach(quad => classes.add(quad.subject.value))

  return Array.from(classes)
}

function extractPropertyURIs(store: Store): string[] {
  const properties = new Set<string>()

  // RDF properties
  store.getQuads(null, namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#Property'), null)
    .forEach(quad => properties.add(quad.subject.value))

  // OWL object properties
  store.getQuads(null, namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), namedNode('http://www.w3.org/2002/07/owl#ObjectProperty'), null)
    .forEach(quad => properties.add(quad.subject.value))

  // OWL datatype properties
  store.getQuads(null, namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), namedNode('http://www.w3.org/2002/07/owl#DatatypeProperty'), null)
    .forEach(quad => properties.add(quad.subject.value))

  return Array.from(properties)
}

function extractClassInfo(store: Store, classUri: string): ClassInfo {
  return {
    uri: classUri,
    label: getLiteral(store, classUri, 'http://www.w3.org/2000/01/rdf-schema#label') || extractLocalName(classUri),
    comment: getLiteral(store, classUri, 'http://www.w3.org/2000/01/rdf-schema#comment'),
    properties: [],  // Filled later
    superClasses: getSuperClasses(store, classUri)
  }
}

function extractPropertyInfo(store: Store, propUri: string): PropertyInfo {
  return {
    uri: propUri,
    label: getLiteral(store, propUri, 'http://www.w3.org/2000/01/rdf-schema#label') || extractLocalName(propUri),
    comment: getLiteral(store, propUri, 'http://www.w3.org/2000/01/rdf-schema#comment'),
    domain: getURIs(store, propUri, 'http://www.w3.org/2000/01/rdf-schema#domain'),
    range: getURIs(store, propUri, 'http://www.w3.org/2000/01/rdf-schema#range'),
    functional: isFunctionalProperty(store, propUri),
    minCardinality: undefined,  // Could be extracted from OWL/SHACL
    maxCardinality: undefined
  }
}

function getSuperClasses(store: Store, classUri: string): string[] {
  return store.getQuads(namedNode(classUri), namedNode('http://www.w3.org/2000/01/rdf-schema#subClassOf'), null, null)
    .map(quad => quad.object.value)
}

function getLiteral(store: Store, subject: string, predicate: string): string | undefined {
  const quad = store.getQuads(namedNode(subject), namedNode(predicate), null, null)[0]
  return quad?.object.value
}

function getURIs(store: Store, subject: string, predicate: string): string[] {
  return store.getQuads(namedNode(subject), namedNode(predicate), null, null)
    .map(quad => quad.object.value)
}

function isFunctionalProperty(store: Store, propUri: string): boolean {
  return store.getQuads(
    namedNode(propUri),
    namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
    namedNode('http://www.w3.org/2002/07/owl#FunctionalProperty'),
    null
  ).length > 0
}

function extractLocalName(uri: string): string {
  const match = uri.match(/[#/]([^#/]+)$/)
  return match ? match[1] : uri
}

// ============================================================================
// Type Mapping
// ============================================================================

function mapXSDToTS(xsdType: string): string {
  const typeMap: Record<string, string> = {
    'http://www.w3.org/2001/XMLSchema#string': 'string',
    'http://www.w3.org/2001/XMLSchema#integer': 'number',
    'http://www.w3.org/2001/XMLSchema#int': 'number',
    'http://www.w3.org/2001/XMLSchema#long': 'number',
    'http://www.w3.org/2001/XMLSchema#decimal': 'number',
    'http://www.w3.org/2001/XMLSchema#float': 'number',
    'http://www.w3.org/2001/XMLSchema#double': 'number',
    'http://www.w3.org/2001/XMLSchema#boolean': 'boolean',
    'http://www.w3.org/2001/XMLSchema#date': 'Date',
    'http://www.w3.org/2001/XMLSchema#dateTime': 'Date',
    'http://www.w3.org/2001/XMLSchema#time': 'Date',
    'http://www.w3.org/2001/XMLSchema#anyURI': 'string',
  }

  return typeMap[xsdType] || 'string'
}

function mapRangeToTS(range: string[], prefixes: Map<string, string>): string {
  if (range.length === 0) {
    return 'string'
  }

  if (range.length === 1) {
    const r = range[0]

    // XSD datatype
    if (r.includes('XMLSchema#')) {
      return mapXSDToTS(r)
    }

    // Object property (reference to another class)
    const shortUri = shortenURI(r, prefixes)
    return `IRI<'${shortUri}'>`
  }

  // Union type
  return range.map(r => mapRangeToTS([r], prefixes)).join(' | ')
}

function shortenURI(uri: string, prefixes: Map<string, string>): string {
  for (const [prefix, namespace] of prefixes) {
    if (uri.startsWith(namespace)) {
      return `${prefix}:${uri.substring(namespace.length)}`
    }
  }
  return uri
}

// ============================================================================
// TypeScript Generator
// ============================================================================

function generateTypeScript(ontology: OntologyInfo): Map<string, string> {
  const files = new Map<string, string>()

  // Generate type for each class
  for (const cls of ontology.classes) {
    const fileName = `${cls.label}.ts`
    const content = generateClassInterface(cls, ontology.prefixes)
    files.set(fileName, content)
  }

  // Generate index file
  const indexContent = generateIndex(ontology.classes)
  files.set('index.ts', indexContent)

  return files
}

function generateClassInterface(cls: ClassInfo, prefixes: Map<string, string>): string {
  const shortUri = shortenURI(cls.uri, prefixes)

  // Generate JSDoc comment
  const jsdoc = cls.comment
    ? `/**\n * ${cls.comment}\n */\n`
    : ''

  // Generate properties
  const properties = cls.properties.map(prop => {
    const propShortUri = shortenURI(prop.uri, prefixes)
    const tsType = mapRangeToTS(prop.range, prefixes)
    const isArray = !prop.functional && (prop.maxCardinality === undefined || prop.maxCardinality > 1)
    const optional = prop.minCardinality === 0 || prop.minCardinality === undefined

    const propJsdoc = prop.comment ? `  /**\n   * ${prop.comment}\n   */\n` : ''

    return `${propJsdoc}  '${propShortUri}': ${tsType}${isArray ? '[]' : ''}${optional ? ' | undefined' : ''}`
  }).join('\n\n')

  const superClassTypes = cls.superClasses.length > 0
    ? ` extends ${cls.superClasses.map(sc => shortenURI(sc, prefixes).replace(':', '_')).join(', ')}`
    : ''

  return `/**
 * Generated from TTL ontology
 * Do not edit manually
 */

// Brand type for IRI safety
export type IRI<T extends string> = string & { __iri: T }

${jsdoc}export interface ${cls.label}${superClassTypes} {
  '@id': IRI<'${shortUri}'>
  '@type': '${shortUri}'
  
${properties}
}

/**
 * Valid properties for ${cls.label} class
 */
export type ${cls.label}Property = ${cls.properties.map(p => `'${shortenURI(p.uri, prefixes)}'`).join(' | ')}

/**
 * Type guard for ${cls.label} properties
 */
export function is${cls.label}Property(property: string): property is ${cls.label}Property {
  const validProperties: ${cls.label}Property[] = [
${cls.properties.map(p => `    '${shortenURI(p.uri, prefixes)}'`).join(',\n')}
  ]
  return validProperties.includes(property as ${cls.label}Property)
}
`
}

function generateIndex(classes: ClassInfo[]): string {
  const exports = classes.map(cls => `export * from './${cls.label}'`).join('\n')

  const classConstants = classes.map(cls =>
    `  ${cls.label}: '${cls.uri}'`
  ).join(',\n')

  const typeUnion = classes.map(cls => cls.label).join(' | ')

  return `/**
 * Generated from TTL ontology
 * Do not edit manually
 */

${exports}

/**
 * All class URIs
 */
export const Classes = {
${classConstants}
} as const

/**
 * Union of all class types
 */
export type AnyClass = ${typeUnion}

/**
 * Type guard for valid class URIs
 */
export function isValidClass(uri: string): uri is typeof Classes[keyof typeof Classes] {
  return Object.values(Classes).includes(uri as any)
}
`
}

// ============================================================================
// File Writer
// ============================================================================

async function writeGeneratedFiles(
  files: Map<string, string>,
  outputDir: string
): Promise<void> {
  // Create output directory
  await Deno.mkdir(outputDir, { recursive: true })

  // Write each file
  for (const [fileName, content] of files) {
    const filePath = `${outputDir}/${fileName}`
    await Deno.writeTextFile(filePath, content)
    console.log(`✅ Generated ${filePath}`)
  }
}

// ============================================================================
// CLI
// ============================================================================

async function main() {
  const args = Deno.args

  // Parse arguments
  let inputFile = ''
  let outputDir = './generated'

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' || args[i] === '-i') {
      inputFile = args[++i]
    } else if (args[i] === '--output' || args[i] === '-o') {
      outputDir = args[++i]
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
TTL to TypeScript Type Generator

Usage:
  deno run --allow-read --allow-write ttl-to-ts.ts [options]

Options:
  -i, --input <file>   Input TTL file (required)
  -o, --output <dir>   Output directory (default: ./generated)
  -h, --help          Show this help message

Example:
  deno run --allow-read --allow-write ttl-to-ts.ts \\
    --input ontology/narrative.ttl \\
    --output src/types/narrative
      `)
      Deno.exit(0)
    }
  }

  if (!inputFile) {
    console.error('❌ Error: --input is required')
    Deno.exit(1)
  }

  try {
    console.log(`📖 Reading ${inputFile}...`)
    const ttlContent = await Deno.readTextFile(inputFile)

    console.log(`🔍 Parsing ontology...`)
    const ontology = await parseTTL(ttlContent)

    console.log(`📝 Found ${ontology.classes.length} classes, ${ontology.properties.length} properties`)

    console.log(`🔨 Generating TypeScript...`)
    const files = generateTypeScript(ontology)

    console.log(`💾 Writing files to ${outputDir}...`)
    await writeGeneratedFiles(files, outputDir)

    console.log(`\n✨ Done! Generated ${files.size} files`)
    console.log(`\nImport generated types:`)
    console.log(`  import { Product, Publisher } from './${outputDir}'`)

  } catch (error) {
    console.error(`❌ Error: ${(error as Error)?.message}`)
    Deno.exit(1)
  }
}

// Run CLI if executed directly
if (import.meta.main) {
  main()
}

// ============================================================================
// Exports for programmatic use
// ============================================================================

export {
  parseTTL,
  generateTypeScript,
  writeGeneratedFiles,
  type OntologyInfo,
  type ClassInfo,
  type PropertyInfo
}