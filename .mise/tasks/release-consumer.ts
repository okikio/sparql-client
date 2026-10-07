/** Proves exact public registry releases from owned fresh consumers and caches. @module */
import { isAbsolute, join, resolve } from 'node:path'

type RegistryType = 'npm' | 'jsr' | 'jsr-npm'
interface PackageType {
  name: string
  version: string
  keys: string[]
}
const target = Deno.args[0] ?? 'both'
if (Deno.args.length > 1 || !['npm', 'jsr', 'jsr-npm', 'both'].includes(target)) {
  throw new TypeError('Usage: release-consumer.ts npm|jsr|jsr-npm|both')
}
const packages = await members()
const evidence = resolve(
  '.tmp/releases/consumers',
  `${new Date().toISOString().replace(/[:.]/gu, '-')}-${crypto.randomUUID()}`,
)
await Deno.mkdir(evidence, { recursive: true })
const tools = await runtimes()
await Deno.writeTextFile(join(evidence, 'tools.json'), `${JSON.stringify(tools, null, 2)}\n`)
const results: Array<{ registry: RegistryType; status: 'pass' | 'fail'; error?: string }> = []
const failures: unknown[] = []
for (
  const registry
    of (target === 'both'
      ? ['npm', 'jsr', 'jsr-npm']
      : target === 'jsr'
      ? ['jsr', 'jsr-npm']
      : [target]) as RegistryType[]
) {
  let temporary: string | undefined
  const errors: unknown[] = []
  try {
    temporary = await Deno.makeTempDir({ prefix: `okikio-registry-${registry}-` })
    const env = {
      DENO_DIR: join(temporary, 'deno-cache'),
      npm_config_cache: join(temporary, 'npm-cache'),
    }
    await Deno.writeTextFile(join(temporary, 'package.json'), '{"private":true,"type":"module"}\n')
    // Generated compatibility packages keep their own @jsr identities. Only that scope
    // uses npm.jsr.io; engine and compiler dependencies still come from npmjs.org.
    await Deno.writeTextFile(join(temporary, '.npmrc'), '@jsr:registry=https://npm.jsr.io\n')
    const archives: string[] = []
    for (const pkg of packages) {
      const name = installed(pkg.name, registry)
      let metadata: Record<string, unknown>
      if (registry === 'jsr-npm') {
        const packument = await json(`https://npm.jsr.io/${encodeURIComponent(name)}`)
        if (packument.name !== name) throw new Error(`JSR npm package identity differs for ${name}`)
        metadata = record(
          record(packument.versions, 'JSR npm versions')[pkg.version],
          `JSR npm exact version ${pkg.version}`,
        )
        await Deno.writeTextFile(
          join(evidence, `jsr-npm-${pkg.name.replace(/[@/]/gu, '-')}-packument.json`),
          `${JSON.stringify(packument, null, 2)}\n`,
        )
      } else {
        metadata = await json(
          registry === 'npm'
            ? `https://registry.npmjs.org/${encodeURIComponent(name)}/${pkg.version}`
            : `https://jsr.io/${pkg.name}/${pkg.version}_meta.json`,
        )
      }
      if (registry !== 'jsr' && (metadata.name !== name || metadata.version !== pkg.version)) {
        throw new Error(`${registry} identity differs for ${name}@${pkg.version}`)
      }
      // The compatibility packument has no exports field. Its actual installed
      // package.json is checked below by every runtime against the source export map.
      if (registry !== 'jsr-npm') {
        const keys = Object.keys(record(metadata.exports, 'Registry exports')).sort()
        if (JSON.stringify(keys) !== JSON.stringify(pkg.keys)) {
          throw new Error(
            `${registry} exported subpaths differ for ${pkg.name}@${pkg.version}: expected ${pkg.keys}, received ${keys}`,
          )
        }
      }
      await Deno.writeTextFile(
        join(evidence, `${registry}-${pkg.name.replace(/[@/]/gu, '-')}.json`),
        `${JSON.stringify(metadata, null, 2)}\n`,
      )
      if (registry !== 'jsr') {
        const dist = record(metadata.dist, `${registry} dist`)
        const url = new URL(string(dist.tarball, `${registry} tarball`))
        const host = registry === 'npm' ? 'registry.npmjs.org' : 'npm.jsr.io'
        if (url.protocol !== 'https:' || url.hostname !== host) {
          throw new Error(`${registry} tarball must come from its public registry ${host}`)
        }
        const integrity = string(dist.integrity, `${registry} integrity`)
        if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(integrity)) {
          throw new Error(`${registry} archive must declare one SHA-512 integrity digest`)
        }
        const bytes = await download(url.href, 64 * 1024 * 1024)
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-512', bytes))
        const actual = `sha512-${
          btoa([...digest].map((value) => String.fromCharCode(value)).join(''))
        }`
        if (actual !== integrity) {
          throw new Error(`${registry} archive integrity differs for ${name}@${pkg.version}`)
        }
        const archive = join(temporary, `${pkg.name.replace(/[@/]/gu, '-')}.tgz`)
        await Deno.writeFile(archive, bytes)
        archives.push(archive)
      } else {
        // Registry package metadata, rather than the management API, proves presence.
        const published = await json(`https://jsr.io/${pkg.name}/meta.json`)
        const [scope, name] = pkg.name.slice(1).split('/')
        if (published.scope !== scope || published.name !== name) {
          throw new Error(`JSR package identity differs for ${pkg.name}`)
        }
        record(
          record(published.versions, 'JSR published versions')[pkg.version],
          `JSR exact version ${pkg.version}`,
        )
        await Deno.writeTextFile(
          join(evidence, `jsr-${pkg.name.replace(/[@/]/gu, '-')}-package.json`),
          `${JSON.stringify(published, null, 2)}\n`,
        )
      }
    }
    if (registry !== 'jsr') {
      await run(
        tools.node.path,
        [
          tools.npm.path,
          'install',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--registry=https://registry.npmjs.org',
          'typescript@5.9.3',
          '@types/node@26.0.0',
          ...(!packages.some((pkg) => pkg.name === '@okikio/opfs')
            ? ['oxigraph@0.5.9', '@comunica/query-sparql-rdfjs@5.3.0', 'n3@2.1.1']
            : ['drizzle-orm@0.45.2', '@types/deno@2.7.0']),
          ...archives,
        ],
        temporary,
        env,
        join(evidence, `${registry}-install.log`),
      )
    }
    await Deno.writeTextFile(join(temporary, 'consumer.mjs'), consumer(registry))
    await Deno.writeTextFile(join(evidence, `${registry}-consumer.mjs`), consumer(registry))
    await Deno.writeTextFile(join(temporary, 'types.ts'), typed(registry))
    await Deno.writeTextFile(join(evidence, `${registry}-types.ts`), typed(registry))
    // Type and runtime lanes are independent; retain every failure before owned cleanup.
    try {
      if (registry !== 'jsr') {
        await Deno.writeTextFile(
          join(temporary, 'tsconfig.json'),
          JSON.stringify({
            compilerOptions: {
              strict: true,
              noEmit: true,
              target: 'ES2023',
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              lib: ['ES2023', 'DOM', 'DOM.Iterable'],
              types: packages.some((pkg) => pkg.name === '@okikio/opfs')
                ? ['node', 'deno']
                : ['node'],
              skipLibCheck: false,
            },
            files: ['types.ts'],
          }),
        )
        await Deno.writeTextFile(join(temporary, 'typecheck.mjs'), typecheck(registry))
        await Deno.writeTextFile(join(evidence, `${registry}-typecheck.mjs`), typecheck(registry))
        await run(
          tools.node.path,
          ['typecheck.mjs'],
          temporary,
          env,
          join(evidence, `${registry}-types.log`),
        )
      } else {
        await Deno.writeTextFile(
          join(temporary, 'type-config.json'),
          JSON.stringify({
            compilerOptions: {
              strict: true,
              lib: ['deno.window', 'dom', 'dom.iterable', 'esnext'],
            },
          }),
        )
        await run(
          Deno.execPath(),
          [
            'check',
            '--config',
            'type-config.json',
            '--lock=deno.lock',
            '--node-modules-dir=auto',
            'types.ts',
          ],
          temporary,
          env,
          join(evidence, 'jsr-types.log'),
        )
      }
    } catch (error) {
      errors.push(error)
    }
    const runtimes = registry !== 'jsr' ? ['node', 'deno', 'bun'] : ['deno']
    for (const runtime of runtimes) {
      const command = runtime === 'deno'
        ? tools.deno.path
        : runtime === 'node'
        ? tools.node.path
        : tools.bun.path
      const args = runtime === 'deno'
        ? [
          'run',
          '--no-config',
          '--lock=deno.lock',
          '--node-modules-dir=' + (registry !== 'jsr' ? 'manual' : 'auto'),
          '--allow-read',
          '--allow-write',
          '--allow-env',
          'consumer.mjs',
        ]
        : ['consumer.mjs']
      try {
        await run(command, args, temporary, env, join(evidence, `${registry}-${runtime}.log`))
      } catch (error) {
        errors.push(error)
      }
    }
  } catch (error) {
    errors.push(error)
  } finally {
    if (temporary !== undefined) {
      for (const file of ['deno.lock', 'package-lock.json']) {
        try {
          await Deno.copyFile(join(temporary, file), join(evidence, `${registry}-${file}`))
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) errors.push(error)
        }
      }
    }
    try {
      if (temporary !== undefined) await Deno.remove(temporary, { recursive: true })
    } catch (error) {
      errors.push(
        new Error(`Could not remove owned registry consumer ${temporary}`, { cause: error }),
      )
    }
  }
  if (errors.length) {
    const failure = errors.length === 1
      ? errors[0]
      : new AggregateError(errors, `${registry} consumer and cleanup failed`)
    failures.push(failure)
    results.push({ registry, status: 'fail', error: describe(failure) })
  } else results.push({ registry, status: 'pass' })
}
try {
  if (JSON.stringify(await members()) !== JSON.stringify(packages)) {
    throw new Error('Declared package identities changed during registry verification')
  }
  await Deno.writeTextFile(
    join(evidence, 'summary.json'),
    `${
      JSON.stringify(
        {
          packages,
          tools,
          results,
          evidence,
          scope: {
            npm: 'Node, Deno and Bun installed archive consumers',
            jsr: 'Deno exact JSR source consumer',
            'jsr-npm': 'Node, Deno and Bun generated @jsr archive consumers',
          },
        },
        null,
        2,
      )
    }\n`,
  )
} catch (error) {
  failures.push(error)
}
console.log(`Registry consumer evidence: ${evidence}`)
if (failures.length) throw new AggregateError(failures, 'Exact public registry consumers failed')
console.log(`Exact public ${target} consumers passed`)

