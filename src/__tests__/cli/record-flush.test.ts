import * as exec from '@actions/exec'
import * as core from '@actions/core'
import {
  verifyRunnerReachable,
  recordFlush,
  modeSwitch,
  recordStop,
  recordFlushAndStop,
} from '../../cli/record-flush'
import { ActionFatalError } from '../../errors'
import { makeInputs } from '../fixtures/inputs'
import type { Inputs } from '../../inputs'

jest.mock('@actions/exec')
jest.mock('@actions/core')

const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>
const mockSetFailed = core.setFailed as jest.MockedFunction<typeof core.setFailed>
const mockWarning = core.warning as jest.MockedFunction<typeof core.warning>
const mockInfo = core.info as jest.MockedFunction<typeof core.info>

// Helper: make exec simulate an HTTP response
function mockHttpExec(httpCode: string, body = '', exitCode = 0) {
  mockExec.mockImplementation(async (_cmd, _args, options) => {
    if (body) {
      options?.listeners?.stdout?.(Buffer.from(`${body}\n${httpCode}`))
    } else {
      options?.listeners?.stdout?.(Buffer.from(httpCode))
    }
    return exitCode
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ─── verifyRunnerReachable ────────────────────────────────────────────────────

describe('verifyRunnerReachable', () => {
  it('resolves when health check returns 2xx', async () => {
    mockHttpExec('200')
    await expect(verifyRunnerReachable('http://localhost:9999')).resolves.toBeUndefined()
  })

  it('calls setFailed and exits when health check returns non-2xx', async () => {
    mockHttpExec('503')
    await expect(verifyRunnerReachable('http://localhost:9999')).rejects.toThrow(ActionFatalError)
    expect(mockSetFailed).toHaveBeenCalled()
  })

  it('calls setFailed and exits when curl fails (exit code != 0)', async () => {
    mockHttpExec('', '', 7) // connection refused
    await expect(verifyRunnerReachable('http://localhost:9999')).rejects.toThrow(ActionFatalError)
    expect(mockSetFailed).toHaveBeenCalled()
  })
})

// ─── recordFlush ─────────────────────────────────────────────────────────────

describe('recordFlush', () => {
  it('returns true on 2xx response', async () => {
    mockHttpExec('200', '{"flushed":true}')
    const result = await recordFlush(makeInputs())
    expect(result).toBe(true)
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('flush succeeded'))
  })

  it('returns false and emits warning on non-2xx', async () => {
    mockHttpExec('500', '{"error":"internal"}')
    const result = await recordFlush(makeInputs())
    expect(result).toBe(false)
    expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('500'))
  })

  it('returns false and emits warning when curl fails', async () => {
    mockHttpExec('', '', 7)
    const result = await recordFlush(makeInputs())
    expect(result).toBe(false)
    expect(mockWarning).toHaveBeenCalled()
  })

  it('passes include-services in request body when set', async () => {
    mockHttpExec('200', '{}')
    const capturedArgs: string[][] = []
    mockExec.mockImplementation(async (_cmd, args, options) => {
      capturedArgs.push(args as string[])
      options?.listeners?.stdout?.(Buffer.from('\n200'))
      return 0
    })
    await recordFlush(makeInputs({ 'include-services': 'api-one,api-two' }))
    const body = capturedArgs[0].find(a => a.includes('api-one'))
    expect(body).toMatch(/api-one/)
    expect(body).toMatch(/api-two/)
  })

  it('sends empty body when include-services is not set', async () => {
    const capturedArgs: string[][] = []
    mockExec.mockImplementation(async (_cmd, args, options) => {
      capturedArgs.push(args as string[])
      options?.listeners?.stdout?.(Buffer.from('\n200'))
      return 0
    })
    await recordFlush(makeInputs())
    const dashD = capturedArgs[0].indexOf('-d')
    expect(capturedArgs[0][dashD + 1]).toBe('{}')
  })
})

// ─── modeSwitch ──────────────────────────────────────────────────────────────

describe('modeSwitch', () => {
  it('resolves and logs info on 200', async () => {
    mockHttpExec('200', '{"mode":"record-many"}')
    await expect(
      modeSwitch(makeInputs({ 'target-mode': 'record-many' }))
    ).resolves.toBeUndefined()
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('record-many'))
  })

  it('treats 409 "Runner is already in" as a warning and continues', async () => {
    mockExec.mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stdout?.(
        Buffer.from('{"errors":[{"detail":"Runner is already in record-many mode"}]}\n409')
      )
      return 0
    })
    await expect(
      modeSwitch(makeInputs({ 'target-mode': 'record-many' }))
    ).resolves.toBeUndefined()
    expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('already in'))
    expect(mockSetFailed).not.toHaveBeenCalled()
  })

  it('calls setFailed and exits on 409 with config error', async () => {
    mockExec.mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stdout?.(
        Buffer.from('{"errors":[{"detail":"Failed to parse record-many mode configuration"}]}\n409')
      )
      return 0
    })
    await expect(
      modeSwitch(makeInputs({ 'target-mode': 'record-many' }))
    ).rejects.toThrow(ActionFatalError)
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('Mode Switch Failed'))
  })

  it('calls setFailed and exits on 500', async () => {
    mockHttpExec('500', '{"error":"server error"}')
    await expect(
      modeSwitch(makeInputs({ 'target-mode': 'serve' }))
    ).rejects.toThrow(ActionFatalError)
    expect(mockSetFailed).toHaveBeenCalled()
  })

  it('includes runner-config in request body', async () => {
    const capturedArgs: string[][] = []
    mockExec.mockImplementation(async (_cmd, args, options) => {
      capturedArgs.push(args as string[])
      options?.listeners?.stdout?.(Buffer.from('\n200'))
      return 0
    })
    await modeSwitch(makeInputs({ 'target-mode': 'record-many', 'runner-config': 'max-batch-requests: 50' }))
    const dashD = capturedArgs[0].indexOf('-d')
    const body = JSON.parse(capturedArgs[0][dashD + 1])
    expect(body.config?.['max-batch-requests']).toBe('50')
  })

  it('uses PUT method', async () => {
    const capturedArgs: string[][] = []
    mockExec.mockImplementation(async (_cmd, args, options) => {
      capturedArgs.push(args as string[])
      options?.listeners?.stdout?.(Buffer.from('\n200'))
      return 0
    })
    await modeSwitch(makeInputs({ 'target-mode': 'serve' }))
    expect(capturedArgs[0]).toContain('PUT')
  })
})

