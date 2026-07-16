import * as core from '@actions/core'
import * as exec from '@actions/exec'
import { run, runPostStep, runMainStep, runEphemeralMode, runCommandMode } from '../main'
import { ActionFatalError } from '../errors'
import { getInputs } from '../inputs'
import { setOutputs } from '../outputs'
import { writeSummary } from '../summary'
import { resolveUrls } from '../container/port-resolver'
import { startContainer, waitForHealth, stopContainer } from '../container/lifecycle'
import { runUserCommand } from '../container/exec'
import { installCli, configureToken } from '../cli/installer'
import { pushPull, environmentsCreate } from '../cli/push-pull'
import {
  verifyRunnerReachable,
  recordFlush,
  recordStop,
  modeSwitch,
  recordFlushAndStop,
} from '../cli/record-flush'
import { makeInputs } from './fixtures/inputs'

jest.mock('@actions/core')
jest.mock('@actions/exec')
jest.mock('../inputs')
jest.mock('../outputs')
jest.mock('../summary')
jest.mock('../container/port-resolver')
jest.mock('../container/lifecycle')
jest.mock('../container/exec')
jest.mock('../cli/installer')
jest.mock('../cli/push-pull')
jest.mock('../cli/record-flush')

const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>
const mockGetInput = core.getInput as jest.MockedFunction<typeof core.getInput>
const mockGetState = core.getState as jest.MockedFunction<typeof core.getState>
const mockSetSecret = core.setSecret as jest.MockedFunction<typeof core.setSecret>
const mockSetFailed = core.setFailed as jest.MockedFunction<typeof core.setFailed>
const mockWarning = core.warning as jest.MockedFunction<typeof core.warning>
const mockGroup = core.group as jest.MockedFunction<typeof core.group>
const mockGetInputs = getInputs as jest.MockedFunction<typeof getInputs>
const mockSetOutputs = setOutputs as jest.MockedFunction<typeof setOutputs>
const mockWriteSummary = writeSummary as jest.MockedFunction<typeof writeSummary>
const mockResolveUrls = resolveUrls as jest.MockedFunction<typeof resolveUrls>
const mockStartContainer = startContainer as jest.MockedFunction<typeof startContainer>
const mockWaitForHealth = waitForHealth as jest.MockedFunction<typeof waitForHealth>
const mockStopContainer = stopContainer as jest.MockedFunction<typeof stopContainer>
const mockRunUserCommand = runUserCommand as jest.MockedFunction<typeof runUserCommand>
const mockInstallCli = installCli as jest.MockedFunction<typeof installCli>
const mockConfigureToken = configureToken as jest.MockedFunction<typeof configureToken>
const mockPushPull = pushPull as jest.MockedFunction<typeof pushPull>
const mockEnvironmentsCreate = environmentsCreate as jest.MockedFunction<typeof environmentsCreate>
const mockVerifyRunnerReachable = verifyRunnerReachable as jest.MockedFunction<typeof verifyRunnerReachable>
const mockRecordFlush = recordFlush as jest.MockedFunction<typeof recordFlush>
const mockRecordStop = recordStop as jest.MockedFunction<typeof recordStop>
const mockModeSwitch = modeSwitch as jest.MockedFunction<typeof modeSwitch>
const mockRecordFlushAndStop = recordFlushAndStop as jest.MockedFunction<typeof recordFlushAndStop>

const WORKSPACE = '/workspace'
const ORIGINAL_PLATFORM = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.GITHUB_WORKSPACE = WORKSPACE
  mockExec.mockResolvedValue(0)
  mockGetInput.mockReturnValue('')
  mockGetState.mockReturnValue('')
  mockGroup.mockImplementation(async (_name: string, fn: () => Promise<unknown>) => fn())
  mockResolveUrls.mockReturnValue({
    primary: 'http://localhost:8080',
    all: { 'todos-api': 'http://localhost:8080' },
    services: [],
    adminUrl: 'http://localhost:9999',
  })
  mockStartContainer.mockResolvedValue('wiremock-runner-test')
  mockWaitForHealth.mockResolvedValue(undefined)
  mockRunUserCommand.mockResolvedValue(undefined)
  mockRecordFlush.mockResolvedValue(true)
  mockRecordFlushAndStop.mockResolvedValue(true)
  mockInstallCli.mockResolvedValue(undefined)
  mockConfigureToken.mockResolvedValue(undefined)
})