/** Discovers current declared package identities without resolving workspace aliases in consumers. */
async function members(): Promise<PackageType[]> {
  const manifest = record(JSON.parse(await Deno.readTextFile('deno.json')), 'Root manifest')
  const directories: string[] = []
  if (typeof manifest.name === 'string') directories.push('.')
  else {
    if (!Array.isArray(manifest.workspace)) {
      throw new TypeError('Root manifest needs a package or workspace')
    }
    for (const value of manifest.workspace) {
      const member = string(value, 'Workspace member')
      if (member.endsWith('/*')) {
        const parent = member.slice(0, -2)
        for await (const entry of Deno.readDir(parent)) {
          if (entry.isDirectory) directories.push(join(parent, entry.name))
        }
      } else directories.push(member)
    }
  }
  const values: PackageType[] = []
  for (const directory of directories.sort()) {
    const deno = record(
      JSON.parse(await Deno.readTextFile(join(directory, 'deno.json'))),
      'Deno manifest',
    )
    const npm = record(
      JSON.parse(await Deno.readTextFile(join(directory, 'package.json'))),
      'npm manifest',
    )
    const name = string(deno.name, 'Package name'),
      version = string(deno.version, 'Package version')
    if (
      !/^@[a-z0-9-]+\/[a-z0-9-]+$/u.test(name) || !/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/iu.test(version)
    ) throw new TypeError('Expected an exact scoped package version')
    if (npm.name !== name || npm.version !== version) {
      throw new Error(`Manifest identities differ in ${directory}`)
    }
    const keys = Object.keys(record(deno.exports, 'Deno exports')).sort()
    if (!keys.includes('.') || keys.some((key) => key !== '.' && !/^\.\/[a-z0-9/-]+$/u.test(key))) {
      throw new TypeError(`Invalid export keys for ${name}`)
    }
    if (
      JSON.stringify(keys) !==
        JSON.stringify(Object.keys(record(npm.exports, 'npm exports')).sort())
    ) throw new Error(`Manifest export keys differ in ${directory}`)
    values.push({ name, version, keys })
  }
  if (!values.length) throw new Error('No declared packages found')
  return values
}

