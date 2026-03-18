import * as path from 'path'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import { getInputs } from './inputs'
import { setOutputs } from './outputs'
import { writeSummary } from './summary'
import { resolveUrls } from './container/port-resolver'
import { startContainer, waitForHealth, stopContainer } from './container/lifecycle'
import { runUserCommand } from './container/exec'
import { installCli, configureToken } from './cli/installer'
import { pushPull, environmentsCreate } from './cli/push-pull'
import {
  verifyRunnerReachable,
  recordFlush,
  recordStop,
  modeSwitch,
  recordFlushAndStop,
} from './cli/record-flush'

// ─── Post step ───────────────────────────────────────────────────────────────

async function runPostStep(): Promise<void> {
  const containerName = core.getState('containerName')
  if (!containerName) return // ephemeral mode never started
  await stopContainer(containerName)
}

// ─── Main step ───────────────────────────────────────────────────────────────

async function runMainStep(): Promise<void> {
  core.saveState('isPost', 'true')

  const inputs = getInputs()

  // Mask the API token immediately — before any logging
  if (inputs['api-token']) {
    core.setSecret(inputs['api-token'])
  }

  // Resolve wiremock-dir relative to workspace with path traversal guard
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd()
  const wiremockDir = path.resolve(workspace, inputs['wiremock-dir'])

  if (!wiremockDir.startsWith(workspace + path.sep) && wiremockDir !== workspace) {
    core.setFailed(
      `Invalid wiremock-dir: resolved path "${wiremockDir}" is outside the workspace "${workspace}". ` +
        `Do not use paths containing ".." or absolute paths outside the workspace.`
    )
    process.exit(1)
  }

  // ── Ephemeral container mode (run: input) ──────────────────────────────────
  if (inputs.run) {
    await runEphemeralMode(inputs, wiremockDir, workspace)
    return
  }

  // ── CLI command mode (command: input) ─────────────────────────────────────
  if (inputs.command) {
    await runCommandMode(inputs, wiremockDir)
    return
  }
}

async function runEphemeralMode(
  inputs: ReturnType<typeof getInputs>,
  wiremockDir: string,
  _workspace: string
): Promise<void> {
  // Reject Windows — Docker Linux containers not supported
  if (process.platform === 'win32') {
    core.setFailed(
      `::error title=Unsupported Runner OS::Ephemeral container mode requires Docker (Linux containers) ` +
        `and is not supported on Windows runners. Use ubuntu-latest, or use the sidecar services: pattern.`
    )
    process.exit(1)
  }

  // Verify Docker is available
  const dockerCheck = await exec.exec('docker', ['info'], { silent: true, ignoreReturnCode: true })
  if (dockerCheck !== 0) {
    core.setFailed(
      `::error title=Docker Required::WireMock Runner ephemeral mode requires Docker. ` +
        `Docker is not available on this runner. Either:\n` +
        `1. Use ubuntu-latest (Docker is pre-installed)\n` +
        `2. Use the sidecar pattern (services: block) instead\n` +
        `See: https://docs.wiremock.io/runner/overview`
    )
    process.exit(1)
  }

  // Start container
  let containerName: string
  try {
    containerName = await startContainer(inputs, wiremockDir)
  } catch (err) {
    const stderr = String(err)
    if (
      stderr.includes('port is already allocated') ||
      stderr.includes('address already in use')
    ) {
      core.setFailed(
        `::error title=Port Conflict::One or more requested ports are already in use on this runner. ` +
          `Specify different ports via the \`ports\` and \`runner-admin-port\` inputs.`
      )
    } else if (
      stderr.includes('Unable to find image') ||
      stderr.includes('manifest unknown')
    ) {
      core.setFailed(
        `::error title=Runner Image Not Found::Docker image wiremock/wiremock-runner:${inputs['runner-version']} ` +
          `could not be pulled. Check that the version tag exists:\n` +
          `https://hub.docker.com/r/wiremock/wiremock-runner/tags`
      )
    } else {
      core.setFailed(`Failed to start WireMock Runner container: ${err}`)
    }
    process.exit(1)
  }

  // Wait for health
  const adminUrl = `http://localhost:${inputs['runner-admin-port']}`
  try {
    await waitForHealth(adminUrl, inputs['health-check-retries'], inputs['health-check-interval'])
  } catch {
    // Capture startup logs before failing
    await core.group('WireMock Runner startup logs', async () => {
      await exec.exec('docker', ['logs', '--tail', '50', containerName], { ignoreReturnCode: true })
    })
    core.setFailed(
      `::error title=Runner Startup Failed::WireMock Runner did not become healthy within ` +
        `${inputs['health-check-retries'] * inputs['health-check-interval']} seconds. ` +
        `Check the startup logs above for errors.\n` +
        `Common causes:\n` +
        `- Port already in use\n` +
        `- Invalid WMC_API_TOKEN\n` +
        `- wiremock.yaml not found at .wiremock/wiremock.yaml`
    )
    process.exit(1)
  }

  // Resolve URLs
  const resolved = resolveUrls(wiremockDir, adminUrl, inputs.profile)

  // Set outputs
  setOutputs({
    mockApiUrl: resolved.primary,
    mockApiUrls: resolved.all,
    runnerAdminUrl: resolved.adminUrl,
  })

  // Build env for user's run command
  const runEnv: Record<string, string> = {
    WIREMOCK_URL: resolved.primary,
    WIREMOCK_ADMIN_URL: adminUrl,
    WIREMOCK_URLS: JSON.stringify(resolved.all),
    WIREMOCK_MODE: inputs.mode,
    WIREMOCK_PROFILE: inputs.profile ?? '',
  }

  // Execute user command
  let runFailed = false
  try {
    await runUserCommand({ command: inputs.run!, env: runEnv })
  } catch (err) {
    core.error(`Run command failed: ${err}`)
    runFailed = true
  }

  // If recording mode, try to flush even on failure
  let flushed: boolean | undefined
  if (inputs.mode === 'record-many') {
    if (runFailed) {
      core.info('Attempting recording flush despite run command failure...')
    }
    try {
      flushed = await recordFlush(inputs)
    } catch {
      flushed = false
    }
  }

  // Post-run pull (if requested and recording mode).
  // Run exec directly so a failure emits a warning instead of failing the step
  // (pushPull calls process.exit on error which bypasses the try/catch).
  if (inputs['post-run-pull'] && inputs.mode === 'record-many' && inputs['api-token']) {
    try {
      await installCli(inputs['wiremock-cli-version'])
      await configureToken(inputs['api-token'])

      const pullArgs = ['pull', 'mock-api', '--wiremock-dir', wiremockDir, '--all']
      if (inputs.profile) pullArgs.push('--profile', inputs.profile)

      let pullOutput = ''
      const pullExit = await exec.exec('wiremock', pullArgs, {
        ignoreReturnCode: true,
        listeners: {
          stdout: (data: Buffer) => { pullOutput += data.toString() },
          stderr: (data: Buffer) => { pullOutput += data.toString() },
        },
      })

      if (pullExit !== 0) {
        core.warning(
          `Post-run pull failed (exit ${pullExit}). ` +
            `Recordings were flushed to Cloud but stubs were not pulled locally.\n` +
            `Run 'command: pull' in a separate step to retry.\n` +
            `Output: ${pullOutput || '(none)'}`
        )
      } else {
        core.info('Post-run pull succeeded')
      }
    } catch (err) {
      core.warning(`Post-run pull failed: ${err}`)
    }
  }

  if (flushed !== undefined) {
    setOutputs({ recordingFlushed: flushed })
  }

  await writeSummary({
    operation: inputs.run ? `ephemeral:${inputs.mode}` : 'ephemeral',
    success: !runFailed,
    mockApiUrls: resolved.all,
    adminUrl,
  })

  if (runFailed) {
    core.setFailed('Run command failed (see above)')
    process.exit(1)
  }
}

