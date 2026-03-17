import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as tc from '@actions/tool-cache'

const TOOL_NAME = 'wiremock-cli'

/**
 * Installs @wiremock/cli globally via npm.
 * Uses tool-cache to avoid redundant installs on self-hosted runners.
 */
export async function installCli(version: string): Promise<void> {
  // Check tool cache first (useful on self-hosted runners)
  const cached = tc.find(TOOL_NAME, version)
  if (cached) {
    core.info(`Using cached @wiremock/cli@${version}`)
    return
  }

  const pkg = version === 'latest' ? '@wiremock/cli' : `@wiremock/cli@${version}`
  core.info(`Installing ${pkg}...`)

  await exec.exec('npm', ['install', '-g', pkg])

  core.info(`@wiremock/cli installed successfully`)
}

/**
 * Sets the WireMock Cloud API token in the CLI config.
 * Writes to a config file (not stdout) so the token does not appear in logs.
 */
export async function configureToken(apiToken: string): Promise<void> {
  await exec.exec('wiremock', ['config', 'set', 'api_token', apiToken], {
    silent: true,
  })
}