/** Maps only declared package roots; public subpath suffixes retain their meaning. */
function installed(name: string, registry: RegistryType): string {
  return registry === 'jsr-npm' ? '@jsr/' + name.slice(1).replace('/', '__') : name
}

/** Generates one portable behavior fixture with explicit registry root mapping. */
function consumer(registry: RegistryType): string {
  return `import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { isAbsolute,relative,sep } from 'node:path'
import { fileURLToPath } from 'node:url'
const packages = ${JSON.stringify(packages)}
const registry = ${JSON.stringify(registry)}
const versions = new Map(packages.map(p => [p.name, p.version]))
const installed = name => registry === 'jsr-npm' ? '@jsr/' + name.slice(1).replace('/', '__') : name
function spec(name) {
  const parts = name.split('/'), root = parts.slice(0, 2).join('/')
  assert.ok(versions.has(root), 'Undeclared public package: ' + name)
  const suffix = parts.length > 2 ? '/' + parts.slice(2).join('/') : ''
  return registry !== 'jsr' ? installed(root) + suffix : 'jsr:' + root + '@' + versions.get(root) + suffix
}
async function load(name) { return await import(spec(name)) }
function contains(root,file) {
  const result = relative(realpathSync(root),realpathSync(file))
  return result !== '' && result !== '..' && !result.startsWith('..' + sep) && !isAbsolute(result)
}
let entries = 0
const installedPackages = []
for (const pkg of packages) {
  if (registry !== 'jsr') {
    const metadata = JSON.parse(await readFile('node_modules/' + installed(pkg.name) + '/package.json', 'utf8'))
    assert.equal(metadata.name, installed(pkg.name)); assert.equal(metadata.version, pkg.version)
    assert.deepEqual(Object.keys(metadata.exports).sort(),pkg.keys)
    if (registry === 'jsr-npm') assert.ok(Number.isSafeInteger(metadata._jsr_revision) && metadata._jsr_revision > 0,'Generated JSR package must identify its compatibility revision')
    installedPackages.push({name:metadata.name,version:metadata.version,revision:metadata._jsr_revision,exports:pkg.keys})
  }
  for (const key of pkg.keys) {
    const name = pkg.name + (key === '.' ? '' : '/' + key.slice(2))
    const resolved = import.meta.resolve(spec(name))
    if (registry !== 'jsr') {
      const root = fileURLToPath(new URL('./node_modules/' + installed(pkg.name) + '/',import.meta.url))
      assert.ok(contains(root,fileURLToPath(resolved)), name + ' resolves outside installed package: ' + resolved)
    } else {
      // Deno preserves the exact jsr: specifier here before module loading.
      assert.ok(resolved === spec(name) || resolved.startsWith('https://jsr.io/' + pkg.name + '/' + pkg.version + '/'), name + ' resolves outside exact JSR release: ' + resolved)
    }
    await load(name); entries++
  }
}
if (versions.has('@okikio/opfs')) {
  const { createFileSystem } = await load('@okikio/opfs')
  const { createMemoryAdapter } = await load('@okikio/opfs/adapter/memory')
  async function workflow(adapter) {
    const fs = createFileSystem(adapter, { coordination: 'local', disposeAdapter: true })
    const errors = []
    try {
      const bytes = Uint8Array.from({ length: 65537 }, (_, i) => i % 251)
      await fs.writeFile('/state/file.bin', bytes, { parents: true })
      assert.deepEqual(await fs.readFile('/state/file.bin'), bytes)
      assert.deepEqual(await fs.readFile('/state/file.bin', { at: 65530, length: 7 }), bytes.slice(65530))
      await fs.copy('/state/file.bin', '/copy.bin'); await fs.move('/copy.bin', '/moved.bin')
      assert.deepEqual(await fs.readFile('/moved.bin'), bytes); assert.equal(await fs.exists('/copy.bin'), false)
      const handle = await fs.getFileHandle('/moved.bin'), writer = await handle.createWritable({ keepExistingData: true })
      const writeErrors = []
      try { await writer.write({ type: 'write', position: 0, data: new Uint8Array([255]) }) } catch (error) { writeErrors.push(error) }
      try { await writer.abort() } catch (error) { writeErrors.push(error) }
      if (writeErrors.length) throw new AggregateError(writeErrors, 'Writer mutation and abort failed')
      assert.deepEqual(await fs.readFile('/moved.bin'), bytes)
      await assert.rejects(fs.writeFile('/aborted.bin', bytes, { signal: AbortSignal.abort() }), error => error.code === 'aborted')
      assert.equal(await fs.exists('/aborted.bin'), false)
    } catch (error) { errors.push(error) }
    try { await fs.close() } catch (error) { errors.push(error) }
    if (errors.length) throw new AggregateError(errors, 'Filesystem behavior and cleanup failed')
  }
  await workflow(createMemoryAdapter())
  const runtime = typeof Bun !== 'undefined' ? 'bun' : typeof Deno !== 'undefined' ? 'deno' : 'node'
  const native = await load('@okikio/opfs/adapter/' + runtime)
  const directory = await mkdtemp(fileURLToPath(new URL('./native-', import.meta.url)))
  const errors = []
  try { await workflow(native['create' + runtime[0].toUpperCase() + runtime.slice(1) + 'Adapter']({ root: directory })) } catch (error) { errors.push(error) }
  try { await rm(directory, { recursive: true }) } catch (error) { errors.push(error) }
  if (errors.length) throw new AggregateError(errors, 'Native behavior and cleanup failed')
} else {
  const rdf = await load('@okikio/rdf'), nquads = await load('@okikio/rdf/nquads'), turtle = await load('@okikio/rdf/turtle')
  const value = rdf.quad(rdf.namedNode('urn:s'), rdf.namedNode('urn:p'), rdf.literal('quote " 雪', 'ja'))
  const dataset = rdf.dataset([value, value]); assert.equal(dataset.size, 1)
  assert.equal([...dataset.match(value.subject)].length, 1)
  const parsed = []
  for await (const q of nquads.parse([nquads.write(dataset)])) parsed.push(q)
  assert.equal(parsed.length, 1); assert.ok(parsed[0].equals(value))
  const compact = []; for await (const q of turtle.parse('@prefix ex: <urn:> . ex:s ex:p "雪" .')) compact.push(q)
  assert.equal(compact.length, 1); assert.ok(compact[0].equals(rdf.quad(value.subject, value.predicate, rdf.literal('雪'))))
  await assert.rejects(async () => { for await (const q of nquads.parse('<urn:s> <urn:p> "unterminated')) void q })
  assert.equal(await (await load('@okikio/rdf/canon')).canonicalize(dataset), nquads.write(dataset))
  const expanded = await (await load('@okikio/rdf/jsonld')).expand({'@context':{label:'urn:p'},'@id':'urn:s',label:'雪'})
  assert.deepEqual(JSON.parse(JSON.stringify(expanded)),[{'@id':'urn:s','urn:p':[{'@value':'雪'}]}])
  const sparql = await load('@okikio/sparql'), http = await load('@okikio/sparql/http')
  const query = sparql.select(['?value']).where(sparql.triple(value.subject, value.predicate, '?value'))
  let request
  const client = http.create({ endpoint: 'https://endpoint.invalid/query', queryMethod:'get', fetch: async (url, options) => {
    request = {url:String(url), options}
    return new Response(JSON.stringify({head:{vars:['value']},results:{bindings:[{value:{type:'literal',value:'雪','xml:lang':'ja'}}]}}), {headers:{'content-type':'application/sparql-results+json'}})
  }})
  const rows = []; for await (const row of await client.queryBindings(query)) rows.push(row)
  assert.equal(rows.length,1); assert.ok(rows[0].get('value').equals(rdf.literal('雪','ja')))
  assert.equal(new URL(request.url).searchParams.get('query'), query.build().value)
  assert.equal(request.options.method,'GET')
  const sent = request
  await assert.rejects(client.queryBindings(query,{signal:AbortSignal.abort()}), error=>error.kind==='abort')
  assert.equal(request,sent)
  const compiler = await load('@okikio/vocab/compile'), shared = rdf.namedNode('urn:Shared')
  const result = await compiler.compile([{id:'fixture',quads:[rdf.quad(shared,rdf.namedNode(rdf.RDF.type),rdf.namedNode('http://www.w3.org/2000/01/rdf-schema#Class')),rdf.quad(shared,rdf.namedNode(rdf.RDF.type),rdf.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#Property'))]}],{vocabulary:'fixture',namespace:'urn:',prefix:'fixture',rdfImport:spec('@okikio/rdf'),runtimeImport:spec('@okikio/vocab/runtime')})
  assert.equal(result.manifest.generator,'@okikio/vocab/' + versions.get('@okikio/vocab'))
  assert.deepEqual(result.manifest.symbols,[{iri:'urn:Shared',kind:'class',name:'Shared'},{iri:'urn:Shared',kind:'property',name:'FixtureSharedProperty'}])
  const emittedFile = new URL('./emitted-vocabulary.ts',import.meta.url)
  await writeFile(emittedFile,result.source)
  const emitted = await import(emittedFile.href)
  assert.ok(emitted.Shared.equals(shared)); assert.ok(emitted.FixtureSharedProperty.equals(shared))
  const schema = await (await load('@okikio/vocab/schema')).ProductSchema['~standard'].validate({'@type':'Product',name:'Widget'})
  assert.ok(!schema.issues)
  const { Store } = await load('@okikio/triplestore')
  const files = new Map(), directories = new Set(['/']), encoder = new TextEncoder()
  let disposed = 0
  const fs = {
    async exists(path) { return files.has(path) || directories.has(path) },
    async ensureDir(path) { directories.add(path) },
    async *readDir(path) { const prefix = path + '/'; for (const name of files.keys()) if (name.startsWith(prefix) && !name.slice(prefix.length).includes('/')) yield {name:name.slice(prefix.length),kind:'file'} },
    async readText(path) { assert.ok(files.has(path)); return new TextDecoder().decode(files.get(path)) },
    async stat(path) { if (files.has(path)) return {kind:'file',size:files.get(path).length}; assert.ok(directories.has(path)); return {kind:'directory'} },
    async writeFile(path,data) { files.set(path, typeof data === 'string' ? encoder.encode(data) : data.slice()) },
    async close() { disposed++ },
    async dispose() { disposed++ },
    async [Symbol.asyncDispose]() { disposed++ },
    [Symbol.dispose]() { disposed++ },
  }
  let store
  const storeErrors = []
  try {
    store = await Store.open(fs)
    await store.add(value); await store.add(value)
    assert.equal(store.size,1); assert.equal(store.generation,1)
    await store.close(); store = await Store.open(fs)
    assert.equal(store.size,1); assert.ok(store.has(value)); assert.equal(disposed,0)
    await store.delete(value); await store.close(); store = await Store.open(fs)
    assert.equal(store.size,0); assert.equal(store.generation,2)
  } catch(error) { storeErrors.push(error) }
  if (store) try { await store.close() } catch(error) { storeErrors.push(error) }
  try { assert.equal(disposed,0) } catch(error) { storeErrors.push(error) }
  if (storeErrors.length) throw new AggregateError(storeErrors,'Persistent store and cleanup failed')
  async function engineWorkflow(client) {
    const rows = []; for await (const row of await client.queryBindings('SELECT ?v WHERE { <urn:s> <urn:p> ?v }')) rows.push(row)
    assert.equal(rows.length,1); assert.ok(rows[0].get('v').equals(rdf.literal('engine')))
    assert.equal(await client.queryBoolean('ASK { <urn:s> <urn:p> "engine" }'),true)
    const graph = []; for await(const q of await client.queryQuads('CONSTRUCT { <urn:s> <urn:p> ?v } WHERE { <urn:s> <urn:p> ?v }')) graph.push(q)
    assert.equal(graph.length,1); assert.ok(graph[0].equals(rdf.quad(value.subject,value.predicate,rdf.literal('engine'))))
    await client.update('DELETE WHERE { <urn:s> <urn:p> ?v }')
    assert.equal(await client.queryBoolean('ASK { <urn:s> <urn:p> ?v }'),false)
    await client.update('INSERT DATA { <urn:s> <urn:p> "restored" }')
    assert.equal(await client.queryBoolean('ASK { <urn:s> <urn:p> "restored" }'),true)
  }
  const ox = await import(registry !== 'jsr' ? 'oxigraph' : 'npm:oxigraph@0.5.9')
  const nativeStore = new ox.Store(), wrappers = [], engineErrors = []
  try {
    nativeStore.load('<urn:s> <urn:p> "engine" .',{format:'application/n-triples'})
    const tracked = { query(query, options) { const result = nativeStore.query(query, options); if(Array.isArray(result)) for(const row of result) if(row instanceof Map) wrappers.push(...row.values()); else wrappers.push(row); return result }, update(query, options) { return nativeStore.update(query,options) } }
    const client = (await load('@okikio/oxigraph')).create(tracked)
    assert.equal(client.store,tracked); await engineWorkflow(client)
    assert.equal(nativeStore.query('ASK { <urn:s> <urn:p> "restored" }'),true)
  } catch(error) { engineErrors.push(error) }
  for(const term of wrappers) try { term.free() } catch(error) { engineErrors.push(error) }
  try { nativeStore.free() } catch(error) { engineErrors.push(error) }
  if(engineErrors.length) throw new AggregateError(engineErrors,'Oxigraph and owned Wasm cleanup failed')
  const { QueryEngine } = await import(registry !== 'jsr' ? '@comunica/query-sparql-rdfjs' : 'npm:@comunica/query-sparql-rdfjs@5.3.0')
  const { Store: RdfStore } = await import(registry !== 'jsr' ? 'n3' : 'npm:n3@2.1.1')
  const source = new RdfStore([rdf.quad(value.subject,value.predicate,rdf.literal('engine'))]), engine = new QueryEngine()
  const adapter = (await load('@okikio/comunica')).create(engine,{context:()=>({sources:[source]})})
  assert.equal(adapter.engine,engine); await engineWorkflow(adapter)
  assert.equal(source.size,1); assert.ok(source.has(rdf.quad(value.subject,value.predicate,rdf.literal('restored'))))
}
console.log(JSON.stringify({registry, packages, installedPackages, entries, behavior:'pass'}))
`
}