async function runCommandMode(
  inputs: ReturnType<typeof getInputs>,
  wiremockDir: string
): Promise<void> {
  const command = inputs.command!

  // Commands requiring a live Runner
  const runnerCommands = ['record-flush', 'record-stop', 'record-flush-and-stop', 'mode-switch', 'resolve-urls']
  if (runnerCommands.includes(command)) {
    await verifyRunnerReachable(inputs['runner-admin-url'])
  }

  // Commands requiring the CLI
  const cliCommands = ['push', 'pull', 'environments-create']
  if (cliCommands.includes(command)) {
    await installCli(inputs['wiremock-cli-version'])
    if (inputs['api-token']) {
      await configureToken(inputs['api-token'])
    }
  }

  let mockApiUrls: Record<string, string> | undefined
  let recordingFlushed: boolean | undefined

  switch (command) {
    case 'push':
      await pushPull('push', inputs, wiremockDir)
      break

    case 'pull':
      await pushPull('pull', inputs, wiremockDir)
      break

    case 'environments-create':
      await environmentsCreate(inputs, wiremockDir)
      break

    case 'record-flush':
      recordingFlushed = await recordFlush(inputs)
      setOutputs({ recordingFlushed })
      break

    case 'record-stop':
      await recordStop(inputs)
      break

    case 'record-flush-and-stop':
      recordingFlushed = await recordFlushAndStop(inputs)
      setOutputs({ recordingFlushed })
      break

    case 'mode-switch':
      await modeSwitch(inputs)
      break

    case 'resolve-urls': {
      const resolved = resolveUrls(wiremockDir, inputs['runner-admin-url'], inputs.profile)
      mockApiUrls = resolved.all
      setOutputs({
        mockApiUrl: resolved.primary,
        mockApiUrls: resolved.all,
        runnerAdminUrl: resolved.adminUrl,
      })
      break
    }
  }

  await writeSummary({
    operation: command,
    success: true,
    mockApiUrls,
    adminUrl: runnerCommands.includes(command) ? inputs['runner-admin-url'] : undefined,
  })
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  if (core.getState('isPost') === 'true') {
    await runPostStep()
  } else {
    await runMainStep()
  }
}

run().catch(err => {
  core.setFailed(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
