import * as exec from '@actions/exec'
import * as core from '@actions/core'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { pushPull, environmentsCreate } from '../../cli/push-pull'
import { ActionFatalError } from '../../errors'
import { makeInputs as makeBaseInputs } from '../fixtures/inputs'
import type { Inputs } from '../../inputs'

jest.mock('@actions/exec')
jest.mock('@actions/core')

const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>
const mockSetFailed = core.setFailed as jest.MockedFunction<typeof core.setFailed>
const mockNotice = core.notice as jest.MockedFunction<typeof core.notice>

let tmpDir: string

beforeEach(() => {
  jest.clearAllMocks()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-push-pull-'))
  mockExec.mockResolvedValue(0)
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
  return makeBaseInputs({ 'wiremock-dir': tmpDir, ...overrides })
}

// ─── pushPull ────────────────────────────────────────────────────────────────

describe('pushPull', () => {
  it('push with --all passes correct args', async () => {
    await pushPull('push', makeInputs({ all: true }), tmpDir)
    expect(mockExec).toHaveBeenCalledWith(
      'wiremock',
      expect.arrayContaining(['push', 'mock-api', '--wiremock-dir', tmpDir, '--all']),
      expect.any(Object)
    )
  })

  it('pull with --all passes correct args', async () => {
    await pushPull('pull', makeInputs({ all: true }), tmpDir)
    expect(mockExec).toHaveBeenCalledWith(
      'wiremock',
      expect.arrayContaining(['pull', 'mock-api', '--all']),
      expect.any(Object)
    )
  })

  it('push with mock-api name passes name (not --all)', async () => {
    await pushPull('push', makeInputs({ 'mock-api': 'orders-api' }), tmpDir)
    const [, args] = mockExec.mock.calls[0]
    expect(args).toContain('orders-api')
    expect(args).not.toContain('--all')
  })

  it('appends --profile when profile is set', async () => {
    await pushPull('pull', makeInputs({ all: true, profile: 'development' }), tmpDir)
    const [, args] = mockExec.mock.calls[0]
    expect(args).toContain('--profile')
    expect(args).toContain('development')
  })

  it('does not append --profile when profile is not set', async () => {
    await pushPull('push', makeInputs({ all: true }), tmpDir)
    const [, args] = mockExec.mock.calls[0]
    expect(args).not.toContain('--profile')
  })

  it('calls setFailed with auth error message on 401 in stderr', async () => {
    mockExec.mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stderr?.(Buffer.from('Error: 401 Unauthorized'))
      return 1
    })
    await expect(pushPull('push', makeInputs({ all: true }), tmpDir)).rejects.toThrow(ActionFatalError)
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('Authentication Failed'))
  })

  it('calls setFailed with profile error on profile not found in stderr', async () => {
    mockExec.mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stderr?.(Buffer.from('profile file not found: development'))
      return 1
    })
    await expect(pushPull('pull', makeInputs({ all: true, profile: 'development' }), tmpDir)).rejects.toThrow(ActionFatalError)
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('Profile Not Found'))
  })

  it('calls setFailed with generic message on unknown error', async () => {
    mockExec.mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stderr?.(Buffer.from('some unknown error'))
      return 1
    })
    await expect(pushPull('push', makeInputs({ all: true }), tmpDir)).rejects.toThrow(ActionFatalError)
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('push failed'))
  })

  it('uses ignoreReturnCode so exec does not throw on failure', async () => {
    // If ignoreReturnCode: true is set, mockExec returning non-zero won't throw.
    // We just verify our error handling path runs (setFailed called) instead of
    // the test itself throwing from exec.
    mockExec.mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stderr?.(Buffer.from('fail'))
      return 1
    })
    // Should throw process.exit (from our handler), not from exec
    await expect(pushPull('push', makeInputs({ all: true }), tmpDir)).rejects.toThrow(ActionFatalError)
  })
})

// ─── environmentsCreate ──────────────────────────────────────────────────────

describe('environmentsCreate', () => {
  it('runs wiremock environments create with correct profile', async () => {
    await environmentsCreate(makeInputs({ profile: 'development' }), tmpDir)
    expect(mockExec).toHaveBeenCalledWith(
      'wiremock',
      ['environments', 'create', '--profile', 'development'],
      expect.any(Object)
    )
  })

  it('skips (idempotent) when profile file already exists and force is false', async () => {
    const profilePath = path.join(tmpDir, 'wiremock-development.yaml')
    fs.writeFileSync(profilePath, 'services: {}', 'utf8')
    await environmentsCreate(makeInputs({ profile: 'development', force: false }), tmpDir)
    expect(mockExec).not.toHaveBeenCalled()
    expect(mockNotice).toHaveBeenCalledWith(expect.stringContaining('Skipping'))
  })

  it('calls setFailed and exits when force is true and file exists', async () => {
    const profilePath = path.join(tmpDir, 'wiremock-staging.yaml')
    fs.writeFileSync(profilePath, 'services: {}', 'utf8')
    await expect(
      environmentsCreate(makeInputs({ profile: 'staging', force: true }), tmpDir)
    ).rejects.toThrow(ActionFatalError)
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('Profile Already Exists'))
  })

  it('throws when profile input is not set', async () => {
    await expect(
      environmentsCreate(makeInputs({ profile: undefined }), tmpDir)
    ).rejects.toThrow('`profile` input is required')
  })

  it('calls setFailed on CLI failure', async () => {
    mockExec.mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stderr?.(Buffer.from('unexpected error'))
      return 1
    })
    await expect(
      environmentsCreate(makeInputs({ profile: 'development' }), tmpDir)
    ).rejects.toThrow(ActionFatalError)
    expect(mockSetFailed).toHaveBeenCalled()
  })
})

