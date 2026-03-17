// Mock @actions/core before importing inputs
jest.mock('@actions/core', () => ({
  getInput: jest.fn(),
  setFailed: jest.fn(),
  setSecret: jest.fn(),
}))

import * as core from '@actions/core'

// We test the Zod schema directly by importing the module under test.
// Since getInputs() calls process.exit on failure, we test the raw schema
// via a re-export trick — we expose the schema in tests by importing from the
// module, which we can do because Jest hoists mocks.

// Instead of testing getInputs() end-to-end (which calls process.exit),
// we unit-test the schema by shimming core.getInput and verifying setFailed calls.

const mockGetInput = core.getInput as jest.Mock
const mockSetFailed = core.setFailed as jest.Mock

describe('inputs validation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Suppress process.exit in tests
    jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  function setupInputs(overrides: Record<string, string> = {}): void {
    const defaults: Record<string, string> = {
      'api-token': '',
      'wiremock-dir': '.wiremock',
      run: '',
      mode: 'serve',
      ports: '8080',
      'runner-admin-port': '9999',
      'runner-version': 'latest',
      profile: '',
      'post-run-pull': 'false',
      command: '',
      'mock-api': '',
      all: 'false',
      'runner-admin-url': 'http://localhost:9999',
      'include-services': '',
      'target-mode': '',
      'runner-config': '',
      force: 'false',
      'wiremock-cli-version': 'latest',
      'health-check-retries': '30',
      'health-check-interval': '2',
    }
    mockGetInput.mockImplementation((key: string) => overrides[key] ?? defaults[key] ?? '')
  }

  function callGetInputs() {
    // Re-import fresh each time to pick up mock changes
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getInputs } = require('../../src/inputs')
    return getInputs()
  }

  it('accepts valid run input with defaults', () => {
    setupInputs({ run: 'npm test' })
    const result = callGetInputs()
    expect(result.run).toBe('npm test')
    expect(result.mode).toBe('serve')
    expect(result['health-check-retries']).toBe(30)
    expect(result['health-check-interval']).toBe(2)
    expect(result['runner-admin-port']).toBe(9999)
  })

  it('accepts valid command: push with api-token', () => {
    setupInputs({ command: 'push', 'api-token': 'tok-123', 'mock-api': 'my-api' })
    const result = callGetInputs()
    expect(result.command).toBe('push')
    expect(result['api-token']).toBe('tok-123')
  })

  it('fails when neither run nor command is set', () => {
    setupInputs({})
    expect(() => callGetInputs()).toThrow('process.exit called')
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('One of `run` or `command` must be set')
    )
  })

  it('fails when both run and command are set', () => {
    setupInputs({ run: 'npm test', command: 'push', 'api-token': 'tok' })
    expect(() => callGetInputs()).toThrow('process.exit called')
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('mutually exclusive')
    )
  })

  it('fails when push is used without api-token', () => {
    setupInputs({ command: 'push' })
    expect(() => callGetInputs()).toThrow('process.exit called')
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('api-token` is required for command: push')
    )
  })

  it('fails when mode-switch is used without target-mode', () => {
    setupInputs({ command: 'mode-switch' })
    expect(() => callGetInputs()).toThrow('process.exit called')
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('target-mode` is required when command is `mode-switch`')
    )
  })

  it('fails when post-run-pull is true without api-token', () => {
    setupInputs({ run: 'npm test', 'post-run-pull': 'true' })
    expect(() => callGetInputs()).toThrow('process.exit called')
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('api-token` is required when `post-run-pull` is true')
    )
  })

  it('fails on invalid port value', () => {
    setupInputs({ run: 'npm test', ports: 'abc' })
    expect(() => callGetInputs()).toThrow('process.exit called')
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid port value')
    )
  })

  it('fails on port value out of range', () => {
    setupInputs({ run: 'npm test', ports: '99999' })
    expect(() => callGetInputs()).toThrow('process.exit called')
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid port value')
    )
  })

  it('fails when mock port conflicts with admin port', () => {
    setupInputs({ run: 'npm test', ports: '9999', 'runner-admin-port': '9999' })
    expect(() => callGetInputs()).toThrow('process.exit called')
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('runner-admin-port (9999) conflicts with a value in ports')
    )
  })

  it('accepts multiple ports', () => {
    setupInputs({ run: 'npm test', ports: '8080,8081' })
    const result = callGetInputs()
    expect(result.ports).toBe('8080,8081')
  })

  it('transforms post-run-pull to boolean', () => {
    setupInputs({ run: 'npm test', 'post-run-pull': 'true', 'api-token': 'tok' })
    const result = callGetInputs()
    expect(result['post-run-pull']).toBe(true)
  })

  it('transforms all to boolean', () => {
    setupInputs({ command: 'push', 'api-token': 'tok', all: 'true' })
    const result = callGetInputs()
    expect(result.all).toBe(true)
  })

  it('coerces health-check-retries to number', () => {
    setupInputs({ run: 'npm test', 'health-check-retries': '15' })
    const result = callGetInputs()
    expect(result['health-check-retries']).toBe(15)
  })

  it('rejects invalid mode enum', () => {
    setupInputs({ run: 'npm test', mode: 'invalid' })
    expect(() => callGetInputs()).toThrow('process.exit called')
    expect(mockSetFailed).toHaveBeenCalled()
  })

  it('accepts resolve-urls without api-token', () => {
    setupInputs({ command: 'resolve-urls' })
    const result = callGetInputs()
    expect(result.command).toBe('resolve-urls')
  })

  it('accepts environments-create with profile', () => {
    setupInputs({ command: 'environments-create', 'api-token': 'tok', profile: 'staging' })
    const result = callGetInputs()
    expect(result.command).toBe('environments-create')
    expect(result.profile).toBe('staging')
  })
})