afterEach(() => {
  delete process.env.GITHUB_WORKSPACE
  setPlatform(ORIGINAL_PLATFORM)
})

// ─── run ──────────────────────────────────────────────────────────────────────

describe('run', () => {
  it('runs the post step when isPost state is "true"', async () => {
    mockGetState.mockImplementation((key: string) => (key === 'isPost' ? 'true' : ''))
    await run()
    expect(mockGetInputs).not.toHaveBeenCalled()
  })

  it('runs the main step otherwise', async () => {
    mockGetState.mockReturnValue('')
    mockGetInputs.mockReturnValue(makeInputs())
    await run()
    expect(mockGetInputs).toHaveBeenCalled()
  })
})

// ─── runPostStep ──────────────────────────────────────────────────────────────

describe('runPostStep', () => {
  it('does nothing when no container was started', async () => {
    mockGetState.mockReturnValue('')
    await runPostStep()
    expect(mockStopContainer).not.toHaveBeenCalled()
  })

  it('stops the container when one was started', async () => {
    mockGetState.mockImplementation((key: string) => (key === 'containerName' ? 'wiremock-runner-test' : ''))
    await runPostStep()
    expect(mockStopContainer).toHaveBeenCalledWith('wiremock-runner-test')
  })
})

// ─── runMainStep ──────────────────────────────────────────────────────────────

describe('runMainStep', () => {
  it('masks the api-token input before validation', async () => {
    mockGetInput.mockImplementation((key: string) => (key === 'api-token' ? 'super-secret' : ''))
    mockGetInputs.mockReturnValue(makeInputs())
    await runMainStep()
    expect(mockSetSecret).toHaveBeenCalledWith('super-secret')
  })

  it('does not mask when the api-token input is empty', async () => {
    mockGetInputs.mockReturnValue(makeInputs())
    await runMainStep()
    expect(mockSetSecret).not.toHaveBeenCalled()
  })

  it('fails when wiremock-dir resolves outside the workspace', async () => {
    mockGetInputs.mockReturnValue(makeInputs({ 'wiremock-dir': '../outside' }))
    await expect(runMainStep()).rejects.toThrow(ActionFatalError)
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid wiremock-dir'))
  })

  it('proceeds when wiremock-dir resolves inside the workspace', async () => {
    mockGetInputs.mockReturnValue(makeInputs())
    await expect(runMainStep()).resolves.toBeUndefined()
    expect(mockSetFailed).not.toHaveBeenCalled()
  })

  it('dispatches to ephemeral mode when `run` is set', async () => {
    mockGetInputs.mockReturnValue(makeInputs({ run: 'echo hi' }))
    await runMainStep()
    // ephemeral mode always checks docker availability first
    expect(mockExec).toHaveBeenCalledWith('docker', ['info'], expect.anything())
  })

  it('dispatches to command mode when `command` is set', async () => {
    mockGetInputs.mockReturnValue(makeInputs({ command: 'mode-switch', 'target-mode': 'serve' }))
    await runMainStep()
    // command mode always writes a summary keyed by the command name
    expect(mockWriteSummary).toHaveBeenCalledWith(expect.objectContaining({ operation: 'mode-switch' }))
  })
})

// ─── runEphemeralMode ─────────────────────────────────────────────────────────

