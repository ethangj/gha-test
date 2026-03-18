import * as core from '@actions/core'
import * as exec from '@actions/exec'
import { HttpClient } from '@actions/http-client'
import {
  buildContainerName,
  startContainer,
  waitForHealth,
  stopContainer,
} from '../../container/lifecycle'
import { makeInputs } from '../fixtures/inputs'

jest.mock('@actions/core')
jest.mock('@actions/exec')
jest.mock('@actions/http-client')

const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>
const mockInfo = core.info as jest.MockedFunction<typeof core.info>
const mockWarning = core.warning as jest.MockedFunction<typeof core.warning>
const MockHttpClient = HttpClient as jest.MockedClass<typeof HttpClient>

let mockGet: jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockExec.mockResolvedValue(0)
  mockGet = jest.fn()
  MockHttpClient.mockImplementation(() => ({ get: mockGet } as never))
})

// ─── buildContainerName ───────────────────────────────────────────────────────

describe('buildContainerName', () => {
  it('includes GITHUB_RUN_ID and GITHUB_JOB when set', () => {
    process.env.GITHUB_RUN_ID = '12345'
    process.env.GITHUB_JOB = 'integration'
    const name = buildContainerName()
    expect(name).toMatch(/^wiremock-runner-12345-integration-[a-f0-9]{6}$/)
    delete process.env.GITHUB_RUN_ID
    delete process.env.GITHUB_JOB
  })

  it('falls back to "local" and "job" when env vars are absent', () => {
    delete process.env.GITHUB_RUN_ID
    delete process.env.GITHUB_JOB
    const name = buildContainerName()
    expect(name).toMatch(/^wiremock-runner-local-job-[a-f0-9]{6}$/)
  })

  it('generates unique names on each call', () => {
    const a = buildContainerName()
    const b = buildContainerName()
    expect(a).not.toBe(b)
  })
})

// ─── startContainer ───────────────────────────────────────────────────────────

describe('startContainer', () => {
  it('runs docker run with required flags', async () => {
    const name = await startContainer(makeInputs(), '/tmp/wiremock')
    expect(mockExec).toHaveBeenCalledWith('docker', expect.arrayContaining(['run', '--detach']))
    expect(name).toMatch(/^wiremock-runner-/)
  })

  it('passes the wiremock-dir as a volume mount', async () => {
    await startContainer(makeInputs(), '/tmp/wiremock')
    const [, args] = mockExec.mock.calls[0]
    expect(args).toContain('-v')
    const vIdx = (args as string[]).indexOf('-v')
    expect((args as string[])[vIdx + 1]).toContain('/tmp/wiremock')
  })

  it('exposes the admin port', async () => {
    await startContainer(makeInputs({ 'runner-admin-port': 9999 }), '/tmp/wiremock')
    const [, args] = mockExec.mock.calls[0]
    expect(args).toContain('9999:9999')
  })

  it('uses --env-file instead of -e for the API token', async () => {
    await startContainer(makeInputs({ 'api-token': 'secret-token' }), '/tmp/wiremock')
    const [, args] = mockExec.mock.calls[0]
    expect(args).toContain('--env-file')
    // token must NOT appear directly in args
    expect(args).not.toContain('WMC_API_TOKEN=secret-token')
  })

  it('does not add --env-file when api-token is empty', async () => {
    await startContainer(makeInputs({ 'api-token': '' }), '/tmp/wiremock')
    const [, args] = mockExec.mock.calls[0]
    expect(args).not.toContain('--env-file')
  })

  it('sets WMC_RECORD_MANY_PROFILE when mode is record-many', async () => {
    await startContainer(
      makeInputs({ mode: 'record-many', profile: 'staging' }),
      '/tmp/wiremock'
    )
    const [, args] = mockExec.mock.calls[0]
    const eIdx = (args as string[]).lastIndexOf('-e')
    expect((args as string[])[eIdx + 1]).toContain('WMC_RECORD_MANY_PROFILE=staging')
  })

  it('sets WMC_RUN_PROFILE when mode is serve', async () => {
    await startContainer(makeInputs({ mode: 'serve', profile: 'staging' }), '/tmp/wiremock')
    const [, args] = mockExec.mock.calls[0]
    const profileArgs = (args as string[]).filter(a => a.startsWith('WMC_RUN_PROFILE'))
    expect(profileArgs[0]).toBe('WMC_RUN_PROFILE=staging')
  })

  it('saves containerName to state', async () => {
    const mockSaveState = core.saveState as jest.MockedFunction<typeof core.saveState>
    await startContainer(makeInputs(), '/tmp/wiremock')
    expect(mockSaveState).toHaveBeenCalledWith('containerName', expect.stringMatching(/^wiremock-runner-/))
  })

  it('re-throws when docker run fails', async () => {
    mockExec.mockRejectedValue(new Error('docker: Error response'))
    await expect(startContainer(makeInputs(), '/tmp/wiremock')).rejects.toThrow()
  })
})

// ─── waitForHealth ────────────────────────────────────────────────────────────

describe('waitForHealth', () => {
  it('resolves when health check returns 2xx on first attempt', async () => {
    mockGet.mockResolvedValue({ message: { statusCode: 200 } })
    await expect(waitForHealth('http://localhost:9999', 3, 0)).resolves.toBeUndefined()
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('healthy'))
  })

  it('retries until healthy', async () => {
    mockGet
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue({ message: { statusCode: 200 } })
    await expect(waitForHealth('http://localhost:9999', 3, 0)).resolves.toBeUndefined()
    expect(mockGet).toHaveBeenCalledTimes(2)
  })

  it('throws after all retries are exhausted', async () => {
    mockGet.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(waitForHealth('http://localhost:9999', 2, 0)).rejects.toThrow()
  })

  it('throws when health endpoint returns non-2xx', async () => {
    mockGet.mockResolvedValue({ message: { statusCode: 503 } })
    await expect(waitForHealth('http://localhost:9999', 1, 0)).rejects.toThrow('Health check failed')
  })
})

// ─── stopContainer ────────────────────────────────────────────────────────────

describe('stopContainer', () => {
  it('calls docker stop then docker rm with the container name', async () => {
    await stopContainer('wiremock-runner-123-job-abc123')
    expect(mockExec).toHaveBeenCalledWith(
      'docker',
      ['stop', '--time', '5', 'wiremock-runner-123-job-abc123']
    )
    expect(mockExec).toHaveBeenCalledWith(
      'docker',
      ['rm', '-f', 'wiremock-runner-123-job-abc123'],
      { ignoreReturnCode: true }
    )
  })

  it('emits a warning (not an error) when docker stop fails, still calls docker rm', async () => {
    mockExec.mockRejectedValueOnce(new Error('container not found'))
    mockExec.mockResolvedValue(0)
    await expect(stopContainer('wiremock-runner-123-job-abc123')).resolves.toBeUndefined()
    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining('Could not stop container')
    )
    expect(mockExec).toHaveBeenCalledWith(
      'docker',
      ['rm', '-f', 'wiremock-runner-123-job-abc123'],
      { ignoreReturnCode: true }
    )
  })
})
