import * as core from '@actions/core'
import { HttpClient } from '@actions/http-client'
import {
  verifyRunnerReachable,
  recordFlush,
  modeSwitch,
  recordStop,
  recordFlushAndStop,
} from '../../cli/record-flush'
import { ActionFatalError } from '../../errors'
import { makeInputs } from '../fixtures/inputs'

jest.mock('@actions/http-client')
jest.mock('@actions/core')

const MockHttpClient = HttpClient as jest.MockedClass<typeof HttpClient>
const mockSetFailed = core.setFailed as jest.MockedFunction<typeof core.setFailed>
const mockWarning = core.warning as jest.MockedFunction<typeof core.warning>
const mockInfo = core.info as jest.MockedFunction<typeof core.info>

// Instance method mocks shared across tests
let mockGet: jest.Mock
let mockPost: jest.Mock
let mockPut: jest.Mock

function mockResponse(statusCode: number, body = '') {
  return {
    message: { statusCode },
    readBody: jest.fn().mockResolvedValue(body),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGet = jest.fn()
  mockPost = jest.fn()
  mockPut = jest.fn()
  MockHttpClient.mockImplementation(() => ({ get: mockGet, post: mockPost, put: mockPut } as never))
})

// ─── verifyRunnerReachable ────────────────────────────────────────────────────

describe('verifyRunnerReachable', () => {
  it('resolves when health check returns 2xx', async () => {
    mockGet.mockResolvedValue(mockResponse(200))
    await expect(verifyRunnerReachable('http://localhost:9999')).resolves.toBeUndefined()
  })

  it('calls setFailed and throws when health check returns non-2xx', async () => {
    mockGet.mockResolvedValue(mockResponse(503))
    await expect(verifyRunnerReachable('http://localhost:9999')).rejects.toThrow(ActionFatalError)
    expect(mockSetFailed).toHaveBeenCalled()
  })

  it('calls setFailed and throws when connection is refused', async () => {
    mockGet.mockRejectedValue(new Error('connect ECONNREFUSED'))
    await expect(verifyRunnerReachable('http://localhost:9999')).rejects.toThrow(ActionFatalError)
    expect(mockSetFailed).toHaveBeenCalled()
  })
})

// ─── recordFlush ─────────────────────────────────────────────────────────────

describe('recordFlush', () => {
  it('returns true on 2xx response', async () => {
    mockPost.mockResolvedValue(mockResponse(200, '{"flushed":true}'))
    const result = await recordFlush(makeInputs())
    expect(result).toBe(true)
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('flush succeeded'))
  })

  it('returns false and emits warning on non-2xx', async () => {
    mockPost.mockResolvedValue(mockResponse(500, '{"error":"internal"}'))
    const result = await recordFlush(makeInputs())
    expect(result).toBe(false)
    expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('500'))
  })

  it('returns false and emits warning when connection fails', async () => {
    mockPost.mockRejectedValue(new Error('connect ECONNREFUSED'))
    const result = await recordFlush(makeInputs())
    expect(result).toBe(false)
    expect(mockWarning).toHaveBeenCalled()
  })

  it('passes include-services in request body when set', async () => {
    mockPost.mockResolvedValue(mockResponse(200, '{}'))
    await recordFlush(makeInputs({ 'include-services': 'api-one,api-two' }))
    const [, body] = mockPost.mock.calls[0]
    const parsed = JSON.parse(body)
    expect(parsed.services).toContain('api-one')
    expect(parsed.services).toContain('api-two')
  })

  it('sends empty body when include-services is not set', async () => {
    mockPost.mockResolvedValue(mockResponse(200, '{}'))
    await recordFlush(makeInputs())
    const [, body] = mockPost.mock.calls[0]
    expect(body).toBe('{}')
  })
})

// ─── modeSwitch ──────────────────────────────────────────────────────────────

describe('modeSwitch', () => {
  it('resolves and logs info on 200', async () => {
    mockPut.mockResolvedValue(mockResponse(200, '{"mode":"record-many"}'))
    await expect(
      modeSwitch(makeInputs({ 'target-mode': 'record-many' }))
    ).resolves.toBeUndefined()
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('record-many'))
  })

  it('treats 409 "Runner is already in" as a warning and continues', async () => {
    mockPut.mockResolvedValue(
      mockResponse(409, '{"errors":[{"detail":"Runner is already in record-many mode"}]}')
    )
    await expect(
      modeSwitch(makeInputs({ 'target-mode': 'record-many' }))
    ).resolves.toBeUndefined()
    expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('already in'))
    expect(mockSetFailed).not.toHaveBeenCalled()
  })

  it('calls setFailed and throws on 409 with config error', async () => {
    mockPut.mockResolvedValue(
      mockResponse(409, '{"errors":[{"detail":"Failed to parse record-many mode configuration"}]}')
    )
    await expect(
      modeSwitch(makeInputs({ 'target-mode': 'record-many' }))
    ).rejects.toThrow(ActionFatalError)
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('Mode Switch Failed'))
  })

  it('calls setFailed and throws on 500', async () => {
    mockPut.mockResolvedValue(mockResponse(500, '{"error":"server error"}'))
    await expect(
      modeSwitch(makeInputs({ 'target-mode': 'serve' }))
    ).rejects.toThrow(ActionFatalError)
    expect(mockSetFailed).toHaveBeenCalled()
  })

  it('includes runner-config in request body', async () => {
    mockPut.mockResolvedValue(mockResponse(200, '{}'))
    await modeSwitch(makeInputs({ 'target-mode': 'record-many', 'runner-config': 'max-batch-requests: 50' }))
    const [, body] = mockPut.mock.calls[0]
    const parsed = JSON.parse(body)
    expect(parsed.config?.['max-batch-requests']).toBe('50')
  })

  it('uses PUT method', async () => {
    mockPut.mockResolvedValue(mockResponse(200, '{}'))
    await modeSwitch(makeInputs({ 'target-mode': 'serve' }))
    expect(mockPut).toHaveBeenCalled()
    expect(mockPost).not.toHaveBeenCalled()
  })
})

// ─── recordStop ──────────────────────────────────────────────────────────────

describe('recordStop', () => {
  it('calls modeSwitch with target-mode: serve', async () => {
    mockPut.mockResolvedValue(mockResponse(200, '{}'))
    await expect(recordStop(makeInputs())).resolves.toBeUndefined()
    const [, body] = mockPut.mock.calls[0]
    expect(JSON.parse(body).mode).toBe('serve')
  })
})

// ─── recordFlushAndStop ──────────────────────────────────────────────────────

describe('recordFlushAndStop', () => {
  it('flushes then stops, returns flush result', async () => {
    mockPost.mockResolvedValue(mockResponse(200, '{"ok":true}'))
    mockPut.mockResolvedValue(mockResponse(200, '{"mode":"serve"}'))
    const result = await recordFlushAndStop(makeInputs())
    expect(result).toBe(true)
  })

  it('returns false when flush fails but still stops', async () => {
    mockPost.mockResolvedValue(mockResponse(404, '{"error":"no session"}'))
    mockPut.mockResolvedValue(mockResponse(200, '{}'))
    const result = await recordFlushAndStop(makeInputs())
    expect(result).toBe(false)
    expect(mockWarning).toHaveBeenCalled()
  })
})