/** Statically imports every entry and assigns representative public API types in strict consumers. */
function typed(registry: RegistryType): string {
  const spec = (pkg: PackageType, key: string): string =>
    registry !== 'jsr'
      ? installed(pkg.name, registry) + (key === '.' ? '' : '/' + key.slice(2))
      : `jsr:${pkg.name}@${pkg.version}${key === '.' ? '' : '/' + key.slice(2)}`
  const entries = packages.flatMap((pkg) => pkg.keys.map((key) => spec(pkg, key)))
  const header = entries.map((name, index) =>
    `import * as entry${index} from ${JSON.stringify(name)}\nvoid entry${index}`
  ).join('\n')
  const owned = (name: string): string => {
    const pkg = packages.find((pkg) => name === pkg.name || name.startsWith(pkg.name + '/'))
    if (!pkg) throw new Error(`Undeclared typed fixture package ${name}`)
    return JSON.stringify(
      spec(pkg, name === pkg.name ? '.' : './' + name.slice(pkg.name.length + 1)),
    )
  }
  if (packages.some((pkg) => pkg.name === '@okikio/opfs')) {
    return `${header}
import { createFileSystem, type FileSystemType } from ${owned('@okikio/opfs')}
import { createMemoryAdapter } from ${owned('@okikio/opfs/adapter/memory')}
import { type DrizzleColumnType, type DrizzleTableType } from ${
      owned('@okikio/opfs/driver/drizzle')
    }
const fs: FileSystemType = createFileSystem(createMemoryAdapter(), {coordination:'local'})
const bytes: Promise<Uint8Array> = fs.readFile('/type-fixture')
const text: Promise<string> = fs.readText('/type-fixture')
const closed: Promise<void> = fs.close()
declare const table: DrizzleTableType
const pathColumn: DrizzleColumnType<string> = table.path
const pathData: string = table.path._.data
const sizeData: number = table.size._.data
// @ts-expect-error A textual column cannot store numeric file size.
const wrongColumn: DrizzleColumnType<number> = table.path
// @ts-expect-error Byte offsets must be numbers.
const invalidRange = fs.readFile('/type-fixture', {at:'0'})
void bytes; void text; void closed; void invalidRange; void pathData; void sizeData; void wrongColumn; void pathColumn
`
  }
  return `${header}
import { namedNode, literal, quad, type Quad } from ${owned('@okikio/rdf')}
import { select, triple, type BindingType, type Queryable } from ${owned('@okikio/sparql')}
import { create } from ${owned('@okikio/sparql/http')}
import { Store, type FileSystemType } from ${owned('@okikio/triplestore')}
import { ProductSchema, type ProductType } from ${owned('@okikio/vocab/schema')}
const value: Quad = quad(namedNode('urn:s'),namedNode('urn:p'),literal('value'))
const client: Queryable = create({endpoint:'https://endpoint.invalid/'})
const rows: Promise<AsyncIterable<BindingType>> = client.queryBindings(select(['?value']).where(triple(value.subject,value.predicate,'?value')))
declare const fs: FileSystemType
const opened: Promise<Store> = Store.open(fs)
const product: ProductType = {'@type':'Product',name:'Widget'}
const validated = ProductSchema['~standard'].validate(product)
// @ts-expect-error Stored RDF subjects must be RDF terms.
const invalidQuad = quad('urn:s',value.predicate,value.object)
// @ts-expect-error A Product node keeps its class discriminator.
const invalidProduct: ProductType = {'@type':'Other'}
void rows; void opened; void validated; void invalidQuad; void invalidProduct
`
}

