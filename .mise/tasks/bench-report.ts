/** Runs every Mitata program with native JSON output and stores immutable raw evidence plus environment metadata. @module */

const OUT = '.tmp/reports/bench'
await Deno.mkdir(OUT, { recursive: true })
const files = await find('packages')
if (files.length === 0) throw new Error('No package benchmark programs found.')

const runs: Array<{ file: string; report: string }> = []
for (const file of files) {
  const report = `${OUT}/${
    file.replace(/^packages\//u, '').replaceAll('/', '__').replace(/_bench\.ts$/u, '.json')
  }`
  const command = new Deno.Command(Deno.execPath(), {
    args: ['run', '--allow-env=BENCH_FORMAT,BENCH_LARGE', file],
    env: { BENCH_FORMAT: 'json' },
    stdout: 'piped',
    stderr: 'inherit',
  })
  const output = await command.output()
  if (!output.success) throw new Error(`Benchmark failed (${output.code}): ${file}`)
  const text = new TextDecoder().decode(output.stdout)
  JSON.parse(text)
  await Deno.writeTextFile(report, text.endsWith('\n') ? text : `${text}\n`)
  runs.push({ file, report })
}

const meta = {
  version: 1,
  createdAt: new Date().toISOString(),
  deno: Deno.version.deno,
  v8: Deno.version.v8,
  typescript: Deno.version.typescript,
  os: Deno.build.os,
  arch: Deno.build.arch,
  cpu: navigator.hardwareConcurrency,
  runs,
}
await Deno.writeTextFile(`${OUT}/meta.json`, `${JSON.stringify(meta, null, 2)}\n`)
console.log(`Stored ${runs.length} raw Mitata reports in ${OUT}.`)

async function find(root: string): Promise<string[]> {
  const files: string[] = []
  await visit(root, files)
  return files.sort()
}
async function visit(root: string, files: string[]): Promise<void> {
  for await (const entry of Deno.readDir(root)) {
    const path = `${root}/${entry.name}`
    if (entry.isDirectory) await visit(path, files)
    else if (entry.isFile && entry.name.endsWith('_bench.ts')) files.push(path)
  }
}
export {}