// ─── recordStop ──────────────────────────────────────────────────────────────

describe('recordStop', () => {
  it('calls modeSwitch with target-mode: serve', async () => {
    mockHttpExec('200', '{}')
    await expect(recordStop(makeInputs())).resolves.toBeUndefined()
    const capturedArgs: string[][] = []
    mockExec.mockImplementation(async (_cmd, args, options) => {
      capturedArgs.push(args as string[])
      options?.listeners?.stdout?.(Buffer.from('\n200'))
      return 0
    })
    await recordStop(makeInputs({ 'target-mode': 'record-many' }))
    const dashD = capturedArgs[0].indexOf('-d')
    const body = JSON.parse(capturedArgs[0][dashD + 1])
    expect(body.mode).toBe('serve')
  })
})

// ─── recordFlushAndStop ──────────────────────────────────────────────────────

describe('recordFlushAndStop', () => {
  it('flushes then stops, returns flush result', async () => {
    // Both calls succeed
    mockExec
      .mockImplementationOnce(async (_cmd, _args, options) => {
        options?.listeners?.stdout?.(Buffer.from('{"ok":true}\n200'))
        return 0
      })
      .mockImplementationOnce(async (_cmd, _args, options) => {
        options?.listeners?.stdout?.(Buffer.from('{"mode":"serve"}\n200'))
        return 0
      })
    const result = await recordFlushAndStop(makeInputs())
    expect(result).toBe(true)
  })

  it('returns false when flush fails but still stops', async () => {
    mockExec
      .mockImplementationOnce(async (_cmd, _args, options) => {
        options?.listeners?.stdout?.(Buffer.from('{"error":"no session"}\n404'))
        return 0
      })
      .mockImplementationOnce(async (_cmd, _args, options) => {
        options?.listeners?.stdout?.(Buffer.from('\n200'))
        return 0
      })
    const result = await recordFlushAndStop(makeInputs())
    expect(result).toBe(false)
    expect(mockWarning).toHaveBeenCalled()
  })
})