/** Uses the pinned compiler's public diagnostics and actual declaration graph. */
function typecheck(registry: RegistryType): string {
  return `import assert from 'node:assert/strict'
import ts from 'typescript'
import { realpathSync } from 'node:fs'
import { isAbsolute,relative,resolve,sep } from 'node:path'
function contains(root,file) {const result=relative(root,file);return result!=='' && result!=='..' && !result.startsWith('..'+sep) && !isAbsolute(result)}
const config = ts.getParsedCommandLineOfConfigFile('tsconfig.json',{}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic(diagnostic) { throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText,'\\n')) }
})
assert.ok(config)
const program = ts.createProgram({rootNames:config.fileNames,options:config.options})
const diagnostics = [...config.errors,...ts.getPreEmitDiagnostics(program)]
if(diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:name=>name,getCurrentDirectory:ts.sys.getCurrentDirectory,getNewLine:()=> '\\n'}))
  process.exitCode = 1
} else {
  const sources = program.getSourceFiles().map(file=>realpathSync(file.fileName))
  if(${packages.some((pkg) => pkg.name === '@okikio/opfs')}) {
    const foreign = realpathSync('node_modules/drizzle-orm')
    assert.equal(sources.filter(file=>contains(foreign,file)).length,0,'Public OPFS types must not reach upstream Drizzle dialect declarations')
    const resolved = ts.resolveModuleName(${
    JSON.stringify(installed('@okikio/opfs', registry) + '/driver/drizzle')
  },resolve('types.ts'),config.options,ts.sys,undefined,undefined,ts.ModuleKind.ESNext).resolvedModule
    assert.ok(resolved,'Public Drizzle driver must resolve under the consumer compiler options')
    assert.ok(sources.some(file=>relative(file,realpathSync(resolved.resolvedFileName))===''),'All-entry fixture must include actual resolved Drizzle declarations')
  }
  console.log(JSON.stringify({compiler:ts.version,strict:program.getCompilerOptions().strict,skipLibCheck:program.getCompilerOptions().skipLibCheck,sourceFiles:sources.length,drizzlePublicGraphIsolated:${
    packages.some((pkg) => pkg.name === '@okikio/opfs')
  }}))
}
`
}

