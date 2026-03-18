import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as yaml from 'js-yaml'
import type { Inputs } from '../inputs'

const HEALTH_PATH = '/__/health'
const FLUSH_PATH = '/v1/record-many/flush'
const MODE_SWITCH_PATH = '/v1/mode'

/**
 * Verifies the Runner admin endpoint is reachable.
 * Throws with F-15 error message if not.
 */
export async function verifyRunnerReachable(adminUrl: string): Promise<void> {
  const healthUrl = `${adminUrl.replace(/\/$/, '')}${HEALTH_PATH}`

  let httpCode = ''
  const exitCode = await exec.exec(
    'curl',
    ['-s', '--max-time', '5', '--output', '/dev/null', '--write-out', '%{http_code}', healthUrl],
    {
      silent: true,
      ignoreReturnCode: true,
      listeners: {
        stdout: (data: Buffer) => { httpCode += data.toString() },
      },
    }
  )

  if (exitCode !== 0 || !httpCode.startsWith('2')) {
    core.setFailed(
      `::error title=Runner Not Reachable::Cannot connect to WireMock Runner at ${adminUrl}. Ensure:\n` +
        `1. The Runner container or service is started and healthy before this step\n` +
        `2. The runner-admin-url input matches the port the Runner is listening on\n` +
        `3. If using a sidecar (services:), add a health check to the service definition`
    )
    process.exit(1)
  }
}

/**
 * Flushes buffered recordings to WireMock Cloud.
 * Sets `recording-flushed` output. On failure, emits a warning (not an error)
 * because partial recordings may still have been saved.
 */
export async function recordFlush(inputs: Inputs): Promise<boolean> {
  const adminUrl = inputs['runner-admin-url'].replace(/\/$/, '')
  const flushUrl = `${adminUrl}${FLUSH_PATH}`

  const includeServices = inputs['include-services']
  const body = includeServices
    ? JSON.stringify({ services: includeServices.split(',').map(s => s.trim()) })
    : '{}'

  let responseBody = ''
  let httpCode = ''

  const exitCode = await exec.exec(
    'curl',
    [
      '-s',
      '-X', 'POST',
      '-H', 'Content-Type: application/json',
      '-d', body,
      '--output', '-',
      '--write-out', '\n%{http_code}',
      flushUrl,
    ],
    {
      silent: true,
      ignoreReturnCode: true,
      listeners: {
        stdout: (data: Buffer) => { responseBody += data.toString() },
      },
    }
  )

  const parts = responseBody.trim().split('\n')
  httpCode = parts[parts.length - 1]

  if (exitCode !== 0 || !httpCode.startsWith('2')) {
    core.warning(
      `Recording flush returned HTTP ${httpCode || 'no response'}: ${parts.slice(0, -1).join('\n')}\n` +
        `Recordings in progress > perfect flush. Recordings up to the last batch may still have been saved ` +
        `if max-batch-requests was configured.\n` +
        `To fail the step on flush failure, check: steps.<id>.outputs.recording-flushed == 'false'`
    )
    return false
  }

  core.info(`Recording flush succeeded (HTTP ${httpCode})`)
  return true
}

/**
 * Switches the Runner to a different mode (serve or record-many).
 * Optionally passes additional config fields from `runner-config` input.
 */
export async function modeSwitch(inputs: Inputs): Promise<void> {
  const adminUrl = inputs['runner-admin-url'].replace(/\/$/, '')
  const switchUrl = `${adminUrl}${MODE_SWITCH_PATH}`
  const targetMode = inputs['target-mode']!

  // Parse runner-config YAML string if provided
  // Config values must be strings per the Runner API spec
  let extraConfig: Record<string, string> = {}
  if (inputs['runner-config']) {
    try {
      const parsed = yaml.load(inputs['runner-config'])
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          extraConfig[k] = String(v)
        }
      }
    } catch (err) {
      core.warning(`Failed to parse runner-config YAML: ${err}. Ignoring extra config.`)
    }
  }

  const bodyObj: Record<string, unknown> = { mode: targetMode }
  if (Object.keys(extraConfig).length > 0) {
    bodyObj.config = extraConfig
  }
  const body = JSON.stringify(bodyObj)

  let responseBody = ''
  let httpCode = ''

  const exitCode = await exec.exec(
    'curl',
    [
      '-s',
      '-X', 'PUT',
      '-H', 'Content-Type: application/json',
      '-d', body,
      '--output', '-',
      '--write-out', '\n%{http_code}',
      switchUrl,
    ],
    {
      silent: true,
      ignoreReturnCode: true,
      listeners: {
        stdout: (data: Buffer) => { responseBody += data.toString() },
      },
    }
  )

  const parts = responseBody.trim().split('\n')
  httpCode = parts[parts.length - 1]

  if (exitCode !== 0 || !httpCode.startsWith('2')) {
    if (httpCode === '409') {
      core.warning(
        `Runner is already in ${targetMode} mode. Proceeding (the Runner handles this gracefully).`
      )
      return
    }
    core.setFailed(
      `::error title=Mode Switch Failed::Could not switch Runner to ${targetMode} mode. ` +
        `HTTP ${httpCode}: ${parts.slice(0, -1).join('\n')}`
    )
    process.exit(1)
  }

  core.info(`Runner switched to ${targetMode} mode`)
}

/**
 * Stops recording (switches Runner back to serve mode).
 */
export async function recordStop(inputs: Inputs): Promise<void> {
  const modeSwitchInputs = { ...inputs, 'target-mode': 'serve' as const }
  await modeSwitch(modeSwitchInputs)
}

/**
 * Flushes recordings then switches to serve mode.
 * This is the recommended pattern for ending a recording session.
 */
export async function recordFlushAndStop(inputs: Inputs): Promise<boolean> {
  const flushed = await recordFlush(inputs)
  await recordStop(inputs)
  return flushed
}
