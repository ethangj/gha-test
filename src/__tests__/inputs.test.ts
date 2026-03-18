/**
 * Tests for input validation via getInputs().
 * We mock @actions/core.getInput to inject values.
 */

jest.mock('@actions/core')
import * as core from '@actions/core'

const mockGetInput = core.getInput as jest.MockedFunction<typeof core.getInput>
const mockSetFailed = core.setFailed as jest.MockedFunction<typeof core.setFailed>

const mockExit = jest.spyOn(process, 'exit').mockImplementation((code?: number | string | null) => {
  throw new Error(`process.exit(${code})`)
})

import { getInputs } from '../inputs'

function setInputs(inputs: Record<string, string>) {
  mockGetInput.mockImplementation((name: string) => inputs[name] ?? '')
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('getInputs', () => {
  describe('valid inputs', () => {
    it('accepts run with mode=serve', () => {
      setInputs({ run: 'npm test', 'api-token': 'tok' })
      const inputs = getInputs()
      expect(inputs.run).toBe('npm test')
      expect(inputs.mode).toBe('serve')
    })

    it('accepts run with mode=record-many', () => {
      setInputs({ run: 'bash script.sh', mode: 'record-many', 'api-token': 'tok' })
      const inputs = getInputs()
      expect(inputs.mode).toBe('record-many')
    })

    it('accepts command=push with api-token', () => {
      setInputs({ command: 'push', 'api-token': 'tok' })
      const inputs = getInputs()
      expect(inputs.command).toBe('push')
    })

    it('accepts command=mode-switch with target-mode', () => {
      setInputs({ command: 'mode-switch', 'target-mode': 'record-many' })
      const inputs = getInputs()
      expect(inputs['target-mode']).toBe('record-many')
    })

    it('accepts command=resolve-urls with no api-token', () => {
      setInputs({ command: 'resolve-urls' })
      const inputs = getInputs()
      expect(inputs.command).toBe('resolve-urls')
    })

    it('applies defaults', () => {
      setInputs({ run: 'echo hi' })
      const inputs = getInputs()
      expect(inputs['wiremock-dir']).toBe('.wiremock')
      expect(inputs.mode).toBe('serve')
      expect(inputs.ports).toBe('8080')
      expect(inputs['runner-admin-port']).toBe(9999)
      expect(inputs['runner-version']).toBe('latest')
      expect(inputs['post-run-pull']).toBe(false)
      expect(inputs.all).toBe(false)
      expect(inputs.force).toBe(false)
      expect(inputs['health-check-retries']).toBe(30)
      expect(inputs['health-check-interval']).toBe(2)
    })

    it('transforms post-run-pull string to boolean', () => {
      setInputs({ run: 'echo hi', 'api-token': 'tok', 'post-run-pull': 'true', mode: 'record-many' })
      const inputs = getInputs()
      expect(inputs['post-run-pull']).toBe(true)
    })

    it('accepts multiple ports', () => {
      setInputs({ run: 'echo hi', ports: '8080,8081' })
      const inputs = getInputs()
      expect(inputs.ports).toBe('8080,8081')
    })

    it('accepts custom wiremock-dir', () => {
      setInputs({ run: 'echo hi', 'wiremock-dir': 'mocks' })
      const inputs = getInputs()
      expect(inputs['wiremock-dir']).toBe('mocks')
    })
  })

  describe('validation failures', () => {
    it('fails when neither run nor command is set', () => {
      setInputs({})
      expect(() => getInputs()).toThrow('process.exit')
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining('run')
      )
    })

    it('fails when both run and command are set', () => {
      setInputs({ run: 'npm test', command: 'push', 'api-token': 'tok' })
      expect(() => getInputs()).toThrow('process.exit')
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining('mutually exclusive')
      )
    })

    it('fails when command=push is used without api-token', () => {
      setInputs({ command: 'push' })
      expect(() => getInputs()).toThrow('process.exit')
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining('api-token')
      )
    })

    it('fails when command=pull is used without api-token', () => {
      setInputs({ command: 'pull' })
      expect(() => getInputs()).toThrow('process.exit')
      expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('api-token'))
    })

    it('fails when command=environments-create is used without api-token', () => {
      setInputs({ command: 'environments-create' })
      expect(() => getInputs()).toThrow('process.exit')
    })

    it('fails when command=mode-switch has no target-mode', () => {
      setInputs({ command: 'mode-switch' })
      expect(() => getInputs()).toThrow('process.exit')
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining('target-mode')
      )
    })

    it('fails when post-run-pull=true but no api-token', () => {
      setInputs({ run: 'echo hi', 'post-run-pull': 'true', mode: 'record-many' })
      expect(() => getInputs()).toThrow('process.exit')
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining('api-token')
      )
    })

    it('fails on invalid port value', () => {
      setInputs({ run: 'echo hi', ports: 'abc' })
      expect(() => getInputs()).toThrow('process.exit')
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining('Invalid port')
      )
    })

    it('fails when port conflicts with runner-admin-port', () => {
      setInputs({ run: 'echo hi', ports: '9999', 'runner-admin-port': '9999' })
      expect(() => getInputs()).toThrow('process.exit')
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining('conflicts')
      )
    })

    it('fails when port is out of range', () => {
      setInputs({ run: 'echo hi', ports: '99999' })
      expect(() => getInputs()).toThrow('process.exit')
    })
  })
})

afterAll(() => {
  mockExit.mockRestore()
})