/** Enforces object-shaped JSON metadata at the registry boundary. */
function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}
/** Enforces nonempty metadata and manifest identity strings. */
function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new TypeError(`${label} must be a string`)
  return value
}
/** Reads bounded exact HTTPS registry metadata, treating every non-200 response as a failure. */
async function json(url: string): Promise<Record<string, unknown>> {
  return record(
    JSON.parse(new TextDecoder().decode(await download(url, 2 * 1024 * 1024))),
    'Registry metadata',
  )
}
/** Bounds both registry request duration and retained archive or metadata bytes. */
async function download(url: string, cap: number): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'error' })
  if (response.status !== 200) {
    const error = new Error(`Public registry HTTP ${response.status}: ${url}`)
    try {
      await response.body?.cancel()
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'Registry response and cleanup failed')
    }
    throw error
  }
  if (!response.body) throw new Error(`Empty public registry response: ${url}`)
  const chunks: Uint8Array[] = []
  let length = 0
  for await (const chunk of response.body) {
    length += chunk.length
    if (length > cap) throw new RangeError(`Public registry response exceeds ${cap} bytes: ${url}`)
    chunks.push(chunk)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}
interface ToolType {
  path: string
  version: string
}
/** Resolves tool identities while repository runtime configuration still applies.
 * Fresh consumers then use these absolute executables instead of cwd-sensitive shims.
 */
