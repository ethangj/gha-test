import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fs from 'fs'
import * as path from 'path'
import { ActionFatalError } from '../errors'
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
  // CLI command: wiremock push mock-api --all --wiremock-dir <dir> [--profile <profile>]
  //              wiremock push mock-api <service-id> --wiremock-dir <dir> [--profile <profile>]
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
    ignoreReturnCode: true,
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
      // force: true = "fail hard if already exists" — a safety guard against accidental re-creation.
      // The WireMock CLI does not support overwriting an existing environment profile.
      core.setFailed(
        `::error title=Profile Already Exists::Environment profile '${profile}' already exists ` +
          `at ${profilePath}. The CLI does not support overwriting an existing environment. ` +
          `Delete the file manually if you intended to recreate it.`
      )
      throw new ActionFatalError()
    } else {
      // force: false (default) = idempotent skip
      core.notice(`Environment profile '${profile}' already exists at ${profilePath}. Skipping (idempotent).`)
      return
    }
  }

  const args = ['environments', 'create', '--profile', profile]

  let stderr = ''
  const exitCode = await exec.exec('wiremock', args, {
    ignoreReturnCode: true,
    listeners: {
      stderr: (data: Buffer) => { stderr += data.toString() },
    },
  })

  if (exitCode !== 0) {
    handleCliError(stderr, 'environments-create')
  }
}

function handleCliError(stderr: string, operation: string): void {
  const lower = stderr.toLowerCase()

  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid token')) {
    core.setFailed(
      `::error title=Authentication Failed::WireMock API token is invalid or expired.\n` +
        `Verify WIREMOCK_API_TOKEN secret at:\nhttps://app.wiremock.cloud/account/security`
    )
    throw new ActionFatalError()
  } else if (
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('503') ||
    lower.includes('502') ||
    lower.includes('network error')
  ) {
    // Transient network error — warn but don't fail the step (push/pull are idempotent)
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
    throw new ActionFatalError()
  } else {
    core.setFailed(`${operation} failed:\n${stderr}`)
    throw new ActionFatalError()
  }
}
