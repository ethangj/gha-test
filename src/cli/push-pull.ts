import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fs from 'fs'
import * as path from 'path'
import type { Inputs } from '../inputs'

/**
 * Runs `wiremock push` or `wiremock pull`.
 * Handles --all flag and --mock-api flag.
 */
export async function pushPull(
  operation: 'push' | 'pull',
  inputs: Inputs,
  wiremockDir: string
): Promise<void> {
  const args = [operation, 'mock-api', '--wiremock-dir', wiremockDir]

  if (inputs.all) {
    args.push('--all')
  } else if (inputs['mock-api']) {
    args.push(inputs['mock-api'])
  }

  if (inputs.profile) {
    args.push('--profile', inputs.profile)
  }

  let stderr = ''
  const exitCode = await exec.exec('wiremock', args, {
    listeners: {
      stderr: (data: Buffer) => { stderr += data.toString() },
    },
  })

  if (exitCode !== 0) {
    handleCliError(stderr, operation)
  }
}

/**
 * Runs `wiremock environments create` to create a new environment profile.
 * Handles idempotency: if the profile file already exists, either skip (force=false)
 * or fail (force=true).
 */
export async function environmentsCreate(inputs: Inputs, wiremockDir: string): Promise<void> {
  const profile = inputs.profile
  if (!profile) {
    throw new Error('`profile` input is required for environments-create')
  }

  const profilePath = path.join(wiremockDir, `wiremock-${profile}.yaml`)

  if (fs.existsSync(profilePath)) {
    if (inputs.force) {
      core.setFailed(
        `::error title=Profile Already Exists::Environment profile '${profile}' already exists ` +
          `at ${profilePath}. The CLI does not support overwriting an existing environment. ` +
          `Delete the file manually if you intended to recreate it.`
      )
      process.exit(1)
    } else {
      core.notice(`Environment profile '${profile}' already exists at ${profilePath}. Skipping (idempotent).`)
      return
    }
  }

  const args = ['environments', 'create', '--profile', profile, '--wiremock-dir', wiremockDir]

  let stderr = ''
  const exitCode = await exec.exec('wiremock', args, {
    listeners: {
      stderr: (data: Buffer) => { stderr += data.toString() },
    },
  })

  if (exitCode !== 0) {
    handleCliError(stderr, 'environments-create')
  }
}

function handleCliError(stderr: string, operation: string): never {
  const lower = stderr.toLowerCase()

  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid token')) {
    core.setFailed(
      `::error title=Authentication Failed::WireMock API token is invalid or expired.\n` +
        `Verify WIREMOCK_API_TOKEN secret at:\nhttps://app.wiremock.cloud/account/security`
    )
  } else if (
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('503') ||
    lower.includes('502') ||
    lower.includes('network error')
  ) {
    core.warning(
      `${operation} failed due to a network error: ${stderr}\n` +
        `This may be a transient network error. Re-running the job is safe — ` +
        `push and pull operations are idempotent.`
    )
  } else if (
    lower.includes('profile file not found') ||
    lower.includes('profile not found') ||
    lower.includes('no such file')
  ) {
    core.setFailed(
      `::error title=Profile Not Found::Profile file referenced by '${operation}' was not found.\n` +
        `Run the environments-create command first.`
    )
  } else {
    core.setFailed(`${operation} failed:\n${stderr}`)
  }
  process.exit(1)
}
