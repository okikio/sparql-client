/** Runs the real-engine and Testcontainers integration suite. @module */
const child = new Deno.Command(Deno.execPath(), {
  args: [
    'test',
    '--no-check',
    'integration/http_test.ts',
    'integration/engine_test.ts',
    'integration/protocol_test.ts',
    'integration/cache_test.ts',
    'integration/distribution_test.ts',
    'integration/locale_test.ts',
    '--allow-read',
    '--allow-write',
    '--allow-env',
    '--allow-net',
    '--allow-run',
    '--allow-sys=homedir,uid,gid,username,umask',
  ],
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
}).spawn()
const status = await child.status
if (!status.success) throw new Error(`Integration suite failed with exit code ${status.code}.`)
export {}
