import * as core from '@actions/core'
import * as exec from '@actions/exec'

const PACKAGE_NAME = '@wiremock/cli'

/**
 * Reads the globally installed @wiremock/cli version via `npm list -g --json`,
 * or undefined if it isn't installed. Global npm installs persist across steps
 * within the same job, so this lets repeated action invocations in one job skip
 * a redundant `npm install -g`.
 */
async function getInstalledVersion(): Promise<string | undefined> {
  let stdout = ''
  try {
    await exec.exec('npm', ['list', '-g', PACKAGE_NAME, '--depth=0', '--json'], {
      ignoreReturnCode: true,
      silent: true,
      listeners: { stdout: (data: Buffer) => { stdout += data.toString() } },
    })
  } catch {
    return undefined
  }

  try {
    const parsed = JSON.parse(stdout)
    return parsed?.dependencies?.[PACKAGE_NAME]?.version
  } catch {
    return undefined
  }
}

/**
 * Installs @wiremock/cli globally via npm.
 * Skips the install if the requested version (or any version, for "latest")
 * is already installed on this runner.
 */
export async function installCli(version: string): Promise<void> {
  const installed = await getInstalledVersion()
  if (installed && (version === 'latest' || installed === version)) {
    core.info(`@wiremock/cli@${installed} already installed, skipping install`)
    return
  }

  const pkg = version === 'latest' ? PACKAGE_NAME : `${PACKAGE_NAME}@${version}`
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
