/** Runs the real-engine and Testcontainers integration suite. @module */
const child = new Deno.Command(Deno.execPath(), {
  args: [
    'test',
    'integration',
    '--allow-read',
    '--allow-write',
    '--allow-env',
    '--allow-net',
    '--allow-run',
    '--allow-sys=homedir,uid,gid,username',
  ],
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
}).spawn()
const status = await child.status
if (!status.success) throw new Error(`Integration suite failed with exit code ${status.code}.`)
export {}