describe('runEphemeralMode', () => {
  const inputs = () => makeInputs({ run: 'echo hi' })
  const wiremockDir = '/workspace/.wiremock'

  it('fails on Windows runners', async () => {
    setPlatform('win32')
    await expect(runEphemeralMode(inputs(), wiremockDir)).rejects.toThrow(ActionFatalError)
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('Unsupported Runner OS'))
  })

  it('fails when docker is not available', async () => {
    mockExec.mockImplementation(async (cmd, args) => ((cmd === 'docker' && args?.[0] === 'info') ? 1 : 0))
    await expect(runEphemeralMode(inputs(), wiremockDir)).rejects.toThrow(ActionFatalError)
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('Docker Required'))
  })

  it('reports a port-conflict-specific error when the container fails to start due to a port conflict', async () => {
    mockStartContainer.mockRejectedValue(new Error('port is already allocated'))
    await expect(runEphemeralMode(inputs(), wiremockDir)).rejects.toThrow(ActionFatalError)
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('Port Conflict'))
  })

  it('reports a generic error for other container start failures', async () => {
    mockStartContainer.mockRejectedValue(new Error('something unexpected'))
    await expect(runEphemeralMode(inputs(), wiremockDir)).rejects.toThrow(ActionFatalError)
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('Failed to start WireMock Runner container')
    )
  })

  it('captures startup logs and fails when the health check times out', async () => {
    mockWaitForHealth.mockRejectedValue(new Error('timed out'))
    await expect(runEphemeralMode(inputs(), wiremockDir)).rejects.toThrow(ActionFatalError)
    expect(mockExec).toHaveBeenCalledWith(
      'docker',
      ['logs', '--tail', '50', 'wiremock-runner-test'],
      expect.anything()
    )
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('Runner Startup Failed'))
  })

  it('resolves URLs, sets outputs, and runs the user command on the happy path', async () => {
    await runEphemeralMode(inputs(), wiremockDir)
    expect(mockSetOutputs).toHaveBeenCalledWith({
      mockApiUrl: 'http://localhost:8080',
      mockApiUrls: { 'todos-api': 'http://localhost:8080' },
      runnerAdminUrl: 'http://localhost:9999',
    })
    expect(mockRunUserCommand).toHaveBeenCalledWith({
      command: 'echo hi',
      env: expect.objectContaining({
        WIREMOCK_URL: 'http://localhost:8080',
        WIREMOCK_MODE: 'serve',
      }),
    })
    expect(mockWriteSummary).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
  })

  it('fails the step when the user run command fails', async () => {
    mockRunUserCommand.mockRejectedValue(new Error('exit 1'))
    await expect(runEphemeralMode(inputs(), wiremockDir)).rejects.toThrow(ActionFatalError)
    expect(mockWriteSummary).toHaveBeenCalledWith(expect.objectContaining({ success: false }))
    expect(mockSetFailed).toHaveBeenCalledWith('Run command failed (see above)')
  })

  it('attempts a recording flush in record-many mode, even when the run command fails', async () => {
    mockRunUserCommand.mockRejectedValue(new Error('exit 1'))
    await expect(
      runEphemeralMode(makeInputs({ run: 'echo hi', mode: 'record-many' }), wiremockDir)
    ).rejects.toThrow(ActionFatalError)
    expect(mockRecordFlush).toHaveBeenCalled()
    expect(mockSetOutputs).toHaveBeenCalledWith({ recordingFlushed: true })
  })

  it('treats a flush exception as a failed flush rather than throwing', async () => {
    mockRecordFlush.mockRejectedValue(new Error('network error'))
    await runEphemeralMode(makeInputs({ run: 'echo hi', mode: 'record-many' }), wiremockDir)
    expect(mockSetOutputs).toHaveBeenCalledWith({ recordingFlushed: false })
  })

  it('pulls stubs after recording when post-run-pull is enabled', async () => {
    mockExec.mockImplementation(async (cmd, args) => ((cmd === 'wiremock' && args?.[0] === 'pull') ? 0 : 0))
    await runEphemeralMode(
      makeInputs({ run: 'echo hi', mode: 'record-many', 'post-run-pull': true, 'api-token': 'tok' }),
      wiremockDir
    )
    expect(mockInstallCli).toHaveBeenCalled()
    expect(mockConfigureToken).toHaveBeenCalledWith('tok')
    expect(mockExec).toHaveBeenCalledWith(
      'wiremock',
      ['pull', 'mock-api', '--wiremock-dir', wiremockDir, '--all'],
      expect.anything()
    )
  })

  it('warns (does not fail the step) when post-run-pull fails', async () => {
    mockExec.mockImplementation(async (cmd, args) => ((cmd === 'wiremock' && args?.[0] === 'pull') ? 1 : 0))
    await runEphemeralMode(
      makeInputs({ run: 'echo hi', mode: 'record-many', 'post-run-pull': true, 'api-token': 'tok' }),
      wiremockDir
    )
    expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('Post-run pull failed'))
    expect(mockSetFailed).not.toHaveBeenCalled()
  })

  it('warns (does not fail the step) when installing the CLI for post-run-pull throws', async () => {
    mockInstallCli.mockRejectedValue(new Error('npm registry unreachable'))
    await runEphemeralMode(
      makeInputs({ run: 'echo hi', mode: 'record-many', 'post-run-pull': true, 'api-token': 'tok' }),
      wiremockDir
    )
    expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('Post-run pull failed'))
    expect(mockSetFailed).not.toHaveBeenCalled()
  })
})

// ─── runCommandMode ───────────────────────────────────────────────────────────

