import * as core from '@actions/core'
import * as exec from '@actions/exec'
import { installCli, configureToken } from '../../cli/installer'

jest.mock('@actions/core')
jest.mock('@actions/exec')

const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>
const mockInfo = core.info as jest.MockedFunction<typeof core.info>

const NPM_LIST_ARGS = ['list', '-g', '@wiremock/cli', '--depth=0', '--json']

/** Makes the `npm list -g` call resolve as if the given version is (or isn't) installed. */
function mockNpmList(installedVersion?: string): void {
  mockExec.mockImplementation(async (command, args, options) => {
    if (command === 'npm' && args?.[0] === 'list') {
      const json = installedVersion
        ? JSON.stringify({ dependencies: { '@wiremock/cli': { version: installedVersion } } })
        : JSON.stringify({ dependencies: {} })
      options?.listeners?.stdout?.(Buffer.from(json))
      return 0
    }
    return 0
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockNpmList(undefined)
})

// ─── installCli ───────────────────────────────────────────────────────────────

describe('installCli', () => {
  it('installs @wiremock/cli@latest when version is "latest"', async () => {
    await installCli('latest')
    expect(mockExec).toHaveBeenCalledWith('npm', ['install', '-g', '@wiremock/cli'])
  })

  it('installs pinned version when version is a semver', async () => {
    await installCli('1.2.3')
    expect(mockExec).toHaveBeenCalledWith('npm', ['install', '-g', '@wiremock/cli@1.2.3'])
  })

  it('skips npm install when the requested pinned version is already installed', async () => {
    mockNpmList('1.2.3')
    await installCli('1.2.3')
    expect(mockExec).toHaveBeenCalledTimes(1)
    expect(mockExec).toHaveBeenCalledWith('npm', NPM_LIST_ARGS, expect.anything())
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('already installed'))
  })

  it('skips npm install when "latest" is requested and any version is already installed', async () => {
    mockNpmList('9.9.9')
    await installCli('latest')
    expect(mockExec).toHaveBeenCalledTimes(1)
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('already installed'))
  })

  it('reinstalls when a different pinned version is installed', async () => {
    mockNpmList('1.0.0')
    await installCli('2.0.0')
    expect(mockExec).toHaveBeenCalledWith('npm', ['install', '-g', '@wiremock/cli@2.0.0'])
  })

  it('installs when `npm list` throws (e.g. no global packages yet)', async () => {
    mockExec.mockImplementation(async (command, args) => {
      if (command === 'npm' && args?.[0] === 'list') {
        throw new Error('npm error: no global packages')
      }
      return 0
    })
    await installCli('latest')
    expect(mockExec).toHaveBeenCalledWith('npm', ['install', '-g', '@wiremock/cli'])
  })

  it('installs when `npm list` returns unparseable output', async () => {
    mockExec.mockImplementation(async (command, args, options) => {
      if (command === 'npm' && args?.[0] === 'list') {
        options?.listeners?.stdout?.(Buffer.from('not json'))
        return 0
      }
      return 0
    })
    await installCli('latest')
    expect(mockExec).toHaveBeenCalledWith('npm', ['install', '-g', '@wiremock/cli'])
  })

  it('logs success after install', async () => {
    await installCli('latest')
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('installed successfully'))
  })
})

// ─── configureToken ───────────────────────────────────────────────────────────

describe('configureToken', () => {
  it('calls wiremock config set with silent: true', async () => {
    await configureToken('my-secret-token')
    expect(mockExec).toHaveBeenCalledWith(
      'wiremock',
      ['config', 'set', 'api_token', 'my-secret-token'],
      { silent: true }
    )
  })
})
