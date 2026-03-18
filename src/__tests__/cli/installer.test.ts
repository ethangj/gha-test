import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as tc from '@actions/tool-cache'
import { installCli, configureToken } from '../../cli/installer'

jest.mock('@actions/core')
jest.mock('@actions/exec')
jest.mock('@actions/tool-cache')

const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>
const mockInfo = core.info as jest.MockedFunction<typeof core.info>
const mockFind = tc.find as jest.MockedFunction<typeof tc.find>

beforeEach(() => {
  jest.clearAllMocks()
  mockExec.mockResolvedValue(0)
  mockFind.mockReturnValue('')
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

  it('skips npm install when version is cached', async () => {
    mockFind.mockReturnValue('/opt/hostedtoolcache/wiremock-cli/1.2.3/x64')
    await installCli('1.2.3')
    expect(mockExec).not.toHaveBeenCalled()
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('cached'))
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
