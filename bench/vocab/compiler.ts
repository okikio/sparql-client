/** Isolated compiler acquisition and offline measurement admission. @module */
import type { OutputType } from '../../.mise/tasks/bench-command.ts'

/** One exact toolchain owns preparation, admission, measurements and reported identity. */
export const VERSION = '5.9.3'
/** The executable is resolved from Deno's global npm cache, never workspace node_modules. */
export const COMPILER = `npm:typescript@${VERSION}/bin/tsc`
/** Only preparation may acquire the compiler; admission and all measured children are offline. */
export type PhaseType = 'acquire' | 'admit'

/** Every compiler invocation after acquisition is isolated and cached-only. */
export function command(args: readonly string[]): readonly string[] {
  return [
    'run',
    '--no-config',
    '--no-lock',
    '--node-modules-dir=none',
    '--cached-only',
    '--quiet',
    '--allow-read',
    '--allow-env',
    COMPILER,
    ...args,
  ]
}

/**
 * Prepares the exact compiler before the caller starts any measured interval.
 *
 * The first version probe can acquire missing npm bytes in the inherited DENO_DIR.
 * A separate offline probe proves that the measured command can start from those
 * bytes. A failed download, mismatched pin or failed offline admission rejects;
 * there is no measured fallback that enables network access. The caller retains
 * both raw outputs through the injected collector, including unsuccessful exits.
 */
export async function prepare(
  run: (phase: PhaseType, args: readonly string[]) => Promise<OutputType>,
): Promise<void> {
  const offline = command(['--version'])
  const acquisition = offline.filter((arg) => arg !== '--cached-only')
  for (const [phase, args] of [['acquire', acquisition], ['admit', offline]] as const) {
    const result = await run(phase, args)
    if (
      !result.success || new TextDecoder().decode(result.stdout).trim() !== `Version ${VERSION}`
    ) {
      throw new Error(
        `Compiler ${phase} did not confirm TypeScript ${VERSION} (exit ${
          result.code ?? 'unreported'
        }).`,
        { cause: result.error },
      )
    }
  }
}
