import * as exec from '@actions/exec'
import * as core from '@actions/core'

export interface RunCommandOptions {
  command: string
  env: Record<string, string>
}

/**
 * Executes the user-supplied `run:` command in a shell subprocess,
 * injecting WireMock service URLs as environment variables.
 */
export async function runUserCommand(options: RunCommandOptions): Promise<void> {
  const { command, env } = options

  core.info(`Executing: ${command}`)

  const exitCode = await exec.exec('bash', ['-c', command], {
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((kv): kv is [string, string] => kv[1] !== undefined)
      ),
      ...env,
    },
  })

  if (exitCode !== 0) {
    throw new Error(`Command exited with code ${exitCode}: ${command}`)
  }
}
