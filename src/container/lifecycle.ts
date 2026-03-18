import { randomBytes } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import { HttpClient } from '@actions/http-client'
import { retry } from '../utils/retry'
import { parsePorts } from './port-resolver'
import type { Inputs } from '../inputs'

export function buildContainerName(): string {
  const runId = process.env.GITHUB_RUN_ID ?? 'local'
  const job = process.env.GITHUB_JOB ?? 'job'
  const suffix = randomBytes(3).toString('hex')
  return `wiremock-runner-${runId}-${job}-${suffix}`
}

/**
 * Starts the wiremock-runner container and returns the container name.
 * Saves the container name to state so the post step can clean up.
 */
export async function startContainer(inputs: Inputs, wiremockDir: string): Promise<string> {
  const containerName = buildContainerName()
  core.saveState('containerName', containerName)

  const mockPorts = parsePorts(inputs.ports)
  const adminPort = inputs['runner-admin-port']
  const image = `wiremock/wiremock-runner:${inputs['runner-version']}`

  const args = [
    'run',
    '--detach',
    '--name', containerName,
    '-v', `${wiremockDir}:/work/.wiremock`,
  ]

  // Expose mock service ports
  for (const port of mockPorts) {
    args.push('-p', `${port}:${port}`)
  }

  // Expose admin port
  args.push('-p', `${adminPort}:${adminPort}`)

  // Environment variables
  args.push('-e', `WMC_DEFAULT_MODE=${inputs.mode}`)
  args.push('-e', `WMC_ADMIN_PORT=${adminPort}`)

  // Write token to a temp file so it doesn't appear in the process list.
  // docker inspect can still reveal env vars to anyone with Docker socket access,
  // but this prevents exposure via /proc/<pid>/cmdline on shared runners.
  let envFile: string | undefined
  if (inputs['api-token']) {
    envFile = path.join(os.tmpdir(), `wmc-env-${randomBytes(8).toString('hex')}`)
    fs.writeFileSync(envFile, `WMC_API_TOKEN=${inputs['api-token']}\n`, { mode: 0o600 })
    args.push('--env-file', envFile)
  }

  if (inputs.profile) {
    if (inputs.mode === 'serve') {
      args.push('-e', `WMC_RUN_PROFILE=${inputs.profile}`)
    } else {
      args.push('-e', `WMC_RECORD_MANY_PROFILE=${inputs.profile}`)
    }
  }

  args.push(image)

  core.info(`Starting WireMock Runner container: ${containerName}`)
  try {
    await exec.exec('docker', args)
  } finally {
    if (envFile) {
      try { fs.unlinkSync(envFile) } catch { /* ignore — file may not exist */ }
    }
  }

  return containerName
}

/**
 * Waits for the Runner admin health endpoint to respond OK.
 */
export async function waitForHealth(
  adminUrl: string,
  retries: number,
  intervalSeconds: number
): Promise<void> {
  const healthUrl = `${adminUrl.replace(/\/$/, '')}/__/health`

  core.info(`Waiting for Runner health at ${healthUrl}`)

  await retry(
    async () => {
      const client = new HttpClient('wiremock-runner-action', [], { socketTimeout: 3000 })
      let statusCode: number | undefined
      try {
        const res = await client.get(healthUrl)
        statusCode = res.message.statusCode
      } catch {
        // connection refused or timeout
      }
      if (statusCode === undefined || statusCode < 200 || statusCode >= 300) {
        throw new Error(`Health check failed: HTTP ${statusCode ?? 'no response'}`)
      }
      core.info(`Runner is healthy (HTTP ${statusCode})`)
    },
    {
      retries,
      intervalSeconds,
      onAttempt: (attempt, total) => {
        core.info(`Health check attempt ${attempt}/${total}...`)
      },
    }
  )
}

/**
 * Stops the named container gracefully (5s timeout, then SIGKILL).
 * Must complete within the ~10s post-step grace window on cancellation.
 */
export async function stopContainer(containerName: string): Promise<void> {
  try {
    await exec.exec('docker', ['stop', '--time', '5', containerName])
    core.info(`Container ${containerName} stopped`)
  } catch {
    core.warning(`Could not stop container ${containerName} — it may have already exited.`)
  }
  // Always remove the container so it doesn't accumulate on the runner
  await exec.exec('docker', ['rm', '-f', containerName], { ignoreReturnCode: true })
}