async function runtimes(): Promise<
  { node: ToolType; bun: ToolType; deno: ToolType; npm: ToolType }
> {
  const cwd = Deno.cwd()
  const probe = async (command: string, code: string): Promise<ToolType> => {
    const value = record(
      JSON.parse(
        await run(command, ['--eval', code], cwd, {}, join(evidence, `tool-${command}.log`)),
      ),
      `${command} tool identity`,
    )
    const path = string(value.path, `${command} executable`)
    const version = string(value.version, `${command} version`)
    if (!isAbsolute(path) || !(await Deno.stat(path)).isFile) {
      throw new Error(`${command} must resolve to an absolute executable file`)
    }
    return { path: await Deno.realPath(path), version }
  }
  const node = await probe(
    'node',
    'console.log(JSON.stringify({path:process.execPath,version:process.version}))',
  )
  const bun = await probe(
    'bun',
    'console.log(JSON.stringify({path:process.execPath,version:Bun.version}))',
  )
  const directory = join(evidence, 'tool-probe')
  await Deno.mkdir(directory)
  await Deno.writeTextFile(
    join(directory, 'package.json'),
    JSON.stringify({ private: true, scripts: { probe: 'node probe.cjs' } }),
  )
  await Deno.writeTextFile(
    join(directory, 'probe.cjs'),
    'console.log(JSON.stringify({path:process.env.npm_execpath}))\n',
  )
  const selected = record(
    JSON.parse(
      await run(
        'npm',
        ['--prefix', directory, 'run', '--silent', 'probe'],
        cwd,
        {},
        join(evidence, 'tool-npm-path.log'),
      ),
    ),
    'npm tool identity',
  )
  const path = string(selected.path, 'npm CLI script')
  if (!isAbsolute(path) || !(await Deno.stat(path)).isFile) {
    throw new Error('npm must resolve to an absolute CLI script file')
  }
  const npm = {
    path: await Deno.realPath(path),
    version:
      (await run(node.path, [path, '--version'], cwd, {}, join(evidence, 'tool-npm-version.log')))
        .trim(),
  }
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(npm.version)) {
    throw new Error('npm CLI version must be an explicit semantic version')
  }
  return { node, bun, deno: { path: Deno.execPath(), version: Deno.version.deno }, npm }
}