describe('runCommandMode', () => {
  const wiremockDir = '/workspace/.wiremock'

  it('verifies the runner is reachable for runner-dependent commands', async () => {
    await runCommandMode(makeInputs({ command: 'resolve-urls' }), wiremockDir)
    expect(mockVerifyRunnerReachable).toHaveBeenCalledWith('http://localhost:9999')
  })

  it('does not verify runner reachability for CLI-only commands', async () => {
    await runCommandMode(makeInputs({ command: 'push', all: true }), wiremockDir)
    expect(mockVerifyRunnerReachable).not.toHaveBeenCalled()
  })

  it('installs and configures the CLI for CLI commands when api-token is set', async () => {
    await runCommandMode(makeInputs({ command: 'push', all: true, 'api-token': 'tok' }), wiremockDir)
    expect(mockInstallCli).toHaveBeenCalledWith('latest')
    expect(mockConfigureToken).toHaveBeenCalledWith('tok')
  })

  it('skips configureToken when api-token is not set', async () => {
    await runCommandMode(makeInputs({ command: 'push', all: true, 'api-token': undefined }), wiremockDir)
    expect(mockInstallCli).toHaveBeenCalled()
    expect(mockConfigureToken).not.toHaveBeenCalled()
  })

  it('dispatches "push" to pushPull', async () => {
    await runCommandMode(makeInputs({ command: 'push', all: true }), wiremockDir)
    expect(mockPushPull).toHaveBeenCalledWith('push', expect.objectContaining({ command: 'push' }), wiremockDir)
  })

  it('dispatches "pull" to pushPull', async () => {
    await runCommandMode(makeInputs({ command: 'pull', all: true }), wiremockDir)
    expect(mockPushPull).toHaveBeenCalledWith('pull', expect.objectContaining({ command: 'pull' }), wiremockDir)
  })

  it('dispatches "environments-create" to environmentsCreate', async () => {
    await runCommandMode(makeInputs({ command: 'environments-create', profile: 'development' }), wiremockDir)
    expect(mockEnvironmentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'environments-create' }),
      wiremockDir
    )
  })

  it('dispatches "record-stop" to recordStop', async () => {
    await runCommandMode(makeInputs({ command: 'record-stop' }), wiremockDir)
    expect(mockRecordStop).toHaveBeenCalledWith(expect.objectContaining({ command: 'record-stop' }))
  })

  it('dispatches "mode-switch" to modeSwitch', async () => {
    await runCommandMode(makeInputs({ command: 'mode-switch', 'target-mode': 'serve' }), wiremockDir)
    expect(mockModeSwitch).toHaveBeenCalledWith(expect.objectContaining({ command: 'mode-switch' }))
  })

  it('dispatches "record-flush" and sets the recording-flushed output', async () => {
    mockRecordFlush.mockResolvedValue(true)
    await runCommandMode(makeInputs({ command: 'record-flush' }), wiremockDir)
    expect(mockRecordFlush).toHaveBeenCalled()
    expect(mockSetOutputs).toHaveBeenCalledWith({ recordingFlushed: true })
  })

  it('dispatches "record-flush-and-stop" and sets the recording-flushed output', async () => {
    mockRecordFlushAndStop.mockResolvedValue(false)
    await runCommandMode(makeInputs({ command: 'record-flush-and-stop' }), wiremockDir)
    expect(mockRecordFlushAndStop).toHaveBeenCalled()
    expect(mockSetOutputs).toHaveBeenCalledWith({ recordingFlushed: false })
  })

  it('dispatches "resolve-urls" and sets URL outputs', async () => {
    await runCommandMode(makeInputs({ command: 'resolve-urls' }), wiremockDir)
    expect(mockSetOutputs).toHaveBeenCalledWith({
      mockApiUrl: 'http://localhost:8080',
      mockApiUrls: { 'todos-api': 'http://localhost:8080' },
      runnerAdminUrl: 'http://localhost:9999',
    })
  })

  it('writes a summary with the admin URL for runner-dependent commands', async () => {
    await runCommandMode(makeInputs({ command: 'resolve-urls' }), wiremockDir)
    expect(mockWriteSummary).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'resolve-urls', adminUrl: 'http://localhost:9999' })
    )
  })

  it('writes a summary without an admin URL for CLI-only commands', async () => {
    await runCommandMode(makeInputs({ command: 'push', all: true, 'api-token': 'tok' }), wiremockDir)
    expect(mockWriteSummary).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'push', adminUrl: undefined })
    )
  })
})