/** Runs one bounded child with captured output; cache paths belong only to this consumer. */
async function run(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  log: string,
): Promise<string> {
  const child = new Deno.Command(command, {
    args,
    cwd,
    env,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()
  const readers = [child.stdout.getReader(), child.stderr.getReader()]
  const buffers: Uint8Array[][] = [[], []]
  const lengths = [0, 0]
  let status: Deno.CommandStatus | undefined
  const completion = Promise.all([
    child.status.then((value) => status = value),
    ...readers.map(async (reader, index) => {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) return
        lengths[index] = (lengths[index] ?? 0) + chunk.value.length
        if (lengths[index]! > 4 * 1024 * 1024) {
          throw new RangeError('Consumer command output exceeds 4 MiB per pipe')
        }
        buffers[index]!.push(chunk.value)
      }
    }),
  ])
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Consumer command exceeded 180 seconds')), 180_000)
  })
  const errors: unknown[] = []
  let output = ''
  try {
    await Promise.race([completion, deadline])
    if (!status?.success) throw new Error(`Consumer command exited ${status?.code}`)
  } catch (error) {
    errors.push(error)
    if (!status) {
      try {
        child.kill('SIGKILL')
      } catch (cause) {
        errors.push(cause)
      }
      let stopTimer: ReturnType<typeof setTimeout> | undefined
      try {
        status = await Promise.race([
          child.status,
          new Promise<never>((_, reject) => {
            stopTimer = setTimeout(
              () => reject(new Error('Owned consumer process did not stop after termination')),
              10_000,
            )
          }),
        ])
      } catch (cause) {
        errors.push(cause)
      } finally {
        if (stopTimer !== undefined) clearTimeout(stopTimer)
      }
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    for (const reader of readers) {
      try {
        await reader.cancel()
      } catch (error) {
        errors.push(error)
      }
      reader.releaseLock()
    }
    const text = buffers.map((parts) =>
      new TextDecoder().decode(Uint8Array.from(parts.flatMap((part) => [...part])))
    )
    output = text[0] ?? ''
    try {
      await Deno.writeTextFile(
        log,
        `${command} ${args.join(' ')}\nexit=${status?.code ?? 'unsettled'}\nstdout:\n${
          text[0]
        }\nstderr:\n${text[1]}\n`,
      )
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length) throw new AggregateError(errors, `${command} failed; raw output ${log}`)
  return output
}
/** Retains nested primary/cleanup failures in a human-readable receipt. */
function describe(value: unknown): string {
  if (value instanceof AggregateError) {
    return `${value.message}\n${[...value.errors].map(describe).join('\n')}`
  }
  if (value instanceof Error) {
    return `${value.stack ?? value.message}${
      value.cause ? '\nCaused by: ' + describe(value.cause) : ''
    }`
  }
  return String(value)
}
